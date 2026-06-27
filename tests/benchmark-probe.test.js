/**
 * Pure-unit tests for the Phase 2a benchmark-probe building blocks (no DB, no live LLM — fits the
 * no-DATABASE_URL test env). Covers: enum mappers, the detector verdict + initial/final stance
 * summary, population-mode prompt framing, and the stratified sampler's control floor.
 */
import { describe, test, expect } from '@jest/globals';
import { toStanceEnum, toAgentEnum } from '../src/utils/equipoise-mappers.js';
import { stratifiedSample, DEFAULT_PER_TYPE } from '../src/utils/benchmark-sampler.js';
import { computeArchetypeFlipVerdict, archetypesForDecisionType, archetypeGroupsForDecisionType, combineGroupVerdicts } from '../src/utils/archetype-flip.js';
import { CoordinationConference } from '../src/utils/coordination-conference.js';

describe('equipoise-mappers', () => {
  test('toStanceEnum maps options + defer mechanically', () => {
    expect(toStanceEnum('Nonoperative management', 'Nonoperative management', 'ORIF')).toBe('option_a');
    expect(toStanceEnum('ORIF', 'Nonoperative management', 'ORIF')).toBe('option_b');
    expect(toStanceEnum('defer', 'Nonoperative management', 'ORIF')).toBe('abstain');
    expect(toStanceEnum(null, 'A', 'B')).toBe('abstain');
  });

  test('toStanceEnum coerces an off-menu stance to abstain (guard)', () => {
    expect(toStanceEnum('something else', 'A', 'B')).toBe('abstain');
  });

  test('toAgentEnum maps registration keys and snake_case to specialist_agent enum', () => {
    expect(toAgentEnum('painWhisperer')).toBe('pain_whisperer');
    expect(toAgentEnum('movementDetective')).toBe('movement_detective');
    expect(toAgentEnum('strengthSage')).toBe('strength_sage');
    expect(toAgentEnum('mindMender')).toBe('mind_mender');
    expect(toAgentEnum('triage')).toBe('orthotriage');
    expect(toAgentEnum('mind_mender')).toBe('mind_mender'); // already snake
    expect(toAgentEnum('nope')).toBeNull();
  });
});

describe('detector verdict derivation (CoordinationConference)', () => {
  const conf = new CoordinationConference();
  const dp = { id: 'dp-1', question: 'A vs B?', options: ['A', 'B'] };
  const pos = (specialistType, stance, confidence) => ({
    decisionPointId: 'dp-1', specialistType, stance, confidence, reasoning: 'r', evidenceGrade: 'B',
  });

  test('contested: >=2 distinct substantive stances above the floor', () => {
    const positions = [pos('painWhisperer', 'A', 0.8), pos('strengthSage', 'A', 0.7), pos('movementDetective', 'B', 0.8)];
    const divs = conf.detectDivergence([dp], positions);
    expect(divs).toHaveLength(1);
    expect(conf.summarizeDecisionPoint(dp, positions, divs[0]).verdict).toBe('contested');
  });

  test('converged: all the same substantive stance', () => {
    const positions = [pos('painWhisperer', 'A', 0.8), pos('strengthSage', 'A', 0.9), pos('movementDetective', 'A', 0.7)];
    expect(conf.detectDivergence([dp], positions)).toHaveLength(0);
    expect(conf.summarizeDecisionPoint(dp, positions, null).verdict).toBe('converged');
  });

  test('all-defer → converged (deferral is non-divergent)', () => {
    const positions = [pos('painWhisperer', 'defer', 0), pos('strengthSage', 'defer', 0)];
    expect(conf.detectDivergence([dp], positions)).toHaveLength(0);
  });

  test('below-floor distinct stances do not count as divergence', () => {
    const positions = [pos('painWhisperer', 'A', 0.5), pos('movementDetective', 'B', 0.55)];
    expect(conf.detectDivergence([dp], positions)).toHaveLength(0);
  });

  test('summarizeDecisionPoint: final===initial without dialogue, and reflects revisions with it', () => {
    const positions = [pos('painWhisperer', 'A', 0.8), pos('movementDetective', 'B', 0.8)];
    const noDialogue = conf.summarizeDecisionPoint(dp, positions, null);
    expect(noDialogue.positions.every(p => p.finalStance === p.initialStance && p.revised === false)).toBe(true);

    const divergence = {
      decisionPoint: dp,
      sides: [],
      dialogue: [{ specialistType: 'painWhisperer', revisedStance: 'B', changed: true, changeReason: 'moved by X', confidence: 0.7 }],
      postDialogue: { persisted: true },
    };
    const withDialogue = conf.summarizeDecisionPoint(dp, positions, divergence);
    const pw = withDialogue.positions.find(p => p.specialistType === 'painWhisperer');
    expect(pw.initialStance).toBe('A');
    expect(pw.finalStance).toBe('B');
    expect(pw.revised).toBe(true);
    expect(withDialogue.splitSummary.postDialogue).toEqual({ persisted: true });
  });
});

