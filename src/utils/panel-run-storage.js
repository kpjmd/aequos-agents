import logger from './logger.js';
import { toAgentEnum, toStanceEnum } from './equipoise-mappers.js';

/**
 * Shared write-path for the equipoise pipeline: persist one panel_runs row + its
 * specialist_positions rows. detector_verdict is the AUTHORITATIVE moat signal.
 *
 * Used by the Phase 2a benchmark probe (run_kind='benchmark_probe') and reused unchanged by the
 * Phase 2b live consult hook (run_kind='production') at agent-coordinator.js. Best-effort:
 * a no-op when sql is null (dev/tests); never throws (logs + returns null on failure).
 *
 * @param {import('@neondatabase/serverless').NeonQueryFunction<any,any>} sql
 * @param {Object} params
 * @param {number|string} params.queryId
 * @param {number|string} params.decisionPointId
 * @param {number|string} params.modelVersionId
 * @param {'converged'|'contested'} params.verdict
 * @param {string} params.optionALabel - curated DP option_a_label (for stance mapping)
 * @param {string} params.optionBLabel - curated DP option_b_label
 * @param {'production'|'benchmark_probe'|'sham_control'|'reproducibility'} [params.runKind]
 * @param {number} [params.runIndex]
 * @param {string} [params.sessionId]
 * @param {Object} [params.splitSummary] - stance distribution + dialogue persistence (JSONB)
 * @param {Array<{specialistType,initialStance,finalStance,confidence,reasoning,changeReason}>} [params.positions]
 * @returns {Promise<number|null>} the new panel_run id, or null
 */
export async function storePanelRun(sql, params) {
  if (!sql) return null;

  const {
    queryId,
    decisionPointId,
    modelVersionId,
    verdict,
    optionALabel,
    optionBLabel,
    runKind = 'production',
    runIndex = 1,
    sessionId = null,
    splitSummary = null,
    positions = [],
  } = params;

  try {
    const inserted = await sql`
      INSERT INTO panel_runs
        (query_id, decision_point_id, model_version_id, session_id,
         detector_verdict, split_summary, run_kind, run_index)
      VALUES
        (${queryId}, ${decisionPointId}, ${modelVersionId}, ${sessionId},
         ${verdict}::detector_verdict, ${JSON.stringify(splitSummary ?? {})}::jsonb,
         ${runKind}::run_kind, ${runIndex})
      RETURNING id
    `;
    const panelRunId = inserted[0].id;

    for (const p of positions) {
      const agent = toAgentEnum(p.specialistType);
      if (!agent) {
        logger.warn(`panel-run-storage: unknown agent "${p.specialistType}" — skipping position`);
        continue;
      }
      const initialStance = toStanceEnum(p.initialStance, optionALabel, optionBLabel);
      const finalStance = toStanceEnum(p.finalStance, optionALabel, optionBLabel);
      await sql`
        INSERT INTO specialist_positions
          (panel_run_id, agent, initial_stance, final_stance, confidence, reasoning, revised_on)
        VALUES
          (${panelRunId}, ${agent}::specialist_agent,
           ${initialStance}::stance, ${finalStance}::stance,
           ${p.confidence ?? null}, ${p.reasoning ?? null}, ${p.changeReason ?? null})
        ON CONFLICT (panel_run_id, agent) DO NOTHING
      `;
    }

    return panelRunId;
  } catch (error) {
    logger.error('panel-run-storage: failed to store panel run', {
      decisionPointId,
      error: error.message,
    });
    return null;
  }
}

export default storePanelRun;
