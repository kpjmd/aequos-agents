/**
 * Later validation experiments — they slot into the same transport/analyze scaffolding without
 * restructuring. These quantify how much of the confidence signal is genuine evidence appraisal vs mere
 * topic-recognition (which is circular with literature-derived labels). Run them before trusting any
 * confidence-based signal.
 *
 * stratumGap is IMPLEMENTED (pure analysis over existing detector artifacts — no spend). temporalHoldout
 * and mechanismProbe remain stubs pending curated data / a grounding cache and a fresh batch run.
 */

const SHOULD_CONTEST = new Set(['patient_dependent', 'evidence_split']);

/**
 * Stratum gap: detector sensitivity on `editorialized` vs `quietly_contested` should-contest cases.
 * A large editorialized-over-quiet gap means the detector partly recognizes FAMOUS debates rather than
 * appraising evidence — that recognition share is the only thing that would justify revisiting the 0.85
 * target. Pure function over cases already carrying features + the DERIVED threshold (read from the
 * recalibration artifact upstream; never a fresh constant here).
 *
 * @param {Array<{id, label, controversy_stratum, features}>} cases
 * @param {{between_archetype_modal_variance:number, within_archetype_stance_entropy:number}} threshold
 * @param {(successes:number, n:number)=>object} wilson - CI helper (injected from recalibration/report.js)
 * @returns {{by_stratum:object, gap:number|null, threshold:object, n_a_should_contest:number, coverage:object}}
 */
export function stratumGap(cases, threshold, wilson) {
  const tv = threshold.between_archetype_modal_variance;
  const te = threshold.within_archetype_stance_entropy;
  const fires = (c) =>
    (c.features?.between_archetype_modal_variance ?? 0) >= tv ||
    (c.features?.within_archetype_stance_entropy ?? 0) >= te;

  const should = cases.filter((c) => SHOULD_CONTEST.has(c.label) && c.features);
  const strata = ['editorialized', 'quietly_contested'];
  const by_stratum = {};
  for (const s of strata) {
    const arm = should.filter((c) => c.controversy_stratum === s);
    const fired = arm.filter(fires);
    const by_label = {};
    for (const label of SHOULD_CONTEST) {
      const la = arm.filter((c) => c.label === label);
      by_label[label] = wilson(la.filter(fires).length, la.length);
    }
    by_stratum[s] = { ...wilson(fired.length, arm.length), by_label, fired_ids_missed: arm.filter((c) => !fires(c)).map((c) => c.id) };
  }

  const gap =
    by_stratum.editorialized.n && by_stratum.quietly_contested.n
      ? by_stratum.editorialized.p - by_stratum.quietly_contested.p
      : null;

  return {
    by_stratum,
    gap,
    threshold: { between_archetype_modal_variance: tv, within_archetype_stance_entropy: te },
    n_a_should_contest: should.filter((c) => c.controversy_stratum === 'n_a').length,
    coverage: { should_contest_n: should.length },
  };
}

/**
 * Temporal holdout: decision points whose equipoise status FLIPPED after the model's training cutoff.
 * An appraiser updates when handed the new trial in-context; a pattern-matcher doesn't. Deferred: needs
 * a curated post-cutoff flip set + the trial text to inject in-context, plus a fresh batch run.
 */
export function temporalHoldout() {
  throw new Error('validation: temporal-holdout experiment not yet implemented (needs post-cutoff flip set + in-context trial injection)');
}

/**
 * Mechanism probe: require each agent to enumerate the specific trials/guidelines behind its evidence
 * grade BEFORE stating confidence; audit that citations are real and grades match an independent GRADE
 * assessment. Deferred: depends on the /grounding/ evidence-table cache (to audit enumerated citations
 * against real ones) + a fresh batch run.
 */
export function mechanismProbe() {
  throw new Error('validation: mechanism-probe experiment not yet implemented (needs grounding-cache citation audit + GRADE check)');
}

export default { stratumGap, temporalHoldout, mechanismProbe };
