import logger from './logger.js';
import { resolvePersona } from './specialist-identity.js';

/**
 * CoordinationConference — real inter-agent dialogue via triage-framed decision points.
 *
 * Flow (see plan / inter-agent-dialogue-decision memory):
 *   1. Triage identifies genuinely CONTESTED decision points (clinical equipoise).
 *      Clear-cut cases yield an EMPTY list -> gate closed, no further work, no cost.
 *   2. Each specialist states a structured POSITION on each decision point (stance +
 *      reasoning + confidence + evidenceGrade), or defers.
 *   3. Divergence is DETECTED STRUCTURALLY by comparing positions — never self-reported.
 *      A decision point is divergent when >=2 distinct substantive stances clear the
 *      confidence floor. The gate (gateOpen) is true only when real divergence exists;
 *      it controls whether the Step-3 dialogue round runs.
 *
 * Anti-fabrication guarantees:
 *   - We never ask an agent "do you disagree?"; disagreement is computed from positions.
 *   - Deferral and below-floor positions never count as divergence.
 */

const CONFIDENCE_FLOOR = 0.6;        // a stance must clear this to count toward divergence
// Evaluate ALL of triage's contested decision points (schema caps triage at 3), not just the
// top one. Diagnostic finding: positions are stable & genuinely lens-divergent on a well-framed
// equipoise decision, but triage's *ranking* of which decision is "most central" varies run-to-run.
// Capping at 1 gambled on a single decision and missed real splits on the others.
const MAX_DECISION_POINTS = 3;       // cost cap: up to 3 contested decisions × specialists, contested cases only
const POSITION_SPECIALISTS = ['painWhisperer', 'movementDetective', 'strengthSage', 'mindMender'];

export class CoordinationConference {
  constructor() {
    this.dialogueHistory = [];
  }

  /**
   * @param {Map} initialResponses - initial specialist responses (kept for context/compat)
   * @param {Map} specialists - registered specialist agents (keyed by type)
   * @param {Object} caseData
   * @param {Object} options - { mode }
   * @returns {Object} coordination metadata (see emptyMetadata for shape)
   */
  async conductConferenceRound(initialResponses, specialists, caseData, options = {}) {
    const startTime = Date.now();
    const mode = options.mode || 'normal';

    // Fast-mode consults stay fast: skip the position/divergence machinery.
    if (mode === 'fast') {
      return this.emptyMetadata('fast mode — conference skipped');
    }

    try {
      const triage = specialists.get('triage');
      if (!triage || typeof triage.identifyDecisionPoints !== 'function') {
        logger.warn('Conference: triage agent unavailable for decision-point framing');
        return this.emptyMetadata('triage agent unavailable');
      }

      // 1. Triage frames contested decision points (gate 1: empty -> done)
      const allPoints = await triage.identifyDecisionPoints(caseData, { mode: 'fast' });
      const decisionPoints = (allPoints || []).slice(0, MAX_DECISION_POINTS);
      if (decisionPoints.length === 0) {
        logger.info('Conference: no contested decision points — gate closed');
        return this.emptyMetadata('no contested decision points', { decisionPoints: [] });
      }

      // 2-4. Run the shared panel pass (positions -> structural detection -> dialogue) over
      //      triage's contested decision points. Same core the benchmark probe drives.
      const result = await this.runDecisionPoints(decisionPoints, caseData, specialists, { mode });

      logger.info(
        `Conference: ${decisionPoints.length} decision point(s), ${result.positions.length} positions, ` +
        `${result.divergences.length} genuine divergence(s) [gate ${result.gateOpen ? 'OPEN' : 'closed'}]` +
        (result.gateOpen ? `, ${result.interAgentDialogue.length} dialogue turns` : '')
      );

      const metadata = {
        decisionPoints,
        positions: result.positions,
        divergences: result.divergences,
        gateOpen: result.gateOpen,
        interAgentDialogue: result.interAgentDialogue,
        perDecisionPoint: result.perDecisionPoint,
        // Compat keys for existing downstream consumers.
        disagreements: result.divergences,
        emergentFindings: [],
        coordinationDuration: Date.now() - startTime,
        participatingAgents: result.participatingAgents,
        timestamp: new Date().toISOString(),
      };

      this.dialogueHistory.push(metadata);
      return metadata;
    } catch (error) {
      logger.error(`Error in coordination conference: ${error.message}`);
      return this.emptyMetadata(error.message);
    }
  }

