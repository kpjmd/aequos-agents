/**
 * Per-class + confidence-interval + entropy-lift REPORTING over the recalibration result.
 *
 * This module never derives or declares a threshold — it reports on the DERIVED operating point from
 * levels/level1.js. It answers three questions the aggregate should-contest number can't:
 *   1. How does sensitivity break down by class (patient_dependent vs evidence_split)?
 *   2. What is the uncertainty on each rate (Wilson 95% CI — the small anchor arms, esp. the ~18
 *      evidence_split cases, make point estimates misleading)?
 *   3. Does the within-archetype entropy feature add any lift on evidence_split OVER modal variance
 *      alone, or does modal variance already carry it (the pre-check found entropy inert on a
 *      pseudo-replicated panel — this is how we tell whether decorrelation woke it up)?
 *
 * The fire rule and segments mirror levels/level1.js exactly so the report describes the same gate.
 */

const SHOULD_CONTEST = new Set(['patient_dependent', 'evidence_split']);

const mv = (c) => c.features.between_archetype_modal_variance ?? 0;
const ent = (c) => c.features.within_archetype_stance_entropy ?? 0;

/** A case flags contested if modal variance >= t_v OR entropy >= t_e (matches level1.fires). */
const fires = (c, tv, te) => mv(c) >= tv || ent(c) >= te;

const uniqSorted = (xs) => [...new Set(xs)].sort((a, b) => a - b);
/** Candidate thresholds: each present value plus a tick below the minimum (fire-all corner). */
function candidates(values) {
  const u = uniqSorted(values);
  if (u.length === 0) return [0];
  return [u[0] - 1e-9, ...u];
}

/**
 * Wilson score interval for a binomial proportion — well-behaved at small n and near 0/1, unlike the
 * normal approximation. Returns the point estimate and 95% (z=1.96) bounds by default.
 * @param {number} successes
 * @param {number} n
 * @param {number} [z]
 * @returns {{p:number, lo:number, hi:number, successes:number, n:number}}
 */
export function wilson(successes, n, z = 1.96) {
  if (n === 0) return { p: 0, lo: 0, hi: 1, successes: 0, n: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { p, lo: Math.max(0, center - margin), hi: Math.min(1, center + margin), successes, n };
}

/**
 * Entropy-lift ablation on the evidence_split arm, evaluated at the chosen operating threshold, plus a
 * modal-variance-ONLY re-derivation for context.
 * @param {Array} scored - non-pediatric labelled cases
 * @param {{tv:number, te:number}} chosen - the derived operating point
 * @param {{targetSensitivity:number, minSpecificity:number}} target
 */
function entropyLift(scored, chosen, target) {
  const es = scored.filter((c) => c.label === 'evidence_split');
  const should = scored.filter((c) => SHOULD_CONTEST.has(c.label));
  const settled = scored.filter((c) => c.label === 'settled' && !c.absolute);

  // At the CHOSEN threshold: full (mv OR ent) vs modal-only (mv alone), and the cases entropy
  // uniquely catches (fires on entropy but the modal signal is below its cutoff).
  const firedFull = es.filter((c) => fires(c, chosen.tv, chosen.te));
  const firedModalOnly = es.filter((c) => mv(c) >= chosen.tv);
  const entropyUnique = es.filter((c) => ent(c) >= chosen.te && mv(c) < chosen.tv);

  // Modal-variance-only gate: sweep t_v with entropy disabled, pick the max-Youden-J point (and note
  // whether any modal-only point could even reach the target). This says whether a modal-only
  // detector would suffice — if it does, entropy is redundant on this panel.
  const tvs = candidates(scored.map(mv));
  let best = null;
  let bestAtTarget = null;
  for (const tv of tvs) {
    const sens = should.length ? should.filter((c) => mv(c) >= tv).length / should.length : 0;
    const spec = settled.length ? settled.filter((c) => mv(c) < tv).length / settled.length : 1;
    const j = sens + spec - 1;
    if (!best || j > best.j) best = { tv, sens, spec, j };
    if (sens >= target.targetSensitivity && spec >= target.minSpecificity) {
      if (!bestAtTarget || spec > bestAtTarget.spec) bestAtTarget = { tv, sens, spec };
    }
  }

  return {
    evidence_split_at_operating_point: {
      n: es.length,
      recall_full: es.length ? firedFull.length / es.length : 0,
      recall_modal_only: es.length ? firedModalOnly.length / es.length : 0,
      entropy_unique_count: entropyUnique.length,
      entropy_unique_ids: entropyUnique.map((c) => c.id),
      entropy_adds_lift: entropyUnique.length > 0,
    },
    modal_only_gate: {
      best_youden: best,
      best_at_target: bestAtTarget, // null → a modal-only detector cannot reach the target
      reaches_target: Boolean(bestAtTarget),
    },
  };
}

/**
 * Assemble the per-class + CI + entropy-lift report at the derived operating threshold.
 * @param {Array} cases - scored cases {id, label, absolute, pediatric, features}
 * @param {{between_archetype_modal_variance:number, within_archetype_stance_entropy:number}} threshold
 * @param {{targetSensitivity:number, minSpecificity:number}} target
 */
export function buildReport(cases, threshold, target) {
  const scored = cases.filter((c) => c.label && !c.pediatric);
  const tv = threshold.between_archetype_modal_variance;
  const te = threshold.within_archetype_stance_entropy;

  const per_class_sensitivity = {};
  for (const label of ['patient_dependent', 'evidence_split']) {
    const arm = scored.filter((c) => c.label === label);
    const fired = arm.filter((c) => fires(c, tv, te)).length;
    per_class_sensitivity[label] = { ...wilson(fired, arm.length) };
  }

  const settled = scored.filter((c) => c.label === 'settled' && !c.absolute);
  const quiet = settled.filter((c) => !fires(c, tv, te)).length;
  const specificity = { ...wilson(quiet, settled.length) };

  return {
    threshold: { between_archetype_modal_variance: tv, within_archetype_stance_entropy: te },
    per_class_sensitivity,
    specificity,
    entropy_lift: entropyLift(scored, { tv, te }, target),
  };
}

export default buildReport;
