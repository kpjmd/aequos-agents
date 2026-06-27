/**
 * Pure, deterministic stratified sampler for the equipoise benchmark probe.
 *
 * Deterministic (no RNG) so a pilot run is reproducible: it takes the first N rows of each
 * decision_type in input order, then guarantees a floor of settled controls (the specificity
 * check — the panel should CONVERGE on these). Kept pure + side-effect-free for unit testing;
 * the runnable harness (scripts/benchmark-probe.js) imports it.
 */

// Default pilot composition (~20 DPs). which_operation is over-weighted on purpose: 41/87 of the
// genuine_equipoise set are technique-choice rows whose detectability is the key open question.
export const DEFAULT_PER_TYPE = {
  which_operation: 8,
  conservative_vs_operative: 8,
  timing_of_surgery: 2,
  which_intervention: 2,
};
export const DEFAULT_SETTLED_FLOOR = 2;

const isSettled = (label) =>
  label === 'settled_conservative' || label === 'settled_operative';

/**
 * @param {Array<{slug,decision_type,expected_equipoise}>} rows
 * @param {Object} [opts]
 * @param {Object<string,number>} [opts.perType] - desired count per decision_type
 * @param {number} [opts.settledFloor] - min settled_conservative AND min settled_operative
 * @param {number} [opts.limit] - overall cap (controls are preserved when trimming)
 * @returns {Array} the sampled rows (unique by slug)
 */
export function stratifiedSample(rows, opts = {}) {
  const perType = opts.perType || DEFAULT_PER_TYPE;
  const settledFloor = opts.settledFloor ?? DEFAULT_SETTLED_FLOOR;

  const picked = [];
  const seen = new Set();
  const add = (r) => {
    if (!seen.has(r.slug)) {
      picked.push(r);
      seen.add(r.slug);
    }
  };

  // 1. First N of each requested decision_type (input order — deterministic).
  for (const [type, n] of Object.entries(perType)) {
    rows.filter((r) => r.decision_type === type).slice(0, n).forEach(add);
  }

  // 2. Guarantee the settled-control floor for specificity.
  for (const label of ['settled_conservative', 'settled_operative']) {
    const have = picked.filter((r) => r.expected_equipoise === label).length;
    if (have < settledFloor) {
      rows
        .filter((r) => r.expected_equipoise === label && !seen.has(r.slug))
        .slice(0, settledFloor - have)
        .forEach(add);
    }
  }

  // 3. Apply an overall limit, preserving settled controls.
  if (opts.limit && picked.length > opts.limit) {
    const controls = picked.filter((r) => isSettled(r.expected_equipoise));
    const rest = picked.filter((r) => !isSettled(r.expected_equipoise));
    const room = Math.max(0, opts.limit - controls.length);
    return [...rest.slice(0, room), ...controls];
  }

  return picked;
}

export default stratifiedSample;
