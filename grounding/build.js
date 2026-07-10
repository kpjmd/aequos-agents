/**
 * Grounding — build a REAL evidence table for an anchor case, consulted before a stance is taken.
 *
 * The masked-evidence harness FABRICATES an <evidence_summary> to test appraisal in the abstract.
 * Grounding is the production-facing counterpart: it asks the ResearchAgent for the actual literature
 * behind a decision point (PubMed citations + deterministic GRADE per study), so a downstream stance can
 * be conditioned on evidence rather than recall. This module only BUILDS + NORMALIZES the table; whether
 * to inject it into a prompt lives in grounding/prompt.js, and caching/CLI in grounding/index.js.
 *
 * Cost note: a real fetch is ~$0 Anthropic when the heuristic query path is used and the Haiku intro is
 * skipped (PubMed E-utilities are free). curateRelevantStudies already attaches computeEvidenceGrade to
 * every citation, so no extra model call is needed to grade.
 */

/**
 * Derive a ResearchAgent structured query from an anchor case. Falls back to the raw decision point so
 * the agent's own extractClinicalTerms can salvage terms even when structured fields are thin.
 * @param {object} caseObj - anchor case ({decision_point, options, provenance})
 * @returns {{rawQuery, primaryComplaint, procedure, bodyPart, diagnosis}}
 */
export function buildGroundingQuery(caseObj) {
  const options = Array.isArray(caseObj.options) ? caseObj.options : [];
  return {
    rawQuery: caseObj.decision_point || '',
    primaryComplaint: caseObj.decision_point || '',
    procedure: options.join(' vs '),
    bodyPart: caseObj.provenance?.legacy_body_region || '',
    diagnosis: caseObj.provenance?.legacy_body_region || '',
  };
}

/** Most-favorable grade wins (A > B > C); mirrors research-agent's "favorability ceiling" framing. */
function overallGrade(citations) {
  const order = { A: 3, B: 2, C: 1 };
  let best = null;
  for (const c of citations) {
    if (c.evidenceGrade && (best === null || order[c.evidenceGrade] > order[best])) best = c.evidenceGrade;
  }
  return best; // null when no citations
}

/**
 * Fetch + normalize a real evidence table for a case.
 * @param {object} caseObj - anchor case
 * @param {{curateRelevantStudies:Function}} researchAgent - a ResearchAgent (or a stub in tests)
 * @param {{tier?:'basic'|'premium'}} [opts]
 * @returns {Promise<{caseId, options, query, citations, overall_grade, summary, totalFound, success, error?}>}
 */
export async function buildEvidenceTable(caseObj, researchAgent, { tier = 'basic' } = {}) {
  const query = buildGroundingQuery(caseObj);
  const res = await researchAgent.curateRelevantStudies(query, tier);
  const citations = (res.citations || []).map((c) => ({
    pmid: c.pmid,
    title: c.title,
    journal: c.journal,
    year: c.year,
    studyType: c.studyType,
    evidenceGrade: c.evidenceGrade,
    combinedScore: c.combinedScore,
  }));
  return {
    caseId: caseObj.id,
    options: caseObj.options || [],
    query: res.searchQuery || query.rawQuery,
    citations,
    overall_grade: overallGrade(citations),
    summary: res.intro || '',
    totalFound: res.totalFound ?? citations.length,
    success: Boolean(res.success),
    ...(res.error ? { error: res.error } : {}),
  };
}

export default buildEvidenceTable;
