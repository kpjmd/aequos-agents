#!/usr/bin/env node
/**
 * Validation harness dispatcher.
 *
 *   node validation/run.js masked-evidence --cases <id> … [--dry-run|--submit]
 *   node validation/run.js cue-injection   --cases <id> … [--dry-run|--submit] [--replicates 2] [--cue 0]
 *
 * Default is DRY RUN (build + count + show samples, no spend). --submit runs the small batch and
 * writes an analysis artifact. Both harnesses build STANDALONE prompts (production's buildPositionPrompt
 * is never modified) and use each specialist's system prompt to preserve the persona panel.
 */
import dotenv from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases } from '../anchor-set/index.js';
import { AGENTS } from '../detector/grid.js';
import { buildMaskedPrompt, EVIDENCE_GRID } from './masked-evidence/build.js';
import { buildPair } from './cue-injection/pairs.js';
import { analyzeMasked, analyzeCue } from './analyze.js';

dotenv.config();

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS, 10) || 2500;

function parseArgs(argv) {
  const o = { harness: argv[0], cases: [], dryRun: true, submit: false, replicates: 2, cue: 0 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--submit') { o.submit = true; o.dryRun = false; }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--replicates') o.replicates = Math.max(1, parseInt(argv[++i], 10) || 2);
    else if (a === '--cue') o.cue = parseInt(argv[++i], 10) || 0;
    else if (a === '--cases') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) o.cases.push(argv[++i]); }
  }
  return o;
}

async function buildSpecialists() {
  const { PainWhispererAgent } = await import('../src/agents/pain-whisperer-agent.js');
  const { MovementDetectiveAgent } = await import('../src/agents/movement-detective-agent.js');
  const { StrengthSageAgent } = await import('../src/agents/strength-sage-agent.js');
  const { MindMenderAgent } = await import('../src/agents/mind-mender-agent.js');
  return new Map([
    ['painWhisperer', new PainWhispererAgent('Pain Whisperer')],
    ['movementDetective', new MovementDetectiveAgent('Movement Detective')],
    ['strengthSage', new StrengthSageAgent('Strength Sage')],
    ['mindMender', new MindMenderAgent('Mind Mender')],
  ]);
}

