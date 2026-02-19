import { RESEARCH_TOKEN_EVENTS } from './token-manager.js';
import logger from './logger.js';

/**
 * Compute a granular token breakdown from a research result using
 * RESEARCH_TOKEN_EVENTS, then distribute via tokenManager.
 *
 * @param {string} consultationId - The consultation this research belongs to
 * @param {object} researchResult - Result from ResearchAgent.curateRelevantStudies()
 * @param {object} options
 * @param {import('./token-manager.js').TokenManager} options.tokenManager
 * @param {import('../agents/research-agent.js').ResearchAgent} options.researchAgent
 * @returns {Promise<{tokens: number, distributed: object|null, breakdown: object}>}
 */
export async function distributeResearchTokens(consultationId, researchResult, { tokenManager, researchAgent }) {
  const breakdown = {
    base: 0,
    relevantStudies: 0,
    highImpactJournals: 0,
    recentEvidence: 0,
    studyTypeDiversity: 0,
    premiumAccess: 0,
    lowRelevancePenalty: 0,
  };

  const citations = researchResult.citations || [];

  // Early exit: no citations → nothing to distribute
  if (citations.length === 0) {
    logger.info(`No citations for ${consultationId}, skipping research token distribution`);
    return { tokens: 0, distributed: null, breakdown };
  }

  // 1. Base: LITERATURE_SEARCH_COMPLETED (1 token)
  breakdown.base = RESEARCH_TOKEN_EVENTS.LITERATURE_SEARCH_COMPLETED;

  // 2. If citations.length >= 3: add RELEVANT_STUDIES_FOUND (3)
  if (citations.length >= 3) {
    breakdown.relevantStudies = RESEARCH_TOKEN_EVENTS.RELEVANT_STUDIES_FOUND;
  }

  // 3. Count tier-1 citations (qualityScore >= 9): add count * HIGH_IMPACT_JOURNAL (5 each)
  const tier1Count = citations.filter(c => c.qualityScore >= 9).length;
  breakdown.highImpactJournals = tier1Count * RESEARCH_TOKEN_EVENTS.HIGH_IMPACT_JOURNAL;

  // 4. If recentCount >= 2 (year >= 2023): add RECENT_EVIDENCE (2)
  const recentCount = citations.filter(c => parseInt(c.year) >= 2023).length;
  if (recentCount >= 2) {
    breakdown.recentEvidence = RESEARCH_TOKEN_EVENTS.RECENT_EVIDENCE;
  }

  // 5. If study types include both 'Randomized Controlled Trial' and 'Meta-Analysis': add MULTIPLE_STUDY_TYPES (3)
  const studyTypes = new Set(citations.map(c => c.studyType));
  if (studyTypes.has('Randomized Controlled Trial') && studyTypes.has('Meta-Analysis')) {
    breakdown.studyTypeDiversity = RESEARCH_TOKEN_EVENTS.MULTIPLE_STUDY_TYPES;
  }

  // 6. If tier === 'premium': add PREMIUM_ACCESS (2)
  if (researchResult.tier === 'premium') {
    breakdown.premiumAccess = RESEARCH_TOKEN_EVENTS.PREMIUM_ACCESS;
  }

  // 7. Apply LOW_RELEVANCE penalty (-2) if average quality score < 6
  const avgQuality = citations.reduce((sum, c) => sum + (c.qualityScore || 0), 0) / citations.length;
  if (avgQuality < 6) {
    breakdown.lowRelevancePenalty = RESEARCH_TOKEN_EVENTS.LOW_RELEVANCE;
  }

  const tokens = Math.max(0,
    breakdown.base +
    breakdown.relevantStudies +
    breakdown.highImpactJournals +
    breakdown.recentEvidence +
    breakdown.studyTypeDiversity +
    breakdown.premiumAccess +
    breakdown.lowRelevancePenalty
  );

  // Build outcome booleans for the existing calculateRewardAmount path
  const outcome = {
    success: researchResult.success,
    literatureSearchCompleted: true,
    relevantStudiesFound: citations.length >= 3,
    highImpactJournal: tier1Count > 0,
    recentEvidence: recentCount >= 2,
    multipleStudyTypes: studyTypes.has('Randomized Controlled Trial') && studyTypes.has('Meta-Analysis'),
  };

  let distributed;
  try {
    distributed = await tokenManager.distributeTokenReward(
      researchAgent.agentId,
      outcome,
      { walletProvider: researchAgent.walletProvider }
    );
  } catch (error) {
    logger.error(`Research token distribution failed for ${consultationId}: ${error.message}`);
    throw error;
  }

  logger.info(`Research tokens for ${consultationId}: ${tokens} (breakdown: ${JSON.stringify(breakdown)})`);

  return { tokens, distributed, breakdown };
}
