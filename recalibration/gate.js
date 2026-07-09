/**
 * The release gate. A model version does not reach production until it hits the target operating point
 * on the anchor set. If no threshold achieves the target, the gate FAILS LOUDLY — that is the
 * upgrade-broke-the-detector signal, caught pre-production rather than in the field.
 */
export class GateError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'GateError';
    this.detail = detail;
  }
}

/**
 * @param {{gate_passed, achieved_sensitivity, achieved_specificity, threshold}} result
 * @param {{targetSensitivity, minSpecificity}} target
 * @param {{modelVersion, anchorSetVersion}} ctx
 * @throws {GateError} when the target is not achievable
 */
export function assertGate(result, target, ctx) {
  if (result.gate_passed) return result;
  throw new GateError(
    `RELEASE GATE FAILED for ${ctx.modelVersion} on anchor set ${ctx.anchorSetVersion}: ` +
      `no threshold reaches target_sensitivity=${target.targetSensitivity} with specificity>=${target.minSpecificity} ` +
      `(best achievable: sensitivity=${result.achieved_sensitivity.toFixed(3)}, specificity=${result.achieved_specificity.toFixed(3)}). ` +
      `Do NOT ship this model version until the detector is re-tuned or the anchor set is re-examined.`,
    { result, target, ctx }
  );
}

export default assertGate;