function selectCases(all, ids) {
  const byId = new Map(all.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function artifactDir() {
  const dir = join(process.cwd(), 'artifacts', 'validation');
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function runMasked(cases, opts) {
  // Build one request per case × evidence-structure × agent.
  const built = [];
  for (const c of cases) for (const ev of EVIDENCE_GRID) {
    const m = buildMaskedPrompt(c, ev);
    for (const agent of AGENTS) built.push({ caseId: c.id, agent, ...m });
  }
  console.log(`masked-evidence: ${cases.length} case(s) × ${EVIDENCE_GRID.length} evidence structures × ${AGENTS.length} lenses = ${built.length} calls`);

  if (opts.dryRun) {
    const s = built[0];
    console.log('\nsample masked prompt (topic identity removed):');
    console.log(s.userPrompt);
    console.log('\naudit — removed:', JSON.stringify(s.audit.removed, null, 2));
    console.log('\nDRY RUN — re-run with --submit to spend.');
    return;
  }

  const specialists = await buildSpecialists();
  const { toRequests, runValidationBatch, parseResult } = await import('./transport.js');
  const specs = built.map((b, i) => ({
    custom_id: `m-${i}`, system: specialists.get(b.agent).getSystemPrompt(),
    user: b.userPrompt, options: b.options, model: MODEL, maxTokens: MAX_TOKENS,
  }));
  const { byId, batchId } = await runValidationBatch(toRequests(specs));
  const rows = built.map((b, i) => ({ ...parseResult(byId.get(`m-${i}`), b.options), evidenceStructure: b.evidenceStructure, caseId: b.caseId }));
  const analysis = analyzeMasked(rows);
  const out = join(artifactDir(), `masked-evidence-${batchId}.json`);
  writeFileSync(out, JSON.stringify({ analysis, rows }, null, 2) + '\n');
  console.log('\nmasked-evidence analysis:');
  console.log(`  confidence by GRADE certainty:`, analysis.confidenceByCertainty);
  console.log(`  confidence tracks certainty (monotone): ${analysis.confidenceTracksCertainty}`);
  console.log(`  stance follows fabricated direction: ${analysis.stanceFollowsDirection} (agreement=${analysis.directionAgreement?.toFixed(3)})`);
  console.log(`  → ${analysis.confidenceTracksCertainty && analysis.stanceFollowsDirection ? 'model APPRAISES supplied evidence' : 'confidence does NOT track evidence — recognition-driven signal'}`);
  console.log(`  ✓ ${out}`);
}

async function runCue(cases, opts) {
  const built = [];
  for (const c of cases) {
    const pair = buildPair(c, opts.cue);
    for (const agent of AGENTS) for (let r = 1; r <= opts.replicates; r++) {
      built.push({ caseId: c.id, agent, replicate: r, phrasing: 'neutral', user: pair.neutral, options: pair.options });
      built.push({ caseId: c.id, agent, replicate: r, phrasing: 'cued', user: pair.cued, options: pair.options, cue: pair.cue });
    }
  }
  console.log(`cue-injection: ${cases.length} case(s) × 2 phrasings × ${AGENTS.length} lenses × ${opts.replicates} replicates = ${built.length} calls (cue="${buildPair(cases[0], opts.cue).cue}")`);

  if (opts.dryRun) {
    const pair = buildPair(cases[0], opts.cue);
    console.log('\nneutral prompt:\n' + pair.neutral);
    console.log('\ncued prompt (differs ONLY by the cue line):\n' + pair.cued);
    console.log('\nDRY RUN — re-run with --submit to spend.');
    return;
  }

  const specialists = await buildSpecialists();
  const { toRequests, runValidationBatch, parseResult } = await import('./transport.js');
  const specs = built.map((b, i) => ({
    custom_id: `c-${i}`, system: specialists.get(b.agent).getSystemPrompt(),
    user: b.user, options: b.options, model: MODEL, maxTokens: MAX_TOKENS,
  }));
  const { byId, batchId } = await runValidationBatch(toRequests(specs));
  const parsed = built.map((b, i) => ({ ...b, ...parseResult(byId.get(`c-${i}`), b.options) }));

  // Mean confidence per (case, phrasing) → per-case delta.
  const agg = new Map();
  for (const p of parsed) {
    const k = `${p.caseId}|${p.phrasing}`;
    if (!agg.has(k)) agg.set(k, []);
    agg.get(k).push(p.confidence);
  }
  const m = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pairs = cases.map((c) => ({ caseId: c.id, neutralConfidence: m(agg.get(`${c.id}|neutral`) || []), cuedConfidence: m(agg.get(`${c.id}|cued`) || []) }));
  const analysis = analyzeCue(pairs);
  const out = join(artifactDir(), `cue-injection-${batchId}.json`);
  writeFileSync(out, JSON.stringify({ analysis, pairs }, null, 2) + '\n');
  console.log('\ncue-injection analysis (confidence delta = recognition component):');
  console.log(`  mean delta (cued − neutral): ${analysis.meanDelta.toFixed(4)}`);
  for (const p of analysis.perCase) console.log(`    ${p.caseId.padEnd(48)} Δ=${p.delta.toFixed(3)}`);
  console.log(`  ✓ ${out}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!['masked-evidence', 'cue-injection'].includes(opts.harness)) {
    console.error('usage: node validation/run.js <masked-evidence|cue-injection> --cases <id> … [--dry-run|--submit]');
    process.exit(1);
  }
  const cases = selectCases(loadCases(), opts.cases);
  if (cases.length === 0) { console.error('no cases selected — pass --cases <id> …'); process.exit(1); }
  if (opts.submit && !process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set.'); process.exit(1); }

  if (opts.harness === 'masked-evidence') await runMasked(cases, opts);
  else await runCue(cases, opts);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('\nVALIDATION FAILED ❌', err); process.exit(1); });
}
