#!/usr/bin/env node
/**
 * Unified equipoise detector — STUB (features only, NO threshold, NO verdict).
 *
 * For EVERY case it samples the unified grid (patient_archetype × agent × replicate × option_order),
 * then emits the four behavioral features + raw confidence. It never thresholds and never decides
 * contested/settled — /recalibration/ derives thresholds later from these artifacts. Self-reported
 * confidence is one feature among several, never load-bearing.
 *
 *   node detector/index.js --dry-run --cases <id> [<id> …] [--replicates 2]   # grid + cost, no spend
 *   node detector/index.js --submit  --cases <id> [<id> …] [--replicates 2] [--store]
 *   node detector/index.js --submit  --all --replicates 2                     # every active case
 *   node detector/index.js --replay <batchId> --cases <id> …                  # re-ingest a batch
 *
 * Default is DRY RUN; --submit is required to spend. --store persists to detector_feature_runs.
 */
import dotenv from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases, isActive, anchorSetVersion } from '../anchor-set/index.js';
import { computeFeatures } from './features.js';
import { gridShape, requestsPerCase, AGENTS } from './grid.js';
import { compositionMeta, DEFAULT_COMPOSITION, modelMap } from './panel-composition.js';
import { countRequests } from './transport.js';

dotenv.config();

const POSITION_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const SAMPLING = { api_seed_supported: false, temperature: 0.3, note: 'iid replicate draws at temperature>0 — the Anthropic API has no sampling seed, so replicate_index is a draw index, not a reproducible seed' };

/**
 * Assemble the detector artifact for one case (pure — used by index + tests).
 * @param {object} caseObj - anchor case
 * @param {Array} cells - normalized grid cells (stance 'A'|'B'|'defer'|'unknown')
 * @param {{replicates, composition, modelVersion, anchorSetVersion, dataCompleteness}} meta
 */
export function buildArtifact(caseObj, cells, meta) {
  const comp = compositionMeta(meta.composition || DEFAULT_COMPOSITION);
  return {
    case_id: caseObj.id,
    anchor_set_version: meta.anchorSetVersion,
    model_version: meta.modelVersion,
    panel_composition: comp.id,
    pseudo_replicated: comp.pseudo_replicated,
    // per-agent model map for a decorrelated panel (null for single-model) — full audit of which
    // model produced each slot's stances.
    panel_models: meta.models || null,
    grid: gridShape(meta.replicates),
    sampling: SAMPLING,
    // Anchor cases are curated vignettes → completeness 1.0 by construction; the field is carried for
    // production use later, where equipoise must NOT be conflated with low input completeness.
    data_completeness: meta.dataCompleteness ?? 1.0,
    features: computeFeatures(cells),
    raw: { cells },
  };
}

function parseArgs(argv) {
  const o = { cases: [], replicates: 2, dryRun: true, submit: false, store: false, all: false, replay: null, composition: DEFAULT_COMPOSITION };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--submit') { o.submit = true; o.dryRun = false; }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--store') o.store = true;
    else if (a === '--all') o.all = true;
    else if (a === '--composition') o.composition = argv[++i];
    else if (a === '--replicates') o.replicates = Math.max(1, parseInt(argv[++i], 10) || 2);
    else if (a === '--replay') { o.replay = argv[++i]; o.submit = true; o.dryRun = false; }
    else if (a === '--cases') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) o.cases.push(argv[++i]); }
  }
  return o;
}