describe('stratifiedSample', () => {
  // Ordered synthetic benchmark: settled controls appear AFTER the genuine rows of their type,
  // so they are NOT picked by per-type slicing — exercising the floor-injection path.
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({ slug: `wo-${i}`, decision_type: 'which_operation', expected_equipoise: 'genuine_equipoise' })),
    ...Array.from({ length: 8 }, (_, i) => ({ slug: `cvo-${i}`, decision_type: 'conservative_vs_operative', expected_equipoise: 'genuine_equipoise' })),
    ...Array.from({ length: 3 }, (_, i) => ({ slug: `sc-${i}`, decision_type: 'conservative_vs_operative', expected_equipoise: 'settled_conservative' })),
    ...Array.from({ length: 3 }, (_, i) => ({ slug: `so-${i}`, decision_type: 'conservative_vs_operative', expected_equipoise: 'settled_operative' })),
    ...Array.from({ length: 3 }, (_, i) => ({ slug: `tos-${i}`, decision_type: 'timing_of_surgery', expected_equipoise: 'genuine_equipoise' })),
    ...Array.from({ length: 3 }, (_, i) => ({ slug: `wi-${i}`, decision_type: 'which_intervention', expected_equipoise: 'genuine_equipoise' })),
  ];

  const count = (sample, pred) => sample.filter(pred).length;

  test('honors per-type counts and the settled-control floor', () => {
    const sample = stratifiedSample(rows, { perType: DEFAULT_PER_TYPE, settledFloor: 2 });
    expect(count(sample, r => r.decision_type === 'which_operation')).toBe(8);
    expect(count(sample, r => r.decision_type === 'timing_of_surgery')).toBe(2);
    expect(count(sample, r => r.decision_type === 'which_intervention')).toBe(2);
    expect(count(sample, r => r.expected_equipoise === 'settled_conservative')).toBeGreaterThanOrEqual(2);
    expect(count(sample, r => r.expected_equipoise === 'settled_operative')).toBeGreaterThanOrEqual(2);
    // unique slugs
    expect(new Set(sample.map(r => r.slug)).size).toBe(sample.length);
  });

  test('limit trims non-controls but preserves the settled floor', () => {
    const sample = stratifiedSample(rows, { perType: DEFAULT_PER_TYPE, settledFloor: 2, limit: 12 });
    expect(sample.length).toBe(12);
    expect(count(sample, r => r.expected_equipoise === 'settled_conservative')).toBeGreaterThanOrEqual(2);
    expect(count(sample, r => r.expected_equipoise === 'settled_operative')).toBeGreaterThanOrEqual(2);
  });
});

