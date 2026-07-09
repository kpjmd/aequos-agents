/**
 * Recalibration Level 3 — per-agent calibration mapping (STUB; documented interface, not yet built).
 *
 * Fit a Platt / isotonic mapping raw_confidence -> empirical_accuracy per model version, so
 * "confidence" means the same thing across versions BY CONSTRUCTION. Requires an outcome signal
 * (empirical accuracy per confidence bucket) that this phase does not yet collect.
 *
 * @param {Array} features - per-case feature vectors
 * @param {Array} labels - matched ground-truth labels
 * @returns {{calibration_maps:object}}
 */
export function level3(/* features, labels */) {
  throw new Error('recalibration Level 3 (Platt/isotonic calibration) not yet implemented');
}

export default level3;