  /**
   * Core panel pass over an EXTERNALLY-supplied decision-point list: elicit each specialist's
   * structured position, detect divergence structurally, and (optionally) run the dialogue round.
   * Reused by the live conference (triage-sourced DPs) and the benchmark probe (curated DPs).
   *
   * @param {Array<{id,question,options,rationale?}>} decisionPoints
   * @param {Object} caseData
   * @param {Map} specialists - registered specialist agents keyed by registration key
   * @param {Object} opts - { mode, population, dialogue }
   *   - population: reason at the population level (benchmark) vs for a specific patient (live)
   *   - dialogue: run the Step-3 dialogue round when the gate opens (default true)
   * @returns {Promise<{positions, divergences, gateOpen, interAgentDialogue,
   *                     participatingAgents, perDecisionPoint}>}
   *   perDecisionPoint: one entry per DP (converged OR contested) for benchmark/persistence —
   *   { decisionPoint, verdict, positions(initial+final), divergence, splitSummary }.
   */
  async runDecisionPoints(decisionPoints, caseData, specialists, opts = {}) {
    const mode = opts.mode || 'normal';
    const population = opts.population === true;
    const runDialogue = opts.dialogue !== false; // live behavior: dialogue when the gate opens

    const positionAgents = POSITION_SPECIALISTS
      .map(type => [type, specialists.get(type)])
      .filter(([, agent]) => agent && typeof agent.statePosition === 'function');

    const positionTasks = [];
    for (const dp of decisionPoints) {
      for (const [type, agent] of positionAgents) {
        // Force specialistType to the REGISTRATION key so the dialogue round can route
        // reconsideration back to the same agent via specialists.get(type).
        positionTasks.push(
          agent.statePosition(caseData, dp, { mode, population }).then(p => ({ ...p, specialistType: type }))
        );
      }
    }
    const positions = await Promise.all(positionTasks);

    const divergences = this.detectDivergence(decisionPoints, positions);
    const gateOpen = divergences.length > 0;

    let interAgentDialogue = [];
    if (gateOpen && runDialogue) {
      interAgentDialogue = await this.conductDialogueRound(divergences, caseData, specialists, mode, population);
    }

    // One summary per decision point — verdict is the AUTHORITATIVE detector signal (the gate).
    const perDecisionPoint = decisionPoints.map(dp =>
      this.summarizeDecisionPoint(
        dp,
        positions,
        divergences.find(d => d.decisionPoint.id === dp.id) || null
      )
    );

    return {
      positions,
      divergences,
      gateOpen,
      interAgentDialogue,
      participatingAgents: positionAgents.map(([type]) => type),
      perDecisionPoint,
    };
  }

  /**
   * Per-decision-point summary for benchmark/persistence: the detector verdict plus each agent's
   * initial vs final stance (final differs only where the dialogue round actually revised it).
   * Converged DPs have no divergence -> verdict 'converged', final === initial, no dialogue.
   */
  summarizeDecisionPoint(dp, allPositions, divergence) {
    const dpPositions = allPositions.filter(p => p.decisionPointId === dp.id);
    const verdict = divergence ? 'contested' : 'converged';

    // Map any dialogue revisions back onto each agent's final stance (keyed on registration key).
    const turnByType = new Map();
    for (const turn of (divergence?.dialogue || [])) turnByType.set(turn.specialistType, turn);

    const positions = dpPositions.map(p => {
      const turn = turnByType.get(p.specialistType);
      return {
        specialistType: p.specialistType,
        initialStance: p.stance,
        finalStance: turn ? turn.revisedStance : p.stance,
        revised: turn ? !!turn.changed : false,
        confidence: turn ? turn.confidence : p.confidence,
        reasoning: p.reasoning,
        changeReason: turn?.changeReason ?? null,
        evidenceGrade: p.evidenceGrade,
      };
    });

    const substantive = dpPositions.filter(
      p => p.stance && p.stance !== 'defer' && (p.confidence ?? 0) >= CONFIDENCE_FLOOR
    );
    const stanceCounts = {};
    for (const p of substantive) stanceCounts[p.stance] = (stanceCounts[p.stance] || 0) + 1;

    const splitSummary = {
      verdict,
      distinctStances: [...new Set(substantive.map(p => p.stance))],
      stanceCounts,
      deferredCount: dpPositions.filter(p => p.stance === 'defer').length,
      belowFloor: dpPositions.filter(p => p.stance !== 'defer' && (p.confidence ?? 0) < CONFIDENCE_FLOOR).length,
      sides: divergence?.sides ?? null,
      postDialogue: divergence?.postDialogue ?? null,
    };

    return { decisionPoint: dp, verdict, positions, divergence, splitSummary };
  }

