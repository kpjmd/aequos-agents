import sql from './db.js';
import logger from './logger.js';

function requireDb() {
  if (!sql) throw new Error('DATABASE_URL not configured — research storage unavailable');
  return sql;
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
