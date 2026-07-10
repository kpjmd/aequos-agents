/**
 * Recalibration Level 2 — percentile / z-score references.
 *
 * Level 1 derives an ABSOLUTE cutoff (mv/entropy thresholds). That cutoff is correct for the model
 * version it was fit on, but a model upgrade can shift a feature's whole distribution up or down; an
 * absolute threshold then silently drifts. Level 2 expresses each feature as its RANK against the
 * anchor-set reference distribution for this model version, so relative ordering survives a uniform
 * shift. It is additive context — it never re-derives or replaces the Level 1 gate.
 *
 * No new operating-point constants are introduced: percentiles and z-scores are pure functions of the
 * reference distribution that Level 1 already emitted.
 */

const FEATURES = ['modal_variance', 'stance_entropy', 'lability', 'confidence'];

/** Fraction of the (ascending, non-null) reference at or below x, in [0,1]. Empty reference → null. */
export function percentileRank(sorted, x) {
  if (!sorted || sorted.length === 0 || x == null || Number.isNaN(x)) return null;
  let le = 0;
  for (const v of sorted) if (v <= x) le++;
  return le / sorted.length;
}

/** Standard score. Zero/absent spread → 0 (no information to separate on). */
export function zscore(mean, std, x) {
  if (x == null || Number.isNaN(x) || mean == null || !std) return 0;
  return (x - mean) / std;
}

function meanStd(xs) {
  if (xs.length === 0) return { mean: null, std: 0, n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(variance), n: xs.length };
}

/**
 * Pool each feature's per-label arrays (from Level 1's reference_distribution) into ONE reference,
 * dropping nulls, and precompute the sorted values + mean/std needed to map a live case later.
 * @param {object} referenceDistribution - per-label {modal_variance:[], stance_entropy:[], lability:[], confidence:[]}
 * @returns {object} per-feature {sorted:number[], mean:number|null, std:number, n:number}
 */
export function buildLevel2Reference(referenceDistribution) {
  const ref = {};
  for (const f of FEATURES) {
    const pooled = [];
    for (const label of Object.keys(referenceDistribution || {})) {
      for (const v of referenceDistribution[label][f] || []) {
        if (v != null && !Number.isNaN(v)) pooled.push(v);
      }
    }
    pooled.sort((a, b) => a - b);
    ref[f] = { sorted: pooled, ...meanStd(pooled) };
  }
  return ref;
}

/**
 * Map a raw detector feature vector to percentile ranks + z-scores against the pooled reference.
 * @param {object} referenceDistribution - Level 1 reference_distribution (per-label arrays)
 * @param {object} features - a case's feature vector (detector shape)
 * @returns {{percentiles:object, z_scores:object}}
 */
export function level2(referenceDistribution, features) {
  const ref = buildLevel2Reference(referenceDistribution);
  const raw = {
    modal_variance: features?.between_archetype_modal_variance ?? 0,
    stance_entropy: features?.within_archetype_stance_entropy ?? 0,
    lability: features?.choice_lability_rate ?? 0,
    confidence: features?.confidence?.mean ?? null,
  };
  const percentiles = {};
  const z_scores = {};
  for (const f of FEATURES) {
    percentiles[f] = percentileRank(ref[f].sorted, raw[f]);
    z_scores[f] = zscore(ref[f].mean, ref[f].std, raw[f]);
  }
  return { percentiles, z_scores };
}

export default level2;
