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
import { loadCases, anchorSetVersion } from '../anchor-set/index.js';
import { AGENTS } from '../detector/grid.js';
import { buildMaskedPrompt, EVIDENCE_GRID } from './masked-evidence/build.js';
import { buildPair } from './cue-injection/pairs.js';
import { analyzeMasked, analyzeCue, deltaByGroup } from './analyze.js';
import { modelForAgent } from '../detector/panel-composition.js';
import { stratumGap } from './slots.js';
import { wilson } from '../recalibration/report.js';
import { loadDetectorFeatureCases } from '../recalibration/detector-cases.js';
import { loadArtifact } from '../recalibration/artifacts.js';

dotenv.config();

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS, 10) || 2500;
// Detector features for stratum-gap come from a specific panel composition; default to the ratified run.
const RECAL_MODEL = process.env.RECAL_MODEL || 'same_family_multi_version';

function parseArgs(argv) {
  const o = { harness: argv[0], cases: [], dryRun: true, submit: false, replicates: 2, cue: 0, model: RECAL_MODEL, composition: 'personas_single_model', select: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--submit') { o.submit = true; o.dryRun = false; }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--replicates') o.replicates = Math.max(1, parseInt(argv[++i], 10) || 2);
    else if (a === '--cue') o.cue = parseInt(argv[++i], 10) || 0;
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--composition') o.composition = argv[++i];
    else if (a === '--select') o.select = argv[++i];
    else if (a === '--cases') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) o.cases.push(argv[++i]); }
  }
  return o;
}

const SHOULD_CONTEST = new Set(['patient_dependent', 'evidence_split']);
/** Reproducible case selection: `should-contest` = the 57 active pd/es cases in a contested stratum. */
function selectByName(all, name) {
  if (name === 'should-contest') {
    return all.filter((c) => !c.provenance?.is_pediatric && SHOULD_CONTEST.has(c.label) && ['editorialized', 'quietly_contested'].includes(c.controversy_stratum));
  }
  throw new Error(`unknown --select set: ${name} (expected: should-contest)`);
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
  console.log(`masked-evidence: ${cases.length} case(s) × ${EVIDENCE_GRID.length} evidence structures × ${AGENTS.length} lenses = ${built.length} calls (composition=${opts.composition})`);

  if (opts.dryRun) {
    const s = built[0];
    console.log('\nper-agent models:', AGENTS.map((a) => `${a}=${modelForAgent(opts.composition, a, MODEL)}`).join(', '));
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
    user: b.userPrompt, options: b.options, model: modelForAgent(opts.composition, b.agent, MODEL), maxTokens: MAX_TOKENS,
  }));
  const { byId, batchId } = await runValidationBatch(toRequests(specs));
  const rows = built.map((b, i) => ({ ...parseResult(byId.get(`m-${i}`), b.options), evidenceStructure: b.evidenceStructure, caseId: b.caseId, agent: b.agent }));
  const analysis = analyzeMasked(rows);
  const out = join(artifactDir(), `masked-evidence-${batchId}.json`);
  writeFileSync(out, JSON.stringify({ composition: opts.composition, analysis, rows }, null, 2) + '\n');
  console.log('\nmasked-evidence analysis:');
  console.log(`  confidence by GRADE certainty:`, analysis.confidenceByCertainty);
  console.log(`  confidence tracks certainty (monotone): ${analysis.confidenceTracksCertainty}`);
  console.log(`  stance follows fabricated direction: ${analysis.stanceFollowsDirection} (agreement=${analysis.directionAgreement?.toFixed(3)})`);
  console.log(`  → ${analysis.confidenceTracksCertainty && analysis.stanceFollowsDirection ? 'model APPRAISES supplied evidence' : 'confidence does NOT track evidence — recognition-driven signal'}`);
  console.log(`  ✓ ${out}`);
}