describe('computeArchetypeFlipVerdict', () => {
  test('stable modal answer across archetypes → converged', () => {
    const r = computeArchetypeFlipVerdict([
      { key: 'high_demand_low_risk', verdict: 'converged', stanceCounts: { Surgery: 4 } },
      { key: 'average', verdict: 'converged', stanceCounts: { Surgery: 3 } },
      { key: 'low_demand_high_risk', verdict: 'converged', stanceCounts: { Surgery: 4 } },
    ]);
    expect(r.verdict).toBe('converged');
    expect(r.flipDetected).toBe(false);
  });

  test('modal answer flips across archetypes → contested', () => {
    const r = computeArchetypeFlipVerdict([
      { key: 'high_demand_low_risk', verdict: 'converged', stanceCounts: { Surgery: 4 } },
      { key: 'average', verdict: 'converged', stanceCounts: { Conservative: 3 } },
      { key: 'low_demand_high_risk', verdict: 'converged', stanceCounts: { Conservative: 4 } },
    ]);
    expect(r.verdict).toBe('contested');
    expect(r.flipDetected).toBe(true);
    expect(r.distinctOptionModals.sort()).toEqual(['Conservative', 'Surgery']);
  });

  test('an internally-split archetype → contested even without a flip', () => {
    const r = computeArchetypeFlipVerdict([
      { key: 'high_demand_low_risk', verdict: 'contested', stanceCounts: { Surgery: 2, Conservative: 2 } },
      { key: 'average', verdict: 'converged', stanceCounts: { Surgery: 4 } },
      { key: 'low_demand_high_risk', verdict: 'converged', stanceCounts: { Surgery: 4 } },
    ]);
    expect(r.verdict).toBe('contested');
    expect(r.internalContested).toBe(true);
    expect(r.modalByArchetype.high_demand_low_risk).toBe('split');
  });

  test('archetypesForDecisionType picks pathology axis for which_operation, demand_risk otherwise', () => {
    expect(archetypesForDecisionType('which_operation').name).toBe('pathology');
    expect(archetypesForDecisionType('conservative_vs_operative').name).toBe('demand_risk');
    expect(archetypesForDecisionType('timing_of_surgery').name).toBe('demand_risk');
    expect(archetypesForDecisionType('which_intervention').name).toBe('demand_risk');
    expect(archetypesForDecisionType('which_operation').set).toHaveLength(3);
  });

  test('archetypeGroupsForDecisionType: which_operation runs three axes, timing runs two, others demand_risk only', () => {
    const wo = archetypeGroupsForDecisionType('which_operation');
    expect(wo.map(g => g.name).sort()).toEqual(['demand_risk', 'fracture_pattern', 'pathology']);
    const tos = archetypeGroupsForDecisionType('timing_of_surgery');
    expect(tos.map(g => g.name).sort()).toEqual(['biological_window', 'demand_risk']);
    // biological_window is relevance-gated → carries a ≥2 lens min-support to discard lone-lens flips
    expect(tos.find(g => g.name === 'biological_window').minModalSupport).toBe(2);
    expect(tos.find(g => g.name === 'demand_risk').minModalSupport).toBeUndefined();
    const cvo = archetypeGroupsForDecisionType('conservative_vs_operative');
    expect(cvo.map(g => g.name)).toEqual(['demand_risk']);
  });

  test('minModalSupport discards a lone-lens modal so it cannot manufacture a flip', () => {
    // A single dissenting lens (1 of 4, the rest defer) on one archetype vs a 4-lens modal on the
    // others — the hip-fracture-timing false-positive shape. Default counts it (flip); ≥2 discards it.
    const archetypes = [
      { key: 'narrow_window', verdict: 'converged', stanceCounts: { 'Deliberate delay': 1 } },
      { key: 'intermediate_window', verdict: 'converged', stanceCounts: { 'Early surgery': 4 } },
      { key: 'wide_window', verdict: 'converged', stanceCounts: { 'Early surgery': 4 } },
    ];
    expect(computeArchetypeFlipVerdict(archetypes).verdict).toBe('contested');
    const guarded = computeArchetypeFlipVerdict(archetypes, { minModalSupport: 2 });
    expect(guarded.verdict).toBe('converged');
    expect(guarded.modalByArchetype.narrow_window).toBe('abstain');
    // A genuine flip backed by ≥2 lenses each survives the same guard.
    expect(computeArchetypeFlipVerdict([
      { key: 'narrow_window', verdict: 'converged', stanceCounts: { Explore: 4 } },
      { key: 'wide_window', verdict: 'converged', stanceCounts: { Observe: 3 } },
    ], { minModalSupport: 2 }).verdict).toBe('contested');
  });

  test('combineGroupVerdicts: contested if ANY axis is contested', () => {
    expect(combineGroupVerdicts([
      { name: 'pathology', flip: { verdict: 'contested' } },
      { name: 'demand_risk', flip: { verdict: 'converged' } },
    ])).toEqual({ verdict: 'contested', contestedBy: ['pathology'] });

    expect(combineGroupVerdicts([
      { name: 'pathology', flip: { verdict: 'converged' } },
      { name: 'demand_risk', flip: { verdict: 'converged' } },
    ])).toEqual({ verdict: 'converged', contestedBy: [] });
  });

  test('abstain archetypes are ignored for flip detection', () => {
    const r = computeArchetypeFlipVerdict([
      { key: 'high_demand_low_risk', verdict: 'converged', stanceCounts: { Surgery: 3 } },
      { key: 'average', verdict: 'converged', stanceCounts: {} }, // all defer → abstain
      { key: 'low_demand_high_risk', verdict: 'converged', stanceCounts: { Surgery: 4 } },
    ]);
    expect(r.modalByArchetype.average).toBe('abstain');
    expect(r.verdict).toBe('converged');
  });
});

describe('population-mode prompt framing (statePosition)', () => {
  const dp = { id: 'dp-1', question: 'Nonoperative vs ORIF?', options: ['Nonoperative management', 'ORIF'] };

  test('population mode uses population framing and omits <patient_input>; default keeps it', async () => {
    const { PainWhispererAgent } = await import('../src/agents/pain-whisperer-agent.js');
    const agent = new PainWhispererAgent();

    let captured;
    agent.processStructured = async (prompt) => {
      captured = prompt;
      return { reasoning: 'r', stance: 'defer', confidence: 0, evidenceGrade: 'none' };
    };

    await agent.statePosition({ secret: 'PHI' }, dp, { population: true });
    expect(captured).toMatch(/POPULATION level/i);
    expect(captured).toMatch(/TYPICAL adult patient/i);
    expect(captured).not.toContain('<patient_input>');
    expect(captured).not.toContain('PHI');

    await agent.statePosition({ secret: 'PHI' }, dp, { population: false });
    expect(captured).toContain('<patient_input>');
    expect(captured).toContain('PHI');
  });
});
