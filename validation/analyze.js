/**
 * Analysis for the validation harnesses — pure functions over parsed results (testable).
 *
 *  - masked-evidence: does confidence/stance TRACK the supplied evidence structure? If confidence rises
 *    with GRADE certainty and stance follows the fabricated effect direction, the model can appraise.
 *  - cue-injection: confidence delta (cued − neutral) = the topic-recognition component.
 */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * @param {Array<{evidenceStructure:{effect_direction, certainty}, stance:'A'|'B'|'defer'|'unknown', confidence:number}>} rows
 * @returns {{n, confidenceByCertainty, confidenceTracksCertainty, stanceFollowsDirection, directionAgreement}}
 */
export function analyzeMasked(rows) {
  const byCertainty = { low: [], moderate: [], high: [] };
  let directionMatches = 0;
  let directionEligible = 0;
  for (const r of rows) {
    if (r.evidenceStructure?.certainty in byCertainty && typeof r.confidence === 'number') {
      byCertainty[r.evidenceStructure.certainty].push(r.confidence);
    }
    const dir = r.evidenceStructure?.effect_direction;
    if (dir === 'A' || dir === 'B') {
      directionEligible++;
      if (r.stance === dir) directionMatches++;
    }
  }
  const confidenceByCertainty = Object.fromEntries(Object.entries(byCertainty).map(([k, v]) => [k, mean(v)]));
  // Monotonic check: does mean confidence increase from low → moderate → high?
  const ranks = ['low', 'moderate', 'high'].filter((k) => byCertainty[k].length);
  let monotone = true;
  for (let i = 1; i < ranks.length; i++) {
    if (confidenceByCertainty[ranks[i]] < confidenceByCertainty[ranks[i - 1]]) monotone = false;
  }
  return {
    n: rows.length,
    confidenceByCertainty,
    confidenceTracksCertainty: monotone && ranks.length >= 2,
    directionAgreement: directionEligible ? directionMatches / directionEligible : null,
    stanceFollowsDirection: directionEligible > 0 && directionMatches / directionEligible >= 0.7,
  };
}

/**
 * @param {Array<{caseId, neutralConfidence:number, cuedConfidence:number}>} pairs
 * @returns {{n, meanDelta, perCase:Array}}
 */
export function analyzeCue(pairs) {
  const perCase = pairs.map((p) => ({ caseId: p.caseId, delta: (p.cuedConfidence ?? 0) - (p.neutralConfidence ?? 0) }));
  return { n: pairs.length, meanDelta: mean(perCase.map((p) => p.delta)), perCase };
}
