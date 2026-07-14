/**
 * Masked / synthetic-evidence harness — the cleanest validation lever because we OWN the causal input.
 *
 * We strip topic identity from a case (body region, condition name, option labels all removed) and hand
 * the panel a FABRICATED-but-coherent evidence summary we control. If confidence/stance tracks the
 * supplied evidence STRUCTURE (higher certainty → higher confidence; effect direction → stance), the
 * model can genuinely appraise evidence. If it doesn't move with the evidence, the "confidence" signal
 * is topic-recognition, not appraisal — and must not be recalibrated, it must be retired.
 *
 * Injection point: a STANDALONE prompt builder here (not a modification of OrthopedicSpecialist
 * .buildPositionPrompt — production's single source of truth stays clean). The system prompt + tool
 * still come from the real agent, preserving the persona panel.
 */

/** Neutral option labels — no clinical identity leaks through the option text. */
export const NEUTRAL_OPTIONS = ['Option A', 'Option B'];

/**
 * Strip topic identity from a case. Returns a fully de-identified frame + an audit of what was removed
 * (so the strip is inspectable). We REPLACE the condition-bearing question with a generic one — the
 * point is that ONLY the fabricated evidence should drive the answer.
 * @param {{decision_point:string, options:string[], provenance?:object}} caseObj
 * @returns {{maskedQuestion:string, options:string[], audit:{removed:string[]}}}
 */
export function stripTopicIdentity(caseObj) {
  return {
    maskedQuestion:
      'For the typical adult patient in whom this decision arises, which option is preferred on the evidence below?',
    options: [...NEUTRAL_OPTIONS],
    audit: {
      removed: [
        `question: ${caseObj.decision_point}`,
        `option_a: ${caseObj.options?.[0]}`,
        `option_b: ${caseObj.options?.[1]}`,
        `body_region: ${caseObj.provenance?.legacy_body_region ?? 'n/a'}`,
      ],
    },
  };
}

/**
 * A fabricated, coherent evidence summary the model must reason over.
 * @param {{effect_direction:'A'|'B'|'none', effect_size:string, certainty:'high'|'moderate'|'low', n_trials:number}} s
 * @returns {string} the <evidence_summary> block
 */
export function fabricatedEvidence(s) {
  const favors = s.effect_direction === 'none' ? 'neither option (results conflicting / equivalent)' : `Option ${s.effect_direction}`;
  return (
    `<evidence_summary>\n` +
    `Pooled from ${s.n_trials} randomized trial(s):\n` +
    `- Direction: favors ${favors}\n` +
    `- Effect size: ${s.effect_size}\n` +
    `- Certainty of evidence (GRADE): ${s.certainty}\n` +
    `</evidence_summary>`
  );
}

/**
 * The standalone masked user prompt (mirrors buildPositionPrompt's shape without importing it).
 * @param {object} caseObj
 * @param {object} evidenceStructure
 * @returns {{userPrompt:string, options:string[], audit:object, evidenceStructure:object}}
 */
export function buildMaskedPrompt(caseObj, evidenceStructure) {
  const masked = stripTopicIdentity(caseObj);
  const optionList = masked.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
  const userPrompt =
    `State YOUR position on the following clinical decision, reasoning ONLY from the evidence provided.\n\n` +
    `DECISION: ${masked.maskedQuestion}\n` +
    `OPTIONS:\n${optionList}\n\n` +
    `${fabricatedEvidence(evidenceStructure)}\n\n` +
    `Instructions:\n` +
    `- Choose exactly one option you support, OR choose "defer".\n` +
    `- Base your stance and confidence on the evidence summary above — no outside knowledge of the topic is available (it has been withheld deliberately).\n` +
    `- DEFER only if the evidence is genuinely insufficient to take a position.`;
  return { userPrompt, options: masked.options, audit: masked.audit, evidenceStructure };
}

/** The evidence structures swept per case — the independent variable of the experiment. */
export const EVIDENCE_GRID = [
  { effect_direction: 'A', effect_size: 'large (RR 0.6)', certainty: 'high', n_trials: 4 },
  { effect_direction: 'A', effect_size: 'small (RR 0.9)', certainty: 'low', n_trials: 1 },
  { effect_direction: 'B', effect_size: 'large (RR 0.6)', certainty: 'high', n_trials: 4 },
  { effect_direction: 'none', effect_size: 'no difference (RR 1.0)', certainty: 'moderate', n_trials: 3 },
];

export default buildMaskedPrompt;
