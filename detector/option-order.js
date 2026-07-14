/**
 * Option-order permutation + canonical stance normalization.
 *
 * The choice-lability feature (the equivalent-options signal) measures whether the panel's pick flips
 * when the two options are presented in the opposite order. This is the ONE place order is handled, so
 * the correctness invariant lives here:
 *
 *   The stance enum is LABEL TEXT (makePositionSchema builds enum([...options,'defer'])), so a returned
 *   stance parses to the same canonical option REGARDLESS of the order it was listed in. Lability MUST
 *   be keyed off the canonical option ('A'/'B' = options[0]/[1]), never off the enum index / list
 *   position — otherwise a pure presentation swap looks like a flip and every case is spuriously labile.
 *
 * `orderedOptions` produces the option list to SHOW the model; `canonicalize` maps whatever label the
 * model returns back to 'A' | 'B' | 'defer' using the case's canonical option[0]/[1].
 */
export const ORDERS = ['AB', 'BA'];

/**
 * The option list to present for a given order. Canonical A = options[0], B = options[1].
 * @param {string[]} options - canonical [A, B]
 * @param {'AB'|'BA'} order
 * @returns {string[]}
 */
export function orderedOptions(options, order) {
  const [a, b] = options;
  return order === 'BA' ? [b, a] : [a, b];
}

/**
 * Map a returned stance label to the canonical code. Order-independent by construction (compares the
 * label string to the canonical options), so it is correct whether the model saw AB or BA.
 * @param {string} stance - the label the model returned (or 'defer')
 * @param {string[]} options - canonical [A, B]
 * @returns {'A'|'B'|'defer'|'unknown'}
 */
export function canonicalize(stance, options) {
  if (stance === 'defer' || stance == null) return 'defer';
  if (stance === options[0]) return 'A';
  if (stance === options[1]) return 'B';
  // Defensive: a model that paraphrases the label (should not happen under enum-constrained tool use).
  const s = String(stance).trim().toLowerCase();
  if (s === String(options[0]).trim().toLowerCase()) return 'A';
  if (s === String(options[1]).trim().toLowerCase()) return 'B';
  return 'unknown';
}

export default canonicalize;
