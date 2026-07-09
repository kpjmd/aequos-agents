#!/usr/bin/env node
/**
 * Recalibration loop — the part that survives model upgrades. The threshold is DERIVED here from the
 * anchor set, never declared in detector code. Level 1 re-fits the cutoff to recover the target
 * operating point and ships as a RELEASE GATE.
 *
 *   node recalibration/index.js --model claude-sonnet-4-6 [--from artifacts|panel-runs] [--dry-run]
 *
 * Sources of the detector feature vectors:
 *   --from artifacts   (default) read artifacts/detector/*.json (fresh detector runs)
 *   --from panel-runs  rehearse on stored benchmark_probe runs (PARTIAL feature set — see replay.js)
 *
 * On success, persists {threshold, reference_distribution, calibration_maps, gate_passed,
 * achieved_*} keyed by (model_version, anchor_set_version). On gate failure it throws loudly.
 */
import dotenv from 'dotenv';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases, loadTargetOperatingPoint, anchorSetVersion } from '../anchor-set/index.js';
import { deriveThreshold } from './levels/level1.js';
import { assertGate, GateError } from './gate.js';
import { saveArtifact } from './artifacts.js';

dotenv.config();

/**
 * Core entry point (also unit-testable): derive + gate + assemble the artifact.
 * @param {string} modelVersion
 * @param {string} anchorSetVer
 * @param {{cases:Array, target:object, partial?:object}} inputs - cases already carry {label, absolute, pediatric, features}
 * @returns {{threshold, reference_distribution, calibration_maps, gate_passed, achieved_sensitivity, achieved_specificity, model_version, anchor_set_version, partial}}
 */
export function recalibrate(modelVersion, anchorSetVer, { cases, target, partial = null }) {
  const derived = deriveThreshold(cases, target);
  const artifact = {
    model_version: modelVersion,
    anchor_set_version: anchorSetVer,
    threshold: derived.threshold,
    reference_distribution: derived.reference_distribution,
    calibration_maps: null, // Level 3 stub
    gate_passed: derived.gate_passed,
    achieved_sensitivity: derived.achieved_sensitivity,
    achieved_specificity: derived.achieved_specificity,
    coverage: derived.coverage,
    sweep_size: derived.sweep_size,
    partial,
  };
  return artifact;
}

/** Load fresh detector artifacts and join them to anchor-case labels. */
function loadFromArtifacts() {
  const dir = join(process.cwd(), 'artifacts', 'detector');
  if (!existsSync(dir)) return [];
  const byId = new Map(loadCases().map((c) => [c.id, c]));
  const cases = [];
  const seen = new Set();
  // Prefer the most recent artifact per case (files are <id>-<batch>.json; last write wins by sort).
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const art = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const c = byId.get(art.case_id);
    if (!c) continue;
    seen.add(art.case_id);
    // Overwrite earlier entries for the same case (keeps the latest batch).
    const idx = cases.findIndex((x) => x.id === art.case_id);
    const row = {
      id: art.case_id,
      label: c.label,
      absolute: Boolean(c.provenance?.absolute_indication),
      pediatric: Boolean(c.provenance?.is_pediatric),
      features: art.features,
    };
    if (idx >= 0) cases[idx] = row; else cases.push(row);
  }
  return cases;
}

async function main() {
  const argv = process.argv.slice(2);
  const model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6');
  const from = argv.includes('--from') ? argv[argv.indexOf('--from') + 1] : 'artifacts';
  const dryRun = argv.includes('--dry-run');

  const cfg = loadTargetOperatingPoint();
  const target = { targetSensitivity: cfg.target_sensitivity, minSpecificity: cfg.min_specificity };
  const anchorVer = anchorSetVersion();

  let cases;
  let partial = null;
  if (from === 'panel-runs') {
    const sql = (await import('../src/utils/db.js')).default;
    if (!sql) { console.error('DATABASE_URL not set — --from panel-runs needs the DB.'); process.exit(1); }
    const { replayFromPanelRuns } = await import('./replay.js');
    ({ cases, partial } = await replayFromPanelRuns(sql));
  } else {
    cases = loadFromArtifacts();
    if (cases.length === 0) {
      console.error('no detector artifacts in artifacts/detector/ — run `node detector/index.js --submit …` first, or use --from panel-runs.');
      process.exit(1);
    }
  }

  console.log(`recalibrate: model=${model}, anchor_set=${anchorVer}, from=${from}, ${cases.length} case(s)`);
  console.log(`  target_sensitivity=${target.targetSensitivity}, min_specificity=${target.minSpecificity}`);
  if (partial) console.log(`  ⚠︎ PARTIAL feature set (${partial.source}): cannot compute ${partial.not_computable.join('; ')}`);

  const artifact = recalibrate(model, anchorVer, { cases, target, partial });
  console.log(`\n  derived threshold: modal_variance>=${artifact.threshold.between_archetype_modal_variance.toFixed(4)} OR entropy>=${artifact.threshold.within_archetype_stance_entropy.toFixed(4)}`);
  console.log(`  achieved: sensitivity=${artifact.achieved_sensitivity.toFixed(3)}, specificity=${artifact.achieved_specificity.toFixed(3)} (over n=${artifact.coverage.should_contest_n} should-contest / ${artifact.coverage.settled_control_n} settled controls)`);
  console.log(`  equivalent-options lability coverage: ${artifact.coverage.equivalent_options_lability_covered}/${artifact.coverage.equivalent_options_n}`);

  if (!dryRun) {
    const p = saveArtifact(model, anchorVer, artifact);
    console.log(`  ✓ artifact saved: ${p}`);
  } else {
    console.log('  (dry-run — artifact not persisted)');
  }

  try {
    assertGate(artifact, target, { modelVersion: model, anchorSetVersion: anchorVer });
    console.log('\nGATE PASSED ✅ — this model version meets the target on the anchor set.');
    process.exit(0);
  } catch (e) {
    if (e instanceof GateError) {
      console.error(`\n${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('\nRECALIBRATION FAILED ❌', err); process.exit(1); });
}