function selectCases(all, opts) {
  const active = all.filter(isActive);
  if (opts.all) return active;
  if (opts.cases.length) {
    const byId = new Map(all.map((c) => [c.id, c]));
    return opts.cases.map((id) => byId.get(id)).filter(Boolean);
  }
  return [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const all = loadCases();
  const cases = selectCases(all, opts);
  if (cases.length === 0) {
    console.error('no cases selected — pass --cases <id> … or --all');
    process.exit(1);
  }

  const comp = compositionMeta(opts.composition); // throws loudly on an unknown composition id
  const models = modelMap(opts.composition, AGENTS, POSITION_MODEL);
  const modelVersionLabel = opts.composition === DEFAULT_COMPOSITION ? POSITION_MODEL : opts.composition;

  const shape = gridShape(opts.replicates);
  const perCase = requestsPerCase(opts.replicates);
  console.log(`detector: ${cases.length} case(s) — grid ${shape.archetypes}×${shape.agents}×${shape.replicates}×${shape.orders} = ${perCase} calls/case`);
  console.log(`  composition=${comp.id} (pseudo_replicated=${comp.pseudo_replicated})`);
  if (opts.composition === DEFAULT_COMPOSITION) {
    console.log(`  model=${POSITION_MODEL} (single-model panel)`);
  } else {
    console.log(`  per-agent models: ${AGENTS.map((a) => `${a}=${models[a]}`).join(', ')}`);
  }

  if (opts.dryRun) {
    console.log(`\nDRY RUN — ${countRequests(cases, opts.replicates, null)} Anthropic request(s) total, submitted as one Message Batch (50% off).`);
    console.log('  emits 4 features (between-archetype modal variance, within-archetype entropy, choice lability, confidence) — NO threshold, NO verdict.');
    console.log('  re-run with --submit to spend.');
    process.exit(0);
  }

  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set.'); process.exit(1); }

  // Construct the panel (mirrors benchmark-probe.js; no blockchain side effects).
  const { TriageAgent } = await import('../src/agents/triage-agent.js');
  const { PainWhispererAgent } = await import('../src/agents/pain-whisperer-agent.js');
  const { MovementDetectiveAgent } = await import('../src/agents/movement-detective-agent.js');
  const { StrengthSageAgent } = await import('../src/agents/strength-sage-agent.js');
  const { MindMenderAgent } = await import('../src/agents/mind-mender-agent.js');
  const { runBatch } = await import('./transport.js');

  const specialists = new Map([
    ['triage', new TriageAgent('OrthoTriage Master')],
    ['painWhisperer', new PainWhispererAgent('Pain Whisperer')],
    ['movementDetective', new MovementDetectiveAgent('Movement Detective')],
    ['strengthSage', new StrengthSageAgent('Strength Sage')],
    ['mindMender', new MindMenderAgent('Mind Mender')],
  ]);

  const maxTokens = parseInt(process.env.MAX_TOKENS, 10) || 2500;
  const { cellsByCase, batchId } = await runBatch(
    cases,
    { replicates: opts.replicates, model: POSITION_MODEL, maxTokens, composition: opts.composition, resumeBatchId: opts.replay },
    { specialists }
  );

  const meta = {
    replicates: opts.replicates,
    composition: opts.composition,
    models: opts.composition === DEFAULT_COMPOSITION ? null : models,
    modelVersion: modelVersionLabel,
    anchorSetVersion: anchorSetVersion(),
  };
  const artifacts = cases.map((c) => buildArtifact(c, cellsByCase.get(c.id) || [], meta));

  const dir = join(process.cwd(), 'artifacts', 'detector');
  mkdirSync(dir, { recursive: true });
  for (const art of artifacts) {
    writeFileSync(join(dir, `${art.case_id}-${batchId}.json`), JSON.stringify(art, null, 2) + '\n');
    const f = art.features;
    console.log(`  ${art.case_id.padEnd(48)} bmv=${f.between_archetype_modal_variance.toFixed(3)} ent=${f.within_archetype_stance_entropy.toFixed(3)} lab=${f.choice_lability_rate.toFixed(3)} conf=${f.confidence.mean.toFixed(3)}`);
  }
  console.log(`\n✓ ${artifacts.length} feature artifact(s) → ${dir}`);

  if (opts.store) {
    const { storeFeatureRuns } = await import('./store.js');
    const n = await storeFeatureRuns(artifacts, { modelVersion: modelVersionLabel });
    console.log(`✓ stored ${n} row(s) in detector_feature_runs`);
  }
  process.exit(0);
}

// Only run as a CLI (allow importing buildArtifact in tests without executing).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('\nDETECTOR FAILED ❌', err); process.exit(1); });
}
