#!/usr/bin/env node

/**
 * Conservatism-Bias Probe — genuine consensus or shared blind spot?
 * ----------------------------------------------------------------
 * THROWAWAY probe. Question it answers:
 *   "The same-base-model panel keeps converging CONSERVATIVE (all-rehab) on the ACL case —
 *    even though young cutting-sport ACL rupture with instability is where guidelines support
 *    early reconstruction. Is that agreement genuine evidence-based consensus, or a shared
 *    conservative prior that fires regardless of evidence (a blind spot)?"
 *
 * Design: EVIDENCE-SENSITIVITY FACTORIAL. Inject a clinical EVIDENCE BRIEF into the position
 * call (reusing makePositionSchema via processStructured — no production code touched) and
 * measure how the converged-rehab stance shifts. Cross direction × strength:
 *
 *                 strong / real evidence        sham / vacuous evidence
 *   pro-surgery   real ACLR data                "surgeons prefer it, gold standard"
 *   pro-rehab     real KANON/Delaware-Oslo       "conservative care is widely favored"
 *   + baseline (no evidence)
 *
 * Reads (pooled P(surgery) across specialist samples):
 *   - strong-pro-surgery MOVES stance ≫ sham-pro-surgery  -> evidence-sensitive & calibrated
 *     = GENUINE consensus, NOT a blind spot (the prior yields to strong contrary evidence).
 *   - strong-pro-surgery DOESN'T budge                    -> ANCHORED conservative = blind spot.
 *   - sham evidence also moves it                          -> CREDULOUS (over-swayed by framing).
 *   - eager to accept prior-consistent (pro-rehab) but resists equal-strength contrary
 *     (pro-surgery) evidence                               -> MOTIVATED/biased updating.
 *
 * Usage:
 *   node examples/conservatism-bias-probe.js          # 4 specialists × 5 conditions × N=4 = 80 calls (~$1.20)
 *   node examples/conservatism-bias-probe.js --smoke   # 1 specialist × 5 conditions × 1 = 5 calls
 */

import dotenv from 'dotenv';
dotenv.config();

process.env.ENABLE_BLOCKCHAIN = 'false';

import { writeFileSync, mkdirSync } from 'fs';

import { PainWhispererAgent } from '../src/agents/pain-whisperer-agent.js';
import { MovementDetectiveAgent } from '../src/agents/movement-detective-agent.js';
import { StrengthSageAgent } from '../src/agents/strength-sage-agent.js';
import { MindMenderAgent } from '../src/agents/mind-mender-agent.js';
import { makePositionSchema } from '../src/utils/dialogue-schemas.js';

const SMOKE = process.argv.includes('--smoke');
const N = SMOKE ? 1 : 4;
const CONCURRENCY = 4;

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

// Evidence briefs — matched in length/structure (3 bullets), differing only in clinical substance.
// STRONG briefs are grounded in real literature; SHAM briefs are pure authority/preference, no data.
const EV = {
  surgStrong: `- In patients under 30 returning to pivoting/cutting sport, persistent rotational instability after ACL rupture is associated with markedly higher rates of NEW meniscal and chondral injury that accrue with each giving-way episode (MOON cohort and multiple prospective series).
- A substantial fraction of initially non-operative "copers" (roughly a third or more of young pivoting athletes) cross over to delayed reconstruction, and surgery performed after new meniscal damage yields worse long-term cartilage outcomes.
- For a young athlete whose goal is return to cutting sport, early anatomic reconstruction restores the primary rotational restraint and is associated with higher rates of return to the same level of sport.`,
  surgSham: `- Leading orthopedic surgeons strongly favor early reconstruction for athletes like this one.
- Early surgery is widely regarded as the gold-standard, default choice in cases of this kind.
- Most experts would agree that operating sooner is simply the better and more decisive approach here.`,
  rehabStrong: `- The KANON randomized trial (NEJM 2010, with 5-year follow-up) found that rehab-first WITH the option of delayed reconstruction produced patient-reported outcomes (KOOS) equivalent to early surgery, and about half of the rehab-first group never required surgery — with no increase in later meniscal surgery.
- The Delaware-Oslo cohort shows that progressive criteria-based rehabilitation reliably identifies "copers" who achieve stable, high-functioning knees without reconstruction.
- Early surgery carries operative morbidity and graft-failure risk and has not been shown to reduce later osteoarthritis compared with an optional-delayed strategy.`,
  rehabSham: `- Thoughtful clinicians generally prefer to avoid surgery whenever it is possible to do so.
- Conservative, rehab-first care is broadly considered the sensible and prudent default.
- Most experts would agree that trying rehabilitation before operating is simply the wiser approach here.`,
};

