import logger from './logger.js';

/**
 * Shared ingest helpers for the equipoise pipeline: resolve the FK rows that storePanelRun()
 * requires (a model_versions id and a queries id) on BOTH paths —
 *   - the benchmark probe (scripts/benchmark-probe.js): curated DPs, is_benchmark=true, detected_by='manual'
 *   - the live consult hook (agent-coordinator.js, Phase 2b): ad-hoc DPs anchored to the sentinel,
 *     is_benchmark=false, detected_by='classifier'
 * Keeping both on one code path is what makes the production layer faithful to the validated probe.
 *
 * Best-effort everywhere: a no-op (returns null) when sql is null (dev/tests); never throws.
 */

export const SENTINEL_SLUG = 'production-unclassified';

let _sentinelId; // module-level cache — the sentinel row is created once by runEquipoiseMigrations.

/**
 * Resolve a model_versions.id by model string. Returns null when absent (caller decides: a script
 * can hard-fail, production silently skips persistence). The row is seeded by seed-equipoise.js.
 * @param {import('@neondatabase/serverless').NeonQueryFunction<any,any>} sql
 * @param {string} modelString
 * @returns {Promise<number|null>}
 */
export async function resolveModelVersionId(sql, modelString) {
  if (!sql) return null;
  try {
    const rows = await sql`SELECT id FROM model_versions WHERE model_string = ${modelString} LIMIT 1`;
    return rows.length ? rows[0].id : null;
  } catch (error) {
    logger.error('equipoise-ingest: model_versions lookup failed', { modelString, error: error.message });
    return null;
  }
}

/**
 * Resolve (and cache) the sentinel production decision_point id created in runEquipoiseMigrations.
 * @param {import('@neondatabase/serverless').NeonQueryFunction<any,any>} sql
 * @returns {Promise<number|null>}
 */
export async function getSentinelDecisionPointId(sql) {
  if (!sql) return null;
  if (_sentinelId != null) return _sentinelId;
  try {
    const rows = await sql`SELECT id FROM decision_points WHERE slug = ${SENTINEL_SLUG} LIMIT 1`;
    _sentinelId = rows.length ? rows[0].id : null;
    return _sentinelId;
  } catch (error) {
    logger.error('equipoise-ingest: sentinel decision_point lookup failed', { error: error.message });
    return null;
  }
}

/**
 * Insert a queries row and link it to a decision_point (query_decision_points). Returns the query id
 * (or null on failure). PHI rule: questionText is the triage-framed clinical decision question, NOT
 * the patient's raw free-text; patientContext should carry only de-identified context (e.g. archetype
 * label), never identifiers — consistent with the legacy divergence table's PHI-out stance.
 * @param {import('@neondatabase/serverless').NeonQueryFunction<any,any>} sql
 * @param {Object} params
 * @param {string} params.questionText
 * @param {number|string} params.decisionPointId
 * @param {boolean} [params.isBenchmark]
 * @param {'manual'|'classifier'} [params.detectedBy]
 * @param {Object|null} [params.patientContext]
 * @returns {Promise<number|null>}
 */
export async function createQuery(sql, { questionText, decisionPointId, isBenchmark = false, detectedBy = 'classifier', patientContext = null }) {
  if (!sql) return null;
  try {
    const q = await sql`
      INSERT INTO queries (raw_text, is_benchmark, patient_context)
      VALUES (${questionText}, ${isBenchmark}, ${patientContext ? JSON.stringify(patientContext) : null}::jsonb)
      RETURNING id
    `;
    const queryId = q[0].id;
    await sql`
      INSERT INTO query_decision_points (query_id, decision_point_id, detected_by)
      VALUES (${queryId}, ${decisionPointId}, ${detectedBy}::dp_detected_by)
      ON CONFLICT (query_id, decision_point_id) DO NOTHING
    `;
    return queryId;
  } catch (error) {
    logger.error('equipoise-ingest: createQuery failed', { decisionPointId, error: error.message });
    return null;
  }
}
