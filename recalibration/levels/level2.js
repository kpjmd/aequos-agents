/**
 * Recalibration Level 2 — scale-free signal (STUB; documented interface, not yet implemented).
 *
 * Convert absolute feature values to a PERCENTILE / z-score against the anchor-set reference
 * distribution for THIS model version. Ordering (contested-below-settled on confidence, etc.) survives
 * a uniform confidence shift that an absolute cutoff does not — this is the first line of defense when a
 * model upgrade slides the whole confidence distribution.
 *
 * @param {object} referenceDistribution - per-label feature arrays from Level 1
 * @param {object} features - a case's feature vector
 * @returns {{percentiles:object}}
 */
export function level2(/* referenceDistribution, features */) {
  throw new Error('recalibration Level 2 (percentile/z-score) not yet implemented — Level 1 is the current gate');
}

export default level2;
