/**
 * Grounding prompt builder — a STANDALONE position prompt that injects a real evidence table before the
 * stance question. It parallels validation/masked-evidence/build.js (fabricated evidence) but uses the
 * case's true decision point, true options, and the ResearchAgent's real citations. Production's
 * buildPositionPrompt is never touched — this is an experiment/consultation surface.
 */

/** Render a normalized evidence table (from grounding/build.js) as a compact <evidence_summary> block. */
export function renderEvidenceTable(evidenceTable) {
  if (!evidenceTable || !evidenceTable.citations || evidenceTable.citations.length === 0) {
    return '<evidence_summary>\n(no evidence retrieved — dry run or empty search)\n</evidence_summary>';
  }
  const lines = evidenceTable.citations.map(
    (c, i) => `  ${i + 1}. [GRADE ${c.evidenceGrade || '?'}] ${c.studyType || 'study'} — ${c.title || 'untitled'} (${c.journal || '?'}, ${c.year || '?'})`,
  );
  return [
    '<evidence_summary>',
    `overall GRADE (most favorable): ${evidenceTable.overall_grade || 'none'}`,
    'citations:',
    ...lines,
    '</evidence_summary>',
  ].join('\n');
}

/**
 * Build a grounded position prompt for a case + its evidence table.
 * @param {object} caseObj - anchor case ({decision_point, options})
 * @param {object} evidenceTable - normalized table from buildEvidenceTable (may be empty on dry run)
 * @returns {{userPrompt, options, caseId}}
 */
export function groundedPrompt(caseObj, evidenceTable) {
  const options = caseObj.options || [];
  const userPrompt = [
    'You are advising on the following clinical decision. Consult the retrieved evidence FIRST, then take a position.',
    '',
    `Decision: ${caseObj.decision_point || ''}`,
    `Option A: ${options[0] || ''}`,
    `Option B: ${options[1] || ''}`,
    '',
    renderEvidenceTable(evidenceTable),
    '',
    'Weigh the evidence above. State whether Option A, Option B, or "defer" (genuine equipoise) is preferred,',
    'your confidence (0–1), and the GRADE certainty your position rests on.',
  ].join('\n');
  return { userPrompt, options, caseId: caseObj.id };
}

export default groundedPrompt;
