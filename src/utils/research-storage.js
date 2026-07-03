import sql from './db.js';
import logger from './logger.js';

function requireDb() {
  if (!sql) throw new Error('DATABASE_URL not configured — research storage unavailable');
  return sql;
}

/**
 * A pending research row is "stale" when more time has elapsed since it was created than
 * the job could possibly still be running (budget + margin). This happens when the process
 * died mid-job before writing a terminal status. Callers use this to surface a failed poll
 * (instead of a perpetual pending) and to allow re-triggering (F5).
 *
 * @param {string|Date|number} createdAt
 * @param {number} budgetSeconds - RESEARCH_TIMEOUT_SECONDS
 * @param {object} [opts]
 * @param {number} [opts.marginSeconds=15] - grace beyond the budget before declaring stale
 * @param {number} [opts.now=Date.now()]
 * @returns {boolean}
 */
export function isPendingStale(createdAt, budgetSeconds, { marginSeconds = 15, now = Date.now() } = {}) {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return (now - created) / 1000 > budgetSeconds + marginSeconds;
}

export async function storeResearchPending(consultationId) {
  const db = requireDb();
  try {
    const rows = await db`
      INSERT INTO research_results (consultation_id, status)
      VALUES (${consultationId}, 'pending')
      RETURNING id
    `;
    return rows[0].id;
  } catch (error) {
    logger.error('Failed to store pending research', { consultationId, error: error.message });
    throw error;
  }
}

export async function storeResearchResult(consultationId, result) {
  const db = requireDb();
  try {
    const rows = await db`
      UPDATE research_results
      SET status = 'complete',
          intro = ${result.intro},
          citations = ${JSON.stringify(result.citations)},
          search_query = ${result.searchQuery},
          studies_reviewed = ${result.studiesReviewed},
          tier = ${result.tier},
          completed_at = NOW()
      WHERE consultation_id = ${consultationId} AND status = 'pending'
    `;
    return rows.length;
  } catch (error) {
    logger.error('Failed to store research result', { consultationId, error: error.message });
    throw error;
  }
}

export async function storeResearchError(consultationId, errorMessage) {
  const db = requireDb();
  try {
    const rows = await db`
      UPDATE research_results
      SET status = 'failed',
          error = ${errorMessage},
          completed_at = NOW()
      WHERE consultation_id = ${consultationId} AND status = 'pending'
    `;
    return rows.length;
  } catch (error) {
    logger.error('Failed to store research error', { consultationId, error: error.message });
    throw error;
  }
}

export async function getResearchResult(consultationId) {
  const db = requireDb();
  try {
    const rows = await db`
      SELECT * FROM research_results
      WHERE consultation_id = ${consultationId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error) {
    logger.error('Failed to get research result', { consultationId, error: error.message });
    throw error;
  }
}
