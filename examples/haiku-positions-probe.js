#!/usr/bin/env node

/**
 * Haiku-for-positions Probe — does Haiku preserve the divergence signal?
 * ---------------------------------------------------------------------
 * THROWAWAY cost-lever probe. Question it answers:
 *   "statePosition/reconsiderPosition run on Sonnet today. If we flip the position pass
 *    to Haiku (~5× cheaper), does the genuine lens-divergence survive — or does the
 *    smaller, more consensus-seeking model collapse the split (manufacturing agreement
 *    the detector would silently miss)?"
 *
 * Design: HEAD-TO-HEAD on identical inputs. Same case, same neutral decision point, same
 * 4 specialists. Run statePosition N times under Sonnet (mode 'normal') and N times under
 * Haiku (mode 'fast'); compare:
 *   1. Split survival — across the N samples, do >=2 distinct substantive stances appear?
 *      (built into "synthetic panels": sample i from each specialist = one panel)
 *   2. Stability — is each specialist's stance reproducible, or does it flip run-to-run?
 *   3. Reasoning quality — still lens-grounded (domain-specific), or generic/conclusory?
 *
 * Validity guard (learned from the reconsider probe): a case only counts as a comparison
 * where SONNET actually diverges. We use a NEUTRAL, symmetric DP (no "settled knee"-style
 * pre-loading) and report the Sonnet baseline explicitly.
 *
 * Usage:
 *   node examples/haiku-positions-probe.js           # full: 4 specialists × 2 models × N=8 = 64 calls (~$0.50)
 *   node examples/haiku-positions-probe.js --smoke    # wiring: 1 specialist × 2 models × 1 = 2 calls
 */

import dotenv from 'dotenv';
dotenv.config();

process.env.ENABLE_BLOCKCHAIN = 'false';

import { writeFileSync, mkdirSync } from 'fs';

import { PainWhispererAgent } from '../src/agents/pain-whisperer-agent.js';
import { MovementDetectiveAgent } from '../src/agents/movement-detective-agent.js';
import { StrengthSageAgent } from '../src/agents/strength-sage-agent.js';
import { MindMenderAgent } from '../src/agents/mind-mender-agent.js';

const SMOKE = process.argv.includes('--smoke');
const N = SMOKE ? 1 : 8;
const CONCURRENCY = 4;
const CONFIDENCE_FLOOR = 0.6; // mirror the detector

const MODELS = [
  { key: 'sonnet', mode: 'normal' },
  { key: 'haiku', mode: 'fast' },
];

// Neutral, symmetric DP — no loaded adjectives, both options stated as equals. Options are
// EXACT strings (become the stance enum). Same option strings as the reconsider probe.
const DECISION_POINT = {
  id: 'acl-management',
  question:
    'For this 28-year-old recreational soccer player with a complete ACL rupture, what is the ' +
    'appropriate management approach at this point?',
  options: [
    'early surgical ACL reconstruction',
    'structured rehabilitation first, reassess later',
  ],
};

const CASE_DATA = {
  patientId: 'probe_acl',
  age: 28,
  primaryComplaint: 'Tore my ACL playing soccer; deciding about surgery',
  symptoms:
    'complete ACL rupture confirmed on MRI, knee giving way, swelling resolved, wants to return to recreational soccer',
  painLevel: 3,
  duration: 'subacute',
  anxietyLevel: 6,
  movementDysfunction: true,
  functionalLimitations: ['cutting', 'pivoting', 'running'],
  strengthDeficits: true,
  rawQuery:
    'I am 28 and tore my ACL playing recreational soccer. The swelling is gone but my knee feels unstable when I pivot. Should I get surgery soon or try rehab first and decide later?',
  urgency: 'routine',
};

const SPECIALISTS = [
  ['painWhisperer', () => new PainWhispererAgent('Pain Whisperer')],
  ['movementDetective', () => new MovementDetectiveAgent('Movement Detective')],
  ['strengthSage', () => new StrengthSageAgent('Strength Sage')],
  ['mindMender', () => new MindMenderAgent('Mind Mender')],
];

const short = s => (s == null ? 'null' : s.includes('surg') ? 'surgery' : s.includes('rehab') ? 'rehab' : s);

async function runPool(items, worker, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  async function pump() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, pump));
  return results;
}

function modal(arr) {
  const counts = {};
  for (const x of arr) counts[x] = (counts[x] || 0) + 1;
  let best = null, n = -1;
  for (const [k, v] of Object.entries(counts)) if (v > n) { best = k; n = v; }
  return { value: best, count: n, counts };
}

function substantive(p) {
  return p && p.stance && p.stance !== 'defer' && (p.confidence ?? 0) >= CONFIDENCE_FLOOR;
}

