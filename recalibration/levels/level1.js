/**
 * Recalibration Level 1 — re-derive the operating threshold(s) from the anchor set.
 *
 * The threshold is DERIVED output, never a declared constant. On a new model version you run the
 * anchor set through the detector and re-fit the cutoff to recover the target operating point; if no
 * cutoff hits the target, the release gate fails loudly (that IS the upgrade-broke-the-detector signal).
 *
 * Level-1 rule (a genuine two-signal fusion, not a single magic number): a case is FLAGGED contested if
 *   between_archetype_modal_variance >= t_v   (patient-dependent signal)
 *   OR within_archetype_stance_entropy >= t_e (evidence-split signal)
 * We sweep (t_v, t_e) over the values present in the data and pick the operating point that MAXIMIZES
 * specificity subject to sensitivity >= target. choice_lability (the equivalent-options signal) is
 * reported as separate coverage, not folded into the gate: equivalent_options is deliberately excluded
 * from the sensitivity target (a forced pick looks confident), so it must not inflate/deflate the gate.
 *
 * Sensitivity segment = should-contest = {patient_dependent, evidence_split}. Specificity segment =
 * settled AND NOT absolute_indication. Absolute cases are segmented (a contested verdict there routes to
 * surgery — product-safe), never scored as equipoise. Per-case majority is already baked into the
 * feature artifact (features are computed over the whole grid), so scoring is one row per case.
 */

const SHOULD_CONTEST = new Set(['patient_dependent', 'evidence_split']);

const uniqSorted = (xs) => [...new Set(xs)].sort((a, b) => a - b);

/** Candidate thresholds for a feature: each present value, plus a tick below the minimum (fire-all). */
function candidates(values) {
  const u = uniqSorted(values);
  if (u.length === 0) return [0];
  return [u[0] - 1e-9, ...u];
}

/**
 * @param {Array<{id, label, absolute, features:{between_archetype_modal_variance, within_archetype_stance_entropy, choice_lability_rate}}>} cases
 * @param {{targetSensitivity:number, minSpecificity:number}} target
 * @returns {{threshold, gate_passed, achieved_sensitivity, achieved_specificity, reference_distribution, sweep_size, coverage}}
 */
export function deriveThreshold(cases, { targetSensitivity, minSpecificity }) {
  const scored = cases.filter((c) => c.label && !c.pediatric);
  const should = scored.filter((c) => SHOULD_CONTEST.has(c.label));
  const settledCtrl = scored.filter((c) => c.label === 'settled' && !c.absolute);

  const tvs = candidates(scored.map((c) => c.features.between_archetype_modal_variance ?? 0));
  const tes = candidates(scored.map((c) => c.features.within_archetype_stance_entropy ?? 0));

  const fires = (c, tv, te) =>
    (c.features.between_archetype_modal_variance ?? 0) >= tv ||
    (c.features.within_archetype_stance_entropy ?? 0) >= te;

  let best = null; // best point meeting BOTH constraints (max specificity)
  let bestJ = null; // diagnostic when the gate can't be met: the best-SEPARATING point (max Youden J)

  for (const tv of tvs) {
    for (const te of tes) {
      const sens = should.length ? should.filter((c) => fires(c, tv, te)).length / should.length : 0;
      const spec = settledCtrl.length ? settledCtrl.filter((c) => !fires(c, tv, te)).length / settledCtrl.length : 1;
      const j = sens + spec - 1; // Youden's J — rewards a real separator, not a fire-all corner
      if (!bestJ || j > bestJ.j) bestJ = { tv, te, sens, spec, j };
      if (sens >= targetSensitivity && spec >= minSpecificity) {
        if (!best || spec > best.spec || (spec === best.spec && sens > best.sens)) best = { tv, te, sens, spec };
      }
    }
  }

  const chosen = best || bestJ || { tv: 0, te: 0, sens: 0, spec: 0 };
  const gate_passed = Boolean(best);

  // equivalent-options coverage via lability (reported, not gated).
  const equiv = scored.filter((c) => c.label === 'equivalent_options');
  const equivCovered = equiv.filter((c) => (c.features.choice_lability_rate ?? 0) > 0).length;

  return {
    threshold: { between_archetype_modal_variance: chosen.tv, within_archetype_stance_entropy: chosen.te },
    gate_passed,
    achieved_sensitivity: chosen.sens,
    achieved_specificity: chosen.spec,
    reference_distribution: referenceDistribution(scored),
    sweep_size: tvs.length * tes.length,
    coverage: {
      should_contest_n: should.length,
      settled_control_n: settledCtrl.length,
      equivalent_options_n: equiv.length,
      equivalent_options_lability_covered: equivCovered,
    },
  };
}

/** Per-label feature distributions — Level 2 converts these to percentile/z-score references. */
function referenceDistribution(cases) {
  const byLabel = {};
  for (const c of cases) {
    if (!byLabel[c.label]) byLabel[c.label] = { modal_variance: [], stance_entropy: [], lability: [], confidence: [] };
    byLabel[c.label].modal_variance.push(c.features.between_archetype_modal_variance ?? 0);
    byLabel[c.label].stance_entropy.push(c.features.within_archetype_stance_entropy ?? 0);
    byLabel[c.label].lability.push(c.features.choice_lability_rate ?? 0);
    byLabel[c.label].confidence.push(c.features.confidence?.mean ?? null);
  }
  return byLabel;
}

export default deriveThreshold;