async function runCue(cases, opts) {
  const stratumOf = new Map(cases.map((c) => [c.id, c.controversy_stratum]));
  const labelOf = new Map(cases.map((c) => [c.id, c.label]));
  const built = [];
  for (const c of cases) {
    const pair = buildPair(c, opts.cue);
    for (const agent of AGENTS) for (let r = 1; r <= opts.replicates; r++) {
      built.push({ caseId: c.id, agent, replicate: r, phrasing: 'neutral', user: pair.neutral, options: pair.options, stratum: c.controversy_stratum });
      built.push({ caseId: c.id, agent, replicate: r, phrasing: 'cued', user: pair.cued, options: pair.options, cue: pair.cue, stratum: c.controversy_stratum });
    }
  }
  console.log(`cue-injection: ${cases.length} case(s) × 2 phrasings × ${AGENTS.length} lenses × ${opts.replicates} replicates = ${built.length} calls (composition=${opts.composition}, cue="${buildPair(cases[0], opts.cue).cue}")`);

  if (opts.dryRun) {
    const pair = buildPair(cases[0], opts.cue);
    console.log('\nper-agent models:', AGENTS.map((a) => `${a}=${modelForAgent(opts.composition, a, MODEL)}`).join(', '));
    console.log('\nneutral prompt:\n' + pair.neutral);
    console.log('\ncued prompt (differs ONLY by the cue line):\n' + pair.cued);
    console.log('\nDRY RUN — re-run with --submit to spend.');
    return;
  }

  const specialists = await buildSpecialists();
  const { toRequests, runValidationBatch, parseResult } = await import('./transport.js');
  const specs = built.map((b, i) => ({
    custom_id: `c-${i}`, system: specialists.get(b.agent).getSystemPrompt(),
    user: b.user, options: b.options, model: modelForAgent(opts.composition, b.agent, MODEL), maxTokens: MAX_TOKENS,
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
  const pairs = cases.map((c) => ({ caseId: c.id, stratum: stratumOf.get(c.id), label: labelOf.get(c.id), neutralConfidence: m(agg.get(`${c.id}|neutral`) || []), cuedConfidence: m(agg.get(`${c.id}|cued`) || []) }));
  const analysis = analyzeCue(pairs);
  // The interpretive views: delta by stratum (does the cue inflate MORE on famous debates?) and by agent
  // (which model slot is cue-sensitive). Computed over the raw per-request rows.
  const byStratum = deltaByGroup(parsed, 'stratum');
  const byAgent = deltaByGroup(parsed, 'agent');
  const gapOfDeltas =
    byStratum.editorialized && byStratum.quietly_contested ? byStratum.editorialized.delta - byStratum.quietly_contested.delta : null;

  const out = join(artifactDir(), `cue-injection-${batchId}.json`);
  writeFileSync(out, JSON.stringify({ composition: opts.composition, analysis, by_stratum: byStratum, by_agent: byAgent, gap_of_deltas: gapOfDeltas, pairs }, null, 2) + '\n');
  console.log('\ncue-injection analysis (confidence delta = recognition component):');
  console.log(`  overall mean delta (cued − neutral): ${analysis.meanDelta.toFixed(4)}`);
  console.log('\n  delta BY STRATUM (the interpretation of the +16.6pt sensitivity gap):');
  for (const s of ['editorialized', 'quietly_contested']) {
    const b = byStratum[s];
    if (b) console.log(`    ${s.padEnd(18)} Δ=${b.delta.toFixed(4)} (neutral ${b.neutral.toFixed(3)} → cued ${b.cued.toFixed(3)}, n=${b.n})`);
  }
  console.log(`    gap of deltas (editorialized − quiet): ${gapOfDeltas == null ? 'n/a' : gapOfDeltas.toFixed(4)}`);
  console.log('    → large positive gap = the cue inflates confidence on famous debates ⇒ recognition contamination;');
  console.log('      ≈0 = the sensitivity gap is genuine balance, not fame.');
  console.log('\n  delta BY AGENT/MODEL slot:');
  for (const a of AGENTS) {
    const b = byAgent[a];
    if (b) console.log(`    ${a.padEnd(20)} (${modelForAgent(opts.composition, a, MODEL)}) Δ=${b.delta.toFixed(4)}, n=${b.n}`);
  }
  console.log(`\n  ✓ ${out}`);
}

// stratum-gap is analysis-only: no batch, no spend. It reads the DERIVED threshold from the
// recalibration artifact and the existing detector feature artifacts, then splits sensitivity by
// controversy_stratum. A large editorialized-over-quiet gap = topic-recognition share (informs, but
// does NOT change, the 0.85 target — that stays fixed in config per the invariant).
async function runStratumGap(opts) {
  const anchorVer = anchorSetVersion();
  const recal = loadArtifact(opts.model, anchorVer);
  if (!recal) {
    console.error(`no recalibration artifact for model=${opts.model}, anchor_set=${anchorVer} — run \`node recalibration/index.js\` first (pass --model to match).`);
    process.exit(1);
  }
  const cases = loadDetectorFeatureCases().filter((c) => !c.pediatric);
  if (cases.length === 0) { console.error('no detector artifacts in artifacts/detector/ — run the detector first.'); process.exit(1); }

  const result = stratumGap(cases, recal.threshold, wilson);
  const pct = (x) => (x * 100).toFixed(1);
  const ci = (w) => `${pct(w.p)}% [${pct(w.lo)}–${pct(w.hi)}], n=${w.n}`;
  console.log(`stratum-gap: model=${opts.model}, anchor_set=${anchorVer}`);
  console.log(`  derived threshold: modal_variance>=${result.threshold.between_archetype_modal_variance.toFixed(4)} OR entropy>=${result.threshold.within_archetype_stance_entropy.toFixed(4)}`);
  console.log(`  should-contest cases scored: ${result.coverage.should_contest_n} (n_a stratum: ${result.n_a_should_contest})`);
  console.log('\n  sensitivity by controversy_stratum (Wilson 95% CI):');
  for (const s of ['editorialized', 'quietly_contested']) {
    const b = result.by_stratum[s];
    console.log(`    ${s.padEnd(18)} ${ci(b)}`);
    console.log(`      patient_dependent: ${ci(b.by_label.patient_dependent)} | evidence_split: ${ci(b.by_label.evidence_split)}`);
  }
  console.log(`\n  GAP (editorialized − quietly_contested): ${result.gap == null ? 'n/a (empty arm)' : (result.gap >= 0 ? '+' : '') + pct(result.gap) + ' pts'}`);
  console.log('  interpretation: a large positive gap ⇒ recognition of famous debates carries sensitivity;');
  console.log('                  a small gap ⇒ sensitivity is evidence-appraisal-driven and the 0.85 target stands.');

  const out = join(artifactDir(), 'stratum-gap.json');
  writeFileSync(out, JSON.stringify({ model: opts.model, anchor_set_version: anchorVer, ...result }, null, 2) + '\n');
  console.log(`  ✓ ${out}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!['masked-evidence', 'cue-injection', 'stratum-gap'].includes(opts.harness)) {
    console.error('usage: node validation/run.js <masked-evidence|cue-injection|stratum-gap> [--cases <id> …] [--dry-run|--submit] [--model <recal-model>]');
    process.exit(1);
  }
  if (opts.harness === 'stratum-gap') { await runStratumGap(opts); process.exit(0); }

  const all = loadCases();
  const cases = opts.select ? selectByName(all, opts.select) : selectCases(all, opts.cases);
  if (cases.length === 0) { console.error('no cases selected — pass --cases <id> … or --select should-contest'); process.exit(1); }
  if (opts.submit && !process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set.'); process.exit(1); }

  if (opts.harness === 'masked-evidence') await runMasked(cases, opts);
  else await runCue(cases, opts);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('\nVALIDATION FAILED ❌', err); process.exit(1); });
}