  /**
   * Compare positions per decision point and report genuine divergences.
   * Divergent = >=2 distinct stances among substantive positions (not deferred, >= floor).
   * @param {Array} decisionPoints
   * @param {Array} positions
   * @returns {Array} divergences, each: { decisionPoint, sides[], deferred[], belowFloor }
   */
  detectDivergence(decisionPoints, positions) {
    const divergences = [];

    for (const dp of decisionPoints) {
      const dpPositions = positions.filter(p => p.decisionPointId === dp.id);

      const substantive = dpPositions.filter(
        p => p.stance && p.stance !== 'defer' && (p.confidence ?? 0) >= CONFIDENCE_FLOOR
      );
      const distinctStances = [...new Set(substantive.map(p => p.stance))];

      if (distinctStances.length < 2) continue; // converged or insufficient substantive positions

      const sides = distinctStances.map(stance => ({
        stance,
        specialists: substantive
          .filter(p => p.stance === stance)
          .map(p => ({
            ...resolvePersona(p.specialistType),
            confidence: p.confidence,
            evidenceGrade: p.evidenceGrade,
            reasoning: p.reasoning,
          })),
      }));

      const deferred = dpPositions
        .filter(p => p.stance === 'defer')
        .map(p => ({ ...resolvePersona(p.specialistType), reasoning: p.reasoning }));

      divergences.push({
        decisionPoint: dp,
        sides,
        deferred,
        belowFloor: dpPositions.filter(
          p => p.stance !== 'defer' && (p.confidence ?? 0) < CONFIDENCE_FLOOR
        ).length,
      });
    }

    return divergences;
  }

  /**
   * Dialogue round: for each divergence, every participating specialist reconsiders its
   * position against the OPPOSING positions and holds or revises. Mutates each divergence
   * with `dialogue` (the turns) and `postDialogue` (resolution summary + deltas).
   * @returns {Array} flattened dialogue turns across all divergences
   */
  async conductDialogueRound(divergences, caseData, specialists, mode, population = false) {
    const allDialogue = [];

    for (const div of divergences) {
      const dp = div.decisionPoint;
      // Participants = every specialist that took a substantive side on this decision.
      const participants = div.sides.flatMap(side =>
        side.specialists.map(sp => ({ ...sp, stance: side.stance }))
      );

      const tasks = participants.map(part => {
        const agent = specialists.get(part.specialistType);
        if (!agent || typeof agent.reconsiderPosition !== 'function') return Promise.resolve(null);
        const ownPosition = { stance: part.stance, reasoning: part.reasoning, confidence: part.confidence };
        const opposing = participants
          .filter(o => o.stance !== part.stance)
          .map(o => ({ specialist: o.specialist, stance: o.stance, reasoning: o.reasoning }));
        if (opposing.length === 0) return Promise.resolve(null);
        // Normalize the turn's identity to the canonical persona, keyed off the routing
        // key (registration key) so dialogue joins to sides on a consistent specialistType.
        return agent
          .reconsiderPosition(caseData, dp, ownPosition, opposing, { mode, population })
          .then(turn => (turn ? { ...turn, ...resolvePersona(part.specialistType) } : turn));
      });

      const turns = (await Promise.all(tasks)).filter(Boolean);
      div.dialogue = turns;
      div.postDialogue = this.summarizePostDialogue(turns);
      allDialogue.push(...turns);
    }

    return allDialogue;
  }

  /**
   * Summarize a decision point's dialogue: did the split resolve or persist, and who moved.
   * A persistent split AFTER each side has seen the other is the strongest disagreement signal.
   */
  summarizePostDialogue(turns) {
    const distinctFinal = [...new Set(turns.filter(t => t.revisedStance !== 'defer').map(t => t.revisedStance))];
    const deltas = turns
      .filter(t => t.changed)
      .map(t => ({ specialist: t.specialist, from: t.originalStance, to: t.revisedStance, reason: t.changeReason }));
    return {
      resolved: distinctFinal.length < 2,
      persisted: distinctFinal.length >= 2,
      distinctFinalStances: distinctFinal,
      changedCount: deltas.length,
      deltas,
    };
  }

  /**
   * Uniform empty/closed-gate metadata (keeps downstream consumers safe).
   */
  emptyMetadata(reason, extra = {}) {
    return {
      decisionPoints: extra.decisionPoints || [],
      positions: [],
      divergences: [],
      gateOpen: false,
      interAgentDialogue: [],
      perDecisionPoint: [],
      disagreements: [],
      emergentFindings: [],
      note: reason,
      timestamp: new Date().toISOString(),
      ...extra,
    };
  }

  getStatistics() {
    const n = this.dialogueHistory.length;
    return {
      totalConferences: n,
      averageDivergences: n > 0
        ? this.dialogueHistory.reduce((sum, h) => sum + (h.divergences?.length || 0), 0) / n
        : 0,
      gateOpenRate: n > 0
        ? this.dialogueHistory.filter(h => h.gateOpen).length / n
        : 0,
    };
  }
}

export default CoordinationConference;
