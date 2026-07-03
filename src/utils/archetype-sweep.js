/**
 * Shared archetype-flip sweep — the SINGLE SOURCE OF TRUTH for the validated detection method.
 *
 * The equipoise instrument was validated as archetype-flip: run each decision across a few patient
 * archetypes per decision-type axis and call it CONTESTED if the panel's modal answer FLIPS across
 * them (or any archetype is internally split). A single population-level panel gives 0% sensitivity
 * (see docs/divergence-spike-findings.md, "population mode gives 0% equipoise sensitivity"); the
 * archetype sweep is what restored 0.978 sensitivity.
 *
 * This module exists so the OFFLINE benchmark probes (scripts/benchmark-probe.js, src/utils/
 * batch-probe.js) and the LIVE production consult path (src/utils/agent-coordinator.js) run the
 * identical aggregation. They used to duplicate it, which let production silently ship a different
 * (single-population, 0%-sensitivity) detector than the one the headline numbers validated. Everything
 * that produces a persisted panel_run verdict routes through aggregateSweep() so they can never
 * diverge again.
 *
 *   aggregateSweep(groupResults)              — pure: per-axis flip results → {verdict, splitSummary,
 *                                               positions, detail} (benchmark-identical shape).
 *   runArchetypeFlipSweep(dp, type, runPanel) — async: run every (axis × archetype) panel via a
 *                                               caller-supplied transport, then aggregateSweep().
 */
import {
  archetypeGroupsForDecisionType,
  computeArchetypeFlipVerdict,
  combineGroupVerdicts,
} from './archetype-flip.js';

/**
 * Run an async mapper over items with a bounded number in flight. Order-preserving results.
 * Used to cap concurrent panel (LLM) calls during a live-consult sweep so it doesn't burst the
 * rate limit. Aggregation is order-independent, so the cap never changes the verdict.
 * @template T,R
 * @param {T[]} items
 * @param {number} limit - max concurrent invocations (>=1)
 * @param {(item:T, index:number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  const cap = Math.max(1, Math.min(limit || 1, items.length || 1));
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}

/**
 * Aggregate per-axis flip results into one decision-point verdict + benchmark-identical splitSummary.
 * PURE — no I/O. Extracted verbatim from benchmark-probe.js / batch-probe.js.
 *
 * @param {Array<{name:string, flip:{verdict,flipDetected,internalContested,modalByArchetype}, archetypeResults:Array<{key,label,verdict,stanceCounts,deferredCount,positions}>}>} groupResults
 * @returns {{verdict:'converged'|'contested', splitSummary:Object, positions:Array, detail:string}}
 *   positions = the representative single-panel snapshot (the 'average' demand_risk archetype, or the
 *   first group's first archetype) so the card's `panel`/ledger have a concrete per-lens view.
 */
export function aggregateSweep(groupResults) {
  const combined = combineGroupVerdicts(groupResults);
  const repGroup = groupResults.find((g) => g.name === 'demand_risk') || groupResults[0];
  const repArchetypes = repGroup?.archetypeResults || [];
  const repArchetype = repArchetypes.find((a) => a.key === 'average') || repArchetypes[0] || {};
  const splitSummary = {
    method: 'archetype_flip',
    verdict: combined.verdict,
    contestedBy: combined.contestedBy,
    // The representative single-patient snapshot (the 'average' demand_risk archetype) supplies the
    // per-lens stance distribution the synthesizer needs — the support score, the binary suppression
    // guard, and theSplit all key off stanceCounts/sides. Without this, an archetype card (whose top
    // level otherwise carries only method/contestedBy/groups) would suppress as non-binary-unmapped.
    stanceCounts: repArchetype.stanceCounts || {},
    deferredCount: repArchetype.deferredCount ?? 0,
    ...(repArchetype.sides ? { sides: repArchetype.sides } : {}),
    groups: groupResults.map((g) => ({
      name: g.name,
      verdict: g.flip.verdict,
      flipDetected: g.flip.flipDetected,
      internalContested: g.flip.internalContested,
      modalByArchetype: g.flip.modalByArchetype,
      archetypes: g.archetypeResults.map(({ key, label, verdict, stanceCounts, deferredCount }) => ({
        key,
        label,
        verdict,
        stanceCounts,
        deferredCount,
      })),
    })),
  };
  const positions = repArchetype.positions || [];
  const detail =
    groupResults
      .map((g) => `${g.name}=${g.flip.verdict === 'contested' ? (g.flip.flipDetected ? 'flip' : 'split') : 'stable'}`)
      .join(' ') + (combined.verdict === 'contested' ? ` → CONTESTED(${combined.contestedBy.join(',')})` : '');

  return { verdict: combined.verdict, splitSummary, positions, detail };
}

/**
 * Run the full archetype-flip sweep for ONE decision point through a caller-supplied panel transport,
 * then aggregate. The transport decides HOW a single population panel is run (synchronous conference
 * call, batch replay, mock); this function owns the axis/archetype fan-out + combine, identically for
 * every caller.
 *
 * @param {{id,question,options}} decisionPoint
 * @param {string|null} decisionType - selects axis groups (null → the default demand_risk axis)
 * @param {(decisionPoint:Object, archetypeCase:Object) => Promise<{verdict:string, splitSummary:{stanceCounts:Object, deferredCount:number}, positions:Array}>} runPanel
 *   runs ONE population panel for one archetype case; returns a conference perDecisionPoint entry.
 * @param {{limit?:number}} [opts] - limit: max concurrent panels per axis (default 2 ≈ 8 LLM calls).
 * @returns {Promise<{verdict, splitSummary, positions, detail}>}
 */
export async function runArchetypeFlipSweep(decisionPoint, decisionType, runPanel, opts = {}) {
  const limit = opts.limit ?? 2;
  const groups = archetypeGroupsForDecisionType(decisionType);
  const groupResults = [];
  for (const group of groups) {
    const archetypeResults = await mapLimit(group.set, limit, async (arch) => {
      const s = await runPanel(decisionPoint, { archetype: arch.label, ...arch.case });
      return {
        key: arch.key,
        label: arch.label,
        verdict: s.verdict,
        stanceCounts: s.splitSummary.stanceCounts,
        deferredCount: s.splitSummary.deferredCount,
        positions: s.positions,
      };
    });
    groupResults.push({
      name: group.name,
      flip: computeArchetypeFlipVerdict(archetypeResults, { minModalSupport: group.minModalSupport }),
      archetypeResults,
    });
  }
  return aggregateSweep(groupResults);
}

export default runArchetypeFlipSweep;
