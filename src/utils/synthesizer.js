import logger from './logger.js';

/**
 * Synthesizer — turns one detector result (a coordination-conference `perDecisionPoint` entry)
 * into the clinician equipoise card + the routing/collapse decision persisted in
 * synthesizer_outputs. This is the product face of the moat.
 *
 * Locked rules (co-designed with the surgeon, 2026-06-27):
 *   - detector_verdict is AUTHORITATIVE; the card `status` mirrors it (converged→'consensus',
 *     contested→'contested'). v1 NEVER collapses, so `status` never diverges from the verdict and
 *     the 'refer' card_status + collapse mechanism stay forward-compat (like the detector 'refer' enum).
 *   - route_to_human fires on the production red-flag signal ALONE — clinicalFlags.requiresImmediateMD
 *     (a high-relevance finding or a 'critical' specialist assessment) — regardless of verdict: a
 *     critical finding must reach a surgeon even if the panel converged. route_reason='risk_category'.
 *   - Contested-but-not-red-flag → surface the equipoise card (the core product). No data-driven collapse.
 *
 * "What would tip it" is DERIVED, never free-generated (no hallucination): from the archetype axis
 * that flipped when an archetype sweep is present (benchmark), else from the panel's own per-side
 * reasoning (production single-patient panel — the lenses already articulate the deciding factors).
 */

/**
 * Build the synthesizer output (routing decision + card_json) for one decision point.
 * @param {Object} perDP - a coordination-conference perDecisionPoint entry
 *   { decisionPoint:{id,question,options}, verdict, positions[], splitSummary }
 * @param {Object} ctx
 * @param {boolean} [ctx.requiresImmediateMD] - synthesis clinicalFlags.requiresImmediateMD
 * @param {string}  [ctx.urgencyLevel]        - synthesis clinicalFlags.urgencyLevel
 * @param {Object}  [ctx.treatmentPlan]       - the shared synthesized care plan (care-plan home)
 * @returns {{status,collapsed,collapse_reason,route_to_human,route_reason,support_score,card_json}}
 */
export function buildSynthesizerOutput(perDP, ctx = {}) {
  const { verdict, decisionPoint, splitSummary } = perDP;
  const requiresImmediateMD = !!ctx.requiresImmediateMD;

  const status = verdict === 'contested' ? 'contested' : 'consensus';
  const route_to_human = requiresImmediateMD;
  const route_reason = route_to_human ? 'risk_category' : 'none';
  const support_score = computeSupportScore(splitSummary);

  const [optionA = null, optionB = null] = decisionPoint?.options || [];

  const card_json = {
    decision: { question: decisionPoint?.question ?? null, optionA, optionB },
    verdict,
    status,
    contestedBy: splitSummary?.contestedBy ?? null,
    theSplit: buildSplit(splitSummary),
    deliberationDelta: buildDeliberationDelta(splitSummary),
    whatWouldTipIt: verdict === 'contested' ? buildWhatWouldTipIt(splitSummary) : null,
    carePlanHome: ctx.treatmentPlan ?? null,
    evidenceLedger: [], // Phase 2.5 — Research Agent → evidence_citations
    route: {
      toHuman: route_to_human,
      reason: route_reason,
      urgencyLevel: ctx.urgencyLevel ?? null,
      label: route_to_human ? 'Urgent surgical consult' : null,
    },
  };

  // v1 never collapses (route_to_human is the independent escalation flag), so collapse_reason is
  // null and the collapse_needs_reason CHECK is trivially satisfied.
  return {
    status,
    collapsed: false,
    collapse_reason: null,
    route_to_human,
    route_reason,
    support_score,
    card_json,
  };
}

/** Modal-stance support fraction (0..1, 2dp) from the substantive stance distribution; null if none. */
function computeSupportScore(splitSummary) {
  const counts = splitSummary?.stanceCounts || {};
  const values = Object.values(counts);
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return Math.round((Math.max(...values) / total) * 100) / 100;
}

/** THE SPLIT — per-stance groups of specialists with their cited reasoning (from divergence sides). */
function buildSplit(splitSummary) {
  const sides = splitSummary?.sides;
  if (!Array.isArray(sides)) return null;
  return sides.map(side => ({
    stance: side.stance,
    specialists: (side.specialists || []).map(sp => ({
      name: sp.specialist ?? sp.specialistType ?? 'specialist',
      confidence: sp.confidence ?? null,
      evidenceGrade: sp.evidenceGrade ?? null,
      reasoning: sp.reasoning ?? null,
    })),
  }));
}

/** DELIBERATION DELTA — who moved in the dialogue round, and whether the split persisted. */
function buildDeliberationDelta(splitSummary) {
  const pd = splitSummary?.postDialogue;
  if (!pd) return null;
  return {
    revisions: pd.deltas ?? [],
    changedCount: pd.changedCount ?? 0,
    persisted: pd.persisted ?? null,
    resolved: pd.resolved ?? null,
  };
}

/**
 * WHAT WOULD TIP IT — derived, not generated.
 *   - benchmark (archetype sweep present): the axis that flipped maps a patient archetype → each option.
 *   - production (single panel): each option's tipping factors = the reasoning the lenses cited for it.
 */
function buildWhatWouldTipIt(splitSummary) {
  // Archetype-sweep path (benchmark / future): groups carry per-archetype modal stances.
  const flippedGroups = (splitSummary?.groups || []).filter(g => g.flipDetected && g.modalByArchetype);
  if (flippedGroups.length > 0) {
    return {
      source: 'archetype_axis',
      axes: flippedGroups.map(g => ({ axis: g.name, modalByArchetype: g.modalByArchetype })),
    };
  }
  // Single-panel path (production): surface each side's cited reasoning as its tipping factors.
  const sides = splitSummary?.sides;
  if (Array.isArray(sides)) {
    return {
      source: 'panel_reasoning',
      toward: sides.map(side => ({
        option: side.stance,
        factors: (side.specialists || []).map(sp => sp.reasoning).filter(Boolean),
      })),
    };
  }
  return null;
}

/**
 * Persist a synthesizer output. One row per panel_run (UNIQUE); idempotent via ON CONFLICT.
 * Best-effort: no-op when sql is null; never throws.
 * @returns {Promise<number|null>} the new synthesizer_outputs id, or null
 */
export async function storeSynthesizerOutput(sql, panelRunId, output) {
  if (!sql || panelRunId == null) return null;
  try {
    const rows = await sql`
      INSERT INTO synthesizer_outputs
        (panel_run_id, status, collapsed, collapse_reason, route_to_human, route_reason,
         support_score, card_json)
      VALUES
        (${panelRunId}, ${output.status}::card_status, ${output.collapsed},
         ${output.collapse_reason}, ${output.route_to_human}, ${output.route_reason}::route_reason,
         ${output.support_score}, ${JSON.stringify(output.card_json ?? {})}::jsonb)
      ON CONFLICT (panel_run_id) DO NOTHING
      RETURNING id
    `;
    return rows.length ? rows[0].id : null;
  } catch (error) {
    logger.error('synthesizer: failed to store synthesizer_output', { panelRunId, error: error.message });
    return null;
  }
}

export default buildSynthesizerOutput;
