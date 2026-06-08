import { z } from 'zod';

/**
 * Structured-output schemas for real inter-agent dialogue (replaces regex-on-prose).
 * Used by:
 *  - TriageAgent.identifyDecisionPoints  -> DecisionPointsSchema
 *  - OrthopedicSpecialist.statePosition  -> makePositionSchema(options)
 *
 * Design constraints (see plan / inter-agent-dialogue-decision memory):
 *  - Decision points are GENUINE clinical equipoise only. Clear-cut cases yield an
 *    EMPTY list — that empty list is the natural gate that skips the position pass.
 *  - Every position allows "defer" (insufficient evidence / outside this lens). Deferral
 *    is a first-class anti-hallucination outcome, never a failure.
 */

export const DecisionPointsSchema = z.object({
  decisionPoints: z
    .array(
      z.object({
        id: z.string().describe('short kebab-case identifier, e.g. "acl-surgery-vs-rehab"'),
        question: z.string().describe('the clinical decision phrased as a question the panel must answer'),
        options: z
          .array(z.string())
          .min(2)
          .max(4)
          .describe('the 2-4 mutually exclusive choices for this decision'),
        rationale: z
          .string()
          .describe('why this decision is genuinely contested / clinical equipoise FOR THIS CASE'),
      })
    )
    .describe(
      'Decision points where well-informed specialists could REASONABLY DISAGREE for this specific case. ' +
        'Return 0-3. Return an EMPTY array when the case is clear-cut and the evidence-based answer is not genuinely contested. ' +
        'Do NOT invent disagreement: only include a decision point if there is real clinical equipoise.'
    ),
});

/**
 * Build a position schema whose `stance` is constrained to this decision point's options
 * (plus "defer"). Dynamic per-call so the model cannot return an off-menu stance.
 * @param {string[]} options - the decision point's options (>=2)
 */
export function makePositionSchema(options) {
  const stanceValues = [...options, 'defer'];
  // Field order matters: `reasoning` is FIRST so the model thinks from its lens BEFORE
  // committing to a stance (think-then-commit). Listing stance first makes structured
  // output pick-then-justify, which flattens clinical judgment toward the "safe" option.
  return z.object({
    reasoning: z
      .string()
      .describe('FIRST reason through THIS case from your specialty lens — what does your expertise specifically weigh here, and which way does it point? Argue from your domain, not from generic caution. 2-4 sentences.'),
    stance: z
      .enum(stanceValues)
      .describe('AFTER your reasoning, the option your reasoning leads you to, matching one provided option exactly; or "defer" only if this decision is genuinely outside your lens or the evidence is truly insufficient. Do not pick an option merely because it sounds safest.'),
    confidence: z.number().min(0).max(1).describe('your confidence in this stance, 0-1'),
    evidenceGrade: z
      .enum(['A', 'B', 'C', 'D', 'none'])
      .describe('strength of evidence supporting your stance (A strongest; "none" if defer)'),
  });
}

/**
 * Build a reconsideration schema for the dialogue round: a specialist responds to the
 * OPPOSING positions and either holds (rebuttal) or revises (reason). `reconsideration`
 * is first (think-then-commit). A well-reasoned persistent disagreement is a valued
 * outcome — never revise merely to reach consensus.
 * @param {string[]} options - the decision point's options (>=2)
 */
export function makeReconsiderSchema(options) {
  const stanceValues = [...options, 'defer'];
  return z.object({
    reconsideration: z
      .string()
      .describe('Engage from your lens with the OPPOSING specialists\' strongest point. Does it genuinely change your clinical judgment for THIS patient? 2-4 sentences.'),
    revisedStance: z
      .enum(stanceValues)
      .describe('your stance AFTER considering the opposing view — the SAME as before if you hold, or different if their reasoning genuinely moved you. Do not change merely to agree.'),
    changeReason: z
      .string()
      .describe('if you revised: what specifically changed your mind. If you held: your concise rebuttal to the opposing view.'),
    confidence: z.number().min(0).max(1).describe('confidence in your revised stance, 0-1'),
  });
}
