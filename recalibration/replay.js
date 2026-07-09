/**
 * Rehearse recalibration on STORED benchmark_probe runs — free, no LLM, no fresh grid.
 *
 * The stored panel_runs.split_summary carries per-archetype stanceCounts, so the unified detector's
 * feature computation can be run over them. HONEST LIMITS (surfaced in the report, per the plan):
 *   CAN compute  — between_archetype_modal_variance + within_archetype_stance_entropy (from the
 *                  demand_risk group's stanceCounts) and nothing else that needs them.
 *   CANNOT compute — choice_lability_rate (stored runs used ONE option order; there is no swap to
 *                    measure) and any grade-conditioned confidence (evidenceGrade + per-cell confidence
 *                    are not persisted). Those come out 0/empty and MUST NOT be read as real zeros.
 * So the gate can be REHEARSED on the modal-variance + entropy signals; a true production release gate
 * needs a fresh detector run (which adds the option-order + lability dimensions).
 *
 * Stored data used the decision-type ROUTER's axes; we read the demand_risk group only (the unified
 * detector's canonical axis), an approximation noted here.
 */
import { computeFeatures } from '../detector/features.js';

/**
 * @param {import('@neondatabase/serverless').NeonQueryFunction<any,any>} sql
 * @returns {Promise<{cases:Array, partial:object}>}
 */
export async function replayFromPanelRuns(sql) {
  const rows = await sql`
    SELECT dp.slug, dp.anchor_label, dp.expected_equipoise, dp.is_pediatric,
           COALESCE(dp.absolute_indication,false) AS absolute,
           dp.option_a_label, dp.option_b_label,
           pr.run_index, pr.split_summary AS ss
    FROM decision_points dp
    JOIN panel_runs pr ON pr.decision_point_id = dp.id AND pr.run_kind = 'benchmark_probe'
    WHERE dp.is_active = true
  `;

  const bySlug = new Map();
  for (const r of rows) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, { meta: r, cells: [] });
    const entry = bySlug.get(r.slug);
    const groups = r.ss?.groups || [];
    const demand = groups.find((g) => g.name === 'demand_risk') || groups[0];
    if (!demand) continue;
    for (const arch of demand.archetypes || []) {
      for (const [label, count] of Object.entries(arch.stanceCounts || {})) {
        const stance = label === r.option_a_label ? 'A' : label === r.option_b_label ? 'B' : 'unknown';
        for (let k = 0; k < count; k++) {
          entry.cells.push({ archetypeKey: arch.key, replicate: r.run_index, order: 'AB', agent: `syn${k}`, stance, confidence: 0, evidenceGrade: 'none' });
        }
      }
    }
  }

  const cases = [];
  for (const [slug, { meta, cells }] of bySlug) {
    cases.push({
      id: slug,
      label: meta.anchor_label || mapLegacyLabel(meta.expected_equipoise),
      absolute: meta.absolute,
      pediatric: meta.is_pediatric,
      features: computeFeatures(cells),
    });
  }

  return {
    cases,
    partial: {
      source: 'panel_runs(benchmark_probe)',
      computable: ['between_archetype_modal_variance', 'within_archetype_stance_entropy'],
      not_computable: ['choice_lability_rate (single option order stored)', 'confidence.by_grade (evidenceGrade/per-cell confidence not persisted)'],
      note: 'gate rehearsed on modal-variance + entropy only; a production release gate needs a fresh detector grid run',
    },
  };
}

/** Fallback when anchor_label overlay is absent — coarse map of the legacy 3-class enum. */
function mapLegacyLabel(expected) {
  if (expected === 'settled_conservative' || expected === 'settled_operative') return 'settled';
  if (expected === 'genuine_equipoise') return 'patient_dependent'; // which-option split unknowable here
  return null;
}

export default replayFromPanelRuns;