const CONDITIONS = [
  { key: 'baseline', dir: null, strength: null, evidence: null },
  { key: 'surg_strong', dir: 'surgery', strength: 'strong', evidence: EV.surgStrong },
  { key: 'surg_sham', dir: 'surgery', strength: 'sham', evidence: EV.surgSham },
  { key: 'rehab_strong', dir: 'rehab', strength: 'strong', evidence: EV.rehabStrong },
  { key: 'rehab_sham', dir: 'rehab', strength: 'sham', evidence: EV.rehabSham },
];

const SPECIALISTS = [
  ['painWhisperer', () => new PainWhispererAgent('Pain Whisperer')],
  ['movementDetective', () => new MovementDetectiveAgent('Movement Detective')],
  ['strengthSage', () => new StrengthSageAgent('Strength Sage')],
  ['mindMender', () => new MindMenderAgent('Mind Mender')],
];

const isSurgery = s => !!s && s.includes('surg');
const short = s => (s == null ? 'null' : isSurgery(s) ? 'surgery' : s.includes('rehab') ? 'rehab' : s);

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

// Mirrors statePosition's prompt (so baseline ≈ production behavior); only the evidence block varies.
function buildPrompt(agent, evidenceText) {
  const optionList = DECISION_POINT.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
  const evidenceBlock = evidenceText
    ? `

You have just been shown newly surfaced clinical evidence below. Weigh it and state your position now: UPDATE your stance if the evidence genuinely changes your clinical judgment for THIS patient, or HOLD if it does not.

EVIDENCE BRIEF:
${evidenceText}`
    : '';
  return `As ${agent.name} (${agent.subspecialty}), state YOUR position on the following clinical decision for this patient, reasoning ONLY from your area of expertise.

DECISION: ${DECISION_POINT.question}
OPTIONS:
${optionList}

<patient_input>
${JSON.stringify(CASE_DATA)}
</patient_input>${evidenceBlock}

Instructions:
- Choose exactly one option you support, OR choose "defer".
- Ground your reasoning in THIS patient's specifics${evidenceText ? ' and the evidence above' : ''}, from your specialty's perspective.`;
}

