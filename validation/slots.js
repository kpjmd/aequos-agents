/**
 * Later validation experiments — registered as documented no-op stubs so they slot into the same
 * transport/analyze scaffolding without restructuring. These quantify how much of the confidence signal
 * is genuine evidence appraisal vs mere topic-recognition (which is circular with literature-derived
 * labels). Run them before trusting any confidence-based signal.
 */

/**
 * Temporal holdout: decision points whose equipoise status FLIPPED after the model's training cutoff.
 * An appraiser updates when handed the new trial in-context; a pattern-matcher doesn't.
 */
export function temporalHoldout() {
  throw new Error('validation: temporal-holdout experiment not yet implemented (needs post-cutoff flip set + in-context trial injection)');
}

/**
 * Stratum gap: sensitivity on editorialized vs quietly_contested strata. The gap estimates the
 * pattern-matching share of current performance. (The anchor set already carries controversy_stratum.)
 */
export function stratumGap() {
  throw new Error('validation: stratum-gap experiment not yet implemented (compute detector sensitivity per controversy_stratum)');
}

/**
 * Mechanism probe: require each agent to enumerate the specific trials/guidelines behind its evidence
 * grade BEFORE stating confidence; audit that citations are real and grades match an independent GRADE
 * assessment. Low confidence without articulable conflicting evidence = vibes, discard.
 */
export function mechanismProbe() {
  throw new Error('validation: mechanism-probe experiment not yet implemented (needs citation-enumeration prompt + GRADE audit)');
}

export default { temporalHoldout, stratumGap, mechanismProbe };
