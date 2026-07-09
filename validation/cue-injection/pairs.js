/**
 * Cue-injection harness — same decision, neutral phrasing vs a phrasing that names the famous trial /
 * eponym / "debated area". The confidence delta (cued − neutral) quantifies the RECOGNITION component:
 * how much of the model's confidence comes from recognizing a famous debate rather than appraising the
 * case. A large delta on cases sharing a source with our literature-derived labels is exactly the
 * circularity risk the whole validation phase exists to measure.
 *
 * The neutral and cued prompts differ ONLY in the injected cue sentence — everything else is identical,
 * so the delta isolates the cue.
 */

/** Cue sentences that signal "this is a recognized controversy" without adding clinical information. */
export const CUES = [
  'Note: this is a long-debated area with landmark randomized trials on both sides.',
  'Note: this decision is the subject of a well-known, named clinical controversy.',
  'Note: prominent guidelines and eponymous techniques disagree here.',
];

/**
 * Build a neutral/cued prompt pair for a case (standalone; mirrors buildPositionPrompt's shape).
 * @param {{decision_point:string, options:string[]}} caseObj
 * @param {number} [cueIndex]
 * @returns {{neutral:string, cued:string, cue:string, options:string[]}}
 */
export function buildPair(caseObj, cueIndex = 0) {
  const options = caseObj.options;
  const optionList = options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
  const cue = CUES[cueIndex % CUES.length];

  const body = (cueLine) =>
    `State YOUR position on the following clinical decision for the typical adult patient, reasoning from your area of expertise.\n\n` +
    (cueLine ? `${cueLine}\n\n` : '') +
    `DECISION: ${caseObj.decision_point}\n` +
    `OPTIONS:\n${optionList}\n\n` +
    `Instructions:\n` +
    `- Choose exactly one option you support, OR choose "defer".\n` +
    `- Ground your reasoning in your specialty's evidence and judgment for this population.`;

  return { neutral: body(null), cued: body(cue), cue, options };
}

export default buildPair;