async function main() {
  console.log(`\n=== Conservatism-Bias Probe — evidence-sensitivity factorial${SMOKE ? ' [SMOKE]' : ''} ===\n`);

  const agents = new Map(SPECIALISTS.map(([type, make]) => [type, make()]));
  const schema = makePositionSchema(DECISION_POINT.options);
  const targets = SMOKE ? SPECIALISTS.slice(0, 1) : SPECIALISTS;

  const cells = [];
  for (const [type] of targets)
    for (const cond of CONDITIONS)
      for (let s = 0; s < N; s++) cells.push({ type, cond: cond.key, evidence: cond.evidence, sample: s });

  console.log(`--- ${targets.length} specialist(s) × ${CONDITIONS.length} conditions × N=${N} = ${cells.length} calls ---`);

  const raw = await runPool(cells, async ({ type, cond, evidence, sample }) => {
    const agent = agents.get(type);
    try {
      const prompt = buildPrompt(agent, evidence);
      const r = await agent.processStructured(prompt, schema, { mode: 'normal', timeout: 75000, schemaName: 'specialist_position' });
      console.log(`    ${type.padEnd(18)} ${cond.padEnd(13)} #${sample} ${short(r.stance).padEnd(8)} conf=${r.confidence} grade=${r.evidenceGrade}`);
      return { type, cond, sample, stance: r.stance, confidence: r.confidence, evidenceGrade: r.evidenceGrade, reasoning: r.reasoning };
    } catch (e) {
      console.log(`    ${type.padEnd(18)} ${cond.padEnd(13)} #${sample} ERROR ${e.message.slice(0, 80)}`);
      return { type, cond, sample, error: e.message };
    }
  });

  // ---- Aggregate: pooled P(surgery) and mean confidence per condition ----
  function condStats(cond, type = null) {
    const rows = raw.filter(r => r.cond === cond && !r.error && (type ? r.type === type : true));
    const surg = rows.filter(r => isSurgery(r.stance)).length;
    const defer = rows.filter(r => r.stance === 'defer').length;
    const meanConf = rows.length ? rows.reduce((a, r) => a + (r.confidence ?? 0), 0) / rows.length : 0;
    return { n: rows.length, pSurgery: rows.length ? surg / rows.length : 0, defer, meanConf };
  }

  console.log('\n=== POOLED RESULTS (across all specialists × samples) ===');
  console.log(`  ${'condition'.padEnd(14)} ${'P(surgery)'.padEnd(12)} ${'meanConf'.padEnd(10)} defer  n`);
  const pooled = {};
  for (const c of CONDITIONS) {
    const s = condStats(c.key);
    pooled[c.key] = s;
    console.log(`  ${c.key.padEnd(14)} ${s.pSurgery.toFixed(2).padEnd(12)} ${s.meanConf.toFixed(2).padEnd(10)} ${String(s.defer).padEnd(6)} ${s.n}`);
  }

  // ---- Per-specialist P(surgery) by condition ----
  if (!SMOKE) {
    console.log('\n=== PER-SPECIALIST P(surgery) ===');
    console.log(`  ${'specialist'.padEnd(18)} ${CONDITIONS.map(c => c.key.slice(0, 11).padEnd(12)).join('')}`);
    for (const [type] of targets) {
      const cells = CONDITIONS.map(c => condStats(c.key, type).pSurgery.toFixed(2).padEnd(12)).join('');
      console.log(`  ${type.padEnd(18)} ${cells}`);
    }
  }

  // ---- Verdict ----
  const Sbase = pooled.baseline.pSurgery;
  const Sstrong = pooled.surg_strong.pSurgery;
  const Ssham = pooled.surg_sham.pSurgery;
  const moveStrong = Sstrong - Sbase;
  const moveSham = Ssham - Sbase;
  const confRehabStrong = pooled.rehab_strong.meanConf; // prior-consistent acceptance
  const confSurgStrong = pooled.surg_strong.meanConf;

  console.log('\n=== INTERPRETATION ===');
  console.log(`  baseline P(surgery)=${Sbase.toFixed(2)} | strong-pro-surgery=${Sstrong.toFixed(2)} (Δ ${moveStrong >= 0 ? '+' : ''}${moveStrong.toFixed(2)}) | sham-pro-surgery=${Ssham.toFixed(2)} (Δ ${moveSham >= 0 ? '+' : ''}${moveSham.toFixed(2)})`);
  console.log(`  prior-consistent acceptance: meanConf(rehab_strong)=${confRehabStrong.toFixed(2)} vs meanConf(surg_strong)=${confSurgStrong.toFixed(2)}`);
  if (moveStrong >= 0.4 && (moveStrong - moveSham) >= 0.3) {
    console.log(`  -> EVIDENCE-SENSITIVE & CALIBRATED: strong contrary evidence moves the converged stance, sham does not. Convergence = genuine consensus, NOT a blind spot.`);
  } else if (moveStrong < 0.2) {
    console.log(`  -> ANCHORED CONSERVATIVE: even strong contrary evidence barely moves the stance. Consistent with a SHARED BLIND SPOT — investigate before trusting convergence as consensus.`);
  } else if (moveSham >= 0.4) {
    console.log(`  -> CREDULOUS: sham evidence moves the stance nearly as much as real — over-swayed by framing rather than substance.`);
  } else {
    console.log(`  -> PARTIAL/AMBIGUOUS: moderate evidence-sensitivity; inspect per-specialist rows + reasoning below.`);
  }
  if (moveStrong < 0.3 && confRehabStrong - confSurgStrong >= 0.08) {
    console.log(`  ! ASYMMETRY: prior-consistent (rehab) evidence is accepted with higher confidence than equal-strength contrary (surgery) evidence is — motivated-updating signature.`);
  }

  // ---- Qualitative: did they engage the REAL evidence vs dismiss the SHAM? ----
  console.log('\n--- reasoning under STRONG pro-surgery (did they engage the real data?) ---');
  for (const r of raw.filter(r => r.cond === 'surg_strong' && !r.error).slice(0, 4))
    console.log(`  [${r.type} -> ${short(r.stance)}] ${String(r.reasoning).slice(0, 220)}`);
  console.log('\n--- reasoning under SHAM pro-surgery (did they resist empty authority?) ---');
  for (const r of raw.filter(r => r.cond === 'surg_sham' && !r.error).slice(0, 4))
    console.log(`  [${r.type} -> ${short(r.stance)}] ${String(r.reasoning).slice(0, 220)}`);

  mkdirSync('artifacts', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = `artifacts/conservatism-bias-probe-${stamp}.json`;
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), smoke: SMOKE, samplesPerCell: N, decisionPoint: DECISION_POINT, evidence: EV, pooled, raw }, null, 2)
  );
  console.log(`\nArtifact: ${outPath}\n`);
}

main().catch(e => { console.error('Probe crashed:', e); process.exit(1); });
