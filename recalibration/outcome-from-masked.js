/**
 * Outcome adapter: turn a masked-evidence validation artifact into the per-agent (confidence, correct)
 * pairs that Level 3 needs.
 *
 * The detector features carry no ground truth, so per-agent confidence calibration has nowhere to
 * anchor. The masked-evidence harness supplies it: the fabricated <evidence_summary> has a KNOWN
 * effect_direction ('A'|'B'), so on direction-eligible rows the correct stance is that direction and
 * correct = (stance === effect_direction). 'none'-direction rows have no correct pick and are dropped.
 *
 * This is a pure reader — it runs only once a masked-evidence run has been submitted and written to
 * artifacts/validation/masked-evidence-<batch>.json. Until then, recalibrate() gets no outcomePairs and
 * Level 3 stays inert.
 */
import { readFileSync } from 'node:fs';

/**
 * @param {string} artifactPath - path to a masked-evidence-<batch>.json produced by validation/run.js
 * @returns {Array<{agent:string, confidence:number, correct:0|1}>}
 */
export function outcomePairsFromMaskedArtifact(artifactPath) {
  const parsed = JSON.parse(readFileSync(artifactPath, 'utf8'));
  return outcomePairsFromRows(parsed.rows || []);
}

/**
 * @param {Array<{agent?:string, confidence:number, stance:string, evidenceStructure:{effect_direction:string}}>} rows
 * @returns {Array<{agent:string, confidence:number, correct:0|1}>}
 */
export function outcomePairsFromRows(rows) {
  const pairs = [];
  for (const r of rows) {
    const dir = r?.evidenceStructure?.effect_direction;
    if (dir !== 'A' && dir !== 'B') continue; // no ground-truth-correct option on 'none'
    if (typeof r.confidence !== 'number') continue;
    pairs.push({ agent: r.agent || 'unknown', confidence: r.confidence, correct: r.stance === dir ? 1 : 0 });
  }
  return pairs;
}

export default outcomePairsFromMaskedArtifact;
