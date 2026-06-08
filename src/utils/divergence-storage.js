import sql from './db.js';
import logger from './logger.js';

/**
 * Persistence for genuine inter-agent divergences — the training corpus and the
 * settlement substrate for a future prediction-market V2.
 *
 * Best-effort: a no-op when DATABASE_URL is unset (dev/tests). One row per divergence.
 * Deliberately does NOT store raw caseData — only the de-identified clinical reasoning
 * (decision point, per-side positions, dialogue, deltas) to keep PHI out of the corpus.
 */

export async function storeCoordinationDivergences(consultationId, coordinationMetadata) {
  if (!sql) return 0; // no DB configured — skip silently
  if (!coordinationMetadata?.gateOpen) return 0;
  const divergences = coordinationMetadata.divergences || [];
  if (divergences.length === 0) return 0;

  let stored = 0;
  for (const d of divergences) {
    try {
      await sql`
        INSERT INTO coordination_divergences
          (consultation_id, decision_point_id, decision_question, decision_options,
           persisted, resolved, changed_count, sides, dialogue, post_dialogue)
        VALUES (
          ${consultationId},
          ${d.decisionPoint?.id ?? null},
          ${d.decisionPoint?.question ?? null},
          ${JSON.stringify(d.decisionPoint?.options ?? [])},
          ${d.postDialogue?.persisted ?? null},
          ${d.postDialogue?.resolved ?? null},
          ${d.postDialogue?.changedCount ?? 0},
          ${JSON.stringify(d.sides ?? [])},
          ${JSON.stringify(d.dialogue ?? [])},
          ${JSON.stringify(d.postDialogue ?? {})}
        )
      `;
      stored++;
    } catch (error) {
      logger.error('Failed to store coordination divergence', {
        consultationId,
        decisionPoint: d.decisionPoint?.id,
        error: error.message,
      });
    }
  }

  if (stored > 0) logger.info(`Persisted ${stored} coordination divergence(s) for ${consultationId}`);
  return stored;
}

export async function getCoordinationDivergences(consultationId) {
  if (!sql) return [];
  try {
    return await sql`
      SELECT * FROM coordination_divergences
      WHERE consultation_id = ${consultationId}
      ORDER BY created_at ASC
    `;
  } catch (error) {
    logger.error('Failed to get coordination divergences', { consultationId, error: error.message });
    return [];
  }
}