async function main() {
  console.log(`\n=== Haiku-for-positions Probe — head-to-head statePosition${SMOKE ? ' [SMOKE]' : ''} ===\n`);

  const agents = new Map(SPECIALISTS.map(([type, make]) => [type, make()]));
  const targets = SMOKE ? SPECIALISTS.slice(0, 1) : SPECIALISTS;

  // Build the full work matrix: specialist × model × sample.
  const cells = [];
  for (const [type] of targets)
    for (const m of MODELS)
      for (let s = 0; s < N; s++) cells.push({ type, model: m.key, mode: m.mode, sample: s });

  console.log(`--- statePosition: ${targets.length} specialist(s) × ${MODELS.length} models × N=${N} = ${cells.length} calls ---`);

  const raw = await runPool(cells, async ({ type, model, mode, sample }) => {
    const agent = agents.get(type);
    try {
      const p = await agent.statePosition(CASE_DATA, DECISION_POINT, { mode });
      console.log(
        `    ${type.padEnd(18)} ${model.padEnd(7)} #${sample} ${short(p.stance).padEnd(8)} conf=${p.confidence} grade=${p.evidenceGrade}`
      );
      return { type, model, sample, stance: p.stance, confidence: p.confidence, evidenceGrade: p.evidenceGrade, reasoning: p.reasoning };
    } catch (e) {
      console.log(`    ${type.padEnd(18)} ${model.padEnd(7)} #${sample} ERROR ${e.message}`);
      return { type, model, sample, error: e.message };
    }
  });

  // -------------------------------------------------------------------------
  // Per-specialist × model: modal stance, stability, mean confidence, defer rate.
  // -------------------------------------------------------------------------
  console.log('\n=== PER-SPECIALIST STABILITY (modal stance, % at modal, mean conf) ===');
  console.log(`  ${'specialist'.padEnd(18)} ${'model'.padEnd(7)} ${'modal'.padEnd(9)} ${'stability'.padEnd(10)} ${'meanConf'.padEnd(9)} defer`);
  const perCell = {};
  for (const [type] of targets) {
    for (const m of MODELS) {
      const rows = raw.filter(r => r.type === type && r.model === m.key && !r.error);
      const stances = rows.map(r => r.stance);
      const md = modal(stances);
      const stability = rows.length ? md.count / rows.length : 0;
      const meanConf = rows.length ? rows.reduce((a, r) => a + (r.confidence ?? 0), 0) / rows.length : 0;
      const deferN = rows.filter(r => r.stance === 'defer').length;
      perCell[`${type}:${m.key}`] = { modal: md.value, counts: md.counts, stability, meanConf, deferN, n: rows.length };
      console.log(
        `  ${type.padEnd(18)} ${m.key.padEnd(7)} ${short(md.value).padEnd(9)} ` +
        `${`${(stability * 100).toFixed(0)}% (${md.count}/${rows.length})`.padEnd(10)} ${meanConf.toFixed(2).padEnd(9)} ${deferN}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Synthetic panels: sample i from each specialist = one panel. Divergence rate per model.
  // (Only meaningful with the full specialist set — skipped in smoke.)
  // -------------------------------------------------------------------------
  const panelSummary = {};
  if (!SMOKE) {
    console.log('\n=== PANEL DIVERGENCE (sample i across all specialists = one panel) ===');
    for (const m of MODELS) {
      let divergent = 0;
      const splitPatterns = {};
      for (let i = 0; i < N; i++) {
        const panel = SPECIALISTS.map(([type]) => raw.find(r => r.type === type && r.model === m.key && r.sample === i)).filter(Boolean);
        const subs = panel.filter(substantive);
        const distinct = [...new Set(subs.map(p => p.stance))];
        const isDiv = distinct.length >= 2;
        if (isDiv) divergent++;
        // record the split pattern as "Nsurgery-Mrehab" among substantive
        const surg = subs.filter(p => p.stance.includes('surg')).length;
        const reh = subs.filter(p => p.stance.includes('rehab')).length;
        const pat = `${surg}surg-${reh}rehab`;
        splitPatterns[pat] = (splitPatterns[pat] || 0) + 1;
      }
      panelSummary[m.key] = { divergenceRate: divergent / N, divergentPanels: divergent, panels: N, splitPatterns };
      console.log(
        `  ${m.key.padEnd(7)} divergent ${divergent}/${N} panels (${((divergent / N) * 100).toFixed(0)}%)   ` +
        `splits: ${Object.entries(splitPatterns).map(([k, v]) => `${k}×${v}`).join(', ')}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Verdict.
  // -------------------------------------------------------------------------
  console.log('\n=== INTERPRETATION ===');
  if (!SMOKE) {
    const sRate = panelSummary.sonnet?.divergenceRate ?? 0;
    const hRate = panelSummary.haiku?.divergenceRate ?? 0;
    if (sRate < 0.5) {
      console.log(`  Sonnet baseline diverged only ${(sRate * 100).toFixed(0)}% — DP framing didn't reliably split even on Sonnet; comparison INCONCLUSIVE. Re-frame the DP / pick a more divergent case.`);
    } else if (hRate >= sRate - 0.2) {
      console.log(`  Sonnet ${(sRate * 100).toFixed(0)}% vs Haiku ${(hRate * 100).toFixed(0)}% divergent panels → Haiku PRESERVES the split. Check stability/reasoning rows before committing the cost flip.`);
    } else {
      console.log(`  Sonnet ${(sRate * 100).toFixed(0)}% vs Haiku ${(hRate * 100).toFixed(0)}% → Haiku COLLAPSES the divergence signal. Keep positions on Sonnet.`);
    }
  }

  // Qualitative reasoning samples (lens-grounded vs generic).
  console.log('\n--- reasoning samples (judge: domain-specific & patient-specific, or generic/conclusory?) ---');
  for (const [type] of targets) {
    for (const m of MODELS) {
      const r = raw.find(x => x.type === type && x.model === m.key && !x.error && x.reasoning);
      if (r) console.log(`  [${type} ${m.key} ${short(r.stance)}] ${String(r.reasoning).slice(0, 220)}`);
    }
  }

  mkdirSync('artifacts', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = `artifacts/haiku-positions-probe-${stamp}.json`;
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), smoke: SMOKE, samplesPerCell: N, decisionPoint: DECISION_POINT, perCell, panelSummary, raw }, null, 2)
  );
  console.log(`\nArtifact: ${outPath}\n`);
}

main().catch(e => { console.error('Probe crashed:', e); process.exit(1); });
