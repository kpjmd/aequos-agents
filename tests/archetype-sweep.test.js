/**
 * Unit tests for the shared archetype-flip sweep (src/utils/archetype-sweep.js) — the single source
 * of truth the live production path and the benchmark probes both run — plus the coordinator's
 * lightweight decision-point framing and the pending card skeleton. No DB, no live LLM (a mock
 * runPanel stands in for the transport), so it fits the no-DATABASE_URL test env.
 */
import { describe, test, expect } from '@jest/globals';
import { aggregateSweep, runArchetypeFlipSweep, mapLimit } from '../src/utils/archetype-sweep.js';
import { CoordinationConference } from '../src/utils/coordination-conference.js';
import { buildEquipoiseCardSkeleton, buildSynthesizerOutput } from '../src/utils/synthesizer.js';

const dp = { id: 'dp-1', question: 'A vs B?', options: ['A', 'B'] };

/**
 * A mock panel transport. `stanceFor(archetypeCase)` decides the panel's modal stance from the
 * archetype's facts, so a test can script a flip (or a stable answer) across archetypes.
 */
const makeRunPanel = (stanceFor) => {
  const calls = [];
  const fn = async (decisionPoint, archetypeCase) => {
    calls.push(archetypeCase);
    const stance = stanceFor(archetypeCase);
    return {
      verdict: 'converged',
      splitSummary: { stanceCounts: stance ? { [stance]: 4 } : {}, deferredCount: stance ? 0 : 4 },
      positions: [{ specialistType: 'painWhisperer', finalStance: stance ?? 'defer', confidence: stance ? 0.8 : 0 }],
    };
  };
  fn.calls = calls;
  return fn;
};

describe('mapLimit', () => {
  test('preserves order and never exceeds the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5, 6, 7];
    const out = await mapLimit(items, 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('runArchetypeFlipSweep', () => {
  test('conservative_vs_operative: modal flips across the demand_risk archetypes → contested', async () => {
    // high demand → Surgery, low demand → Rehab → distinct modals → flip.
    const runPanel = makeRunPanel((c) =>
      /high functional demand/.test(c.activityLevel) ? 'Surgery' : 'Rehab');
    const r = await runArchetypeFlipSweep(dp, 'conservative_vs_operative', runPanel);

    expect(r.verdict).toBe('contested');
    expect(r.splitSummary.method).toBe('archetype_flip');
    expect(r.splitSummary.contestedBy).toEqual(['demand_risk']);
    expect(runPanel.calls).toHaveLength(3); // one axis × 3 archetypes
    // positions come from the representative 'average' demand_risk snapshot.
    expect(r.positions[0].finalStance).toBe('Rehab');
  });

  test('stable modal answer across archetypes → converged', async () => {
    const runPanel = makeRunPanel(() => 'Rehab');
    const r = await runArchetypeFlipSweep(dp, 'conservative_vs_operative', runPanel);
    expect(r.verdict).toBe('converged');
    expect(r.splitSummary.contestedBy).toEqual([]);
  });

  test('which_operation runs all three axes; contestedBy names the axis that flipped', async () => {
    // Flip ONLY on the fracture_pattern axis (constrained context → Plate, else Nail); demand/pathology stable.
    const runPanel = makeRunPanel((c) => {
      if (c.pattern || c.technicalContext) {
        return /constrained|periprosthetic|precise open/.test(c.pattern || c.technicalContext) ? 'Plate' : 'Nail';
      }
      return 'Nail'; // demand_risk + pathology axes: stable
    });
    const r = await runArchetypeFlipSweep(dp, 'which_operation', runPanel);
    expect(runPanel.calls).toHaveLength(9); // 3 axes × 3 archetypes
    expect(r.verdict).toBe('contested');
    expect(r.splitSummary.contestedBy).toEqual(['fracture_pattern']);
  });

  test('timing_of_surgery biological_window is min-support 2: a lone-lens modal cannot manufacture a flip', async () => {
    // demand_risk stable (Wait). biological_window: narrow window → a single lens says "Operate now",
    // the rest defer (below the ≥2 support gate) → must NOT flip.
    const runPanel = async (decisionPoint, c) => {
      if (c.woundContamination) {
        // biological_window archetype
        const lone = /heavily contaminated/.test(c.woundContamination);
        return {
          verdict: 'converged',
          splitSummary: { stanceCounts: lone ? { 'Operate now': 1 } : { Wait: 4 }, deferredCount: lone ? 3 : 0 },
          positions: [],
        };
      }
      return { verdict: 'converged', splitSummary: { stanceCounts: { Wait: 4 }, deferredCount: 0 }, positions: [] };
    };
    const r = await runArchetypeFlipSweep(dp, 'timing_of_surgery', runPanel);
    expect(r.verdict).toBe('converged'); // lone-lens modal discarded by minModalSupport:2
  });
});

describe('aggregateSweep', () => {
  test('produces the benchmark-identical splitSummary shape from group results', () => {
    const groupResults = [{
      name: 'demand_risk',
      flip: { verdict: 'contested', flipDetected: true, internalContested: false, modalByArchetype: { high_demand_low_risk: 'Surgery', average: 'Rehab', low_demand_high_risk: 'Rehab' } },
      archetypeResults: [
        { key: 'high_demand_low_risk', label: 'x', verdict: 'converged', stanceCounts: { Surgery: 4 }, deferredCount: 0, positions: [{ finalStance: 'Surgery' }] },
        { key: 'average', label: 'y', verdict: 'converged', stanceCounts: { Rehab: 3 }, deferredCount: 1, positions: [{ finalStance: 'Rehab' }] },
        { key: 'low_demand_high_risk', label: 'z', verdict: 'converged', stanceCounts: { Rehab: 4 }, deferredCount: 0, positions: [{ finalStance: 'Rehab' }] },
      ],
    }];
    const r = aggregateSweep(groupResults);
    expect(r.verdict).toBe('contested');
    expect(r.splitSummary.method).toBe('archetype_flip');
    expect(r.splitSummary.groups[0].archetypes).toHaveLength(3);
    // positions = the 'average' archetype snapshot.
    expect(r.positions).toEqual([{ finalStance: 'Rehab' }]);
    expect(r.detail).toContain('demand_risk=flip');
  });
});

describe('sweep result → buildSynthesizerOutput (production card fidelity)', () => {
  // Regression: an archetype splitSummary carries method/contestedBy/groups; the synthesizer's support
  // score + binary suppression guard key off top-level stanceCounts. aggregateSweep must surface the
  // representative snapshot's stanceCounts, or every archetype card would suppress as non-binary.
  test('a contested archetype-flip result yields a shown (non-collapsed) contested card', async () => {
    const options = ['Rehabilitation', 'Surgery'];
    const cvoDp = { id: 'acl', question: 'Rehab vs surgery?', options };
    // Positions carry real option-label stances so the binary guard passes.
    const runPanel = makeRunPanel((c) =>
      /high functional demand/.test(c.activityLevel) ? 'Surgery' : 'Rehabilitation');
    const sweep = await runArchetypeFlipSweep(cvoDp, 'conservative_vs_operative', runPanel);

    const perDP = { decisionPoint: cvoDp, verdict: sweep.verdict, positions: sweep.positions, splitSummary: sweep.splitSummary };
    const out = buildSynthesizerOutput(perDP, { treatmentPlan: { plan: 1 } });

    expect(out.collapsed).toBe(false);
    expect(out.status).toBe('contested');
    expect(out.card_json.verdict).toBe('contested');
    expect(out.card_json.contestedBy).toEqual(['demand_risk']);
    expect(out.card_json.whatWouldTipIt.source).toBe('archetype_axis');
    expect(out.support_score).not.toBeNull();
  });

  test('an all-defer representative snapshot suppresses (correctly) as non-binary', async () => {
    const cvoDp = { id: 'x', question: 'A vs B?', options: ['A', 'B'] };
    const runPanel = makeRunPanel(() => null); // every lens defers everywhere
    const sweep = await runArchetypeFlipSweep(cvoDp, 'conservative_vs_operative', runPanel);
    const perDP = { decisionPoint: cvoDp, verdict: sweep.verdict, positions: sweep.positions, splitSummary: sweep.splitSummary };
    const out = buildSynthesizerOutput(perDP, {});
    expect(out.collapsed).toBe(true);
    expect(out.collapse_reason).toBe('non_binary_unmapped');
  });
});

describe('CoordinationConference.frameDecisionPoints', () => {
  const conf = new CoordinationConference();
  const triageWith = (points) => new Map([['triage', { identifyDecisionPoints: async () => points }]]);

  test('returns the framed decision points with an empty divergence layer', async () => {
    const md = await conf.frameDecisionPoints(triageWith([dp]), {}, 'normal');
    expect(md.decisionPoints).toHaveLength(1);
    expect(md.divergences).toEqual([]);
    expect(md.positions).toEqual([]);
    expect(md.gateOpen).toBe(false);
  });

  test('caps at MAX_DECISION_POINTS (3)', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `dp-${i}`, question: 'q', options: ['A', 'B'] }));
    const md = await conf.frameDecisionPoints(triageWith(many), {}, 'normal');
    expect(md.decisionPoints).toHaveLength(3);
  });

  test('fast mode and missing triage both yield an empty decision-point list', async () => {
    expect((await conf.frameDecisionPoints(triageWith([dp]), {}, 'fast')).decisionPoints).toEqual([]);
    expect((await conf.frameDecisionPoints(new Map(), {}, 'normal')).decisionPoints).toEqual([]);
  });
});

describe('buildEquipoiseCardSkeleton', () => {
  test('pending, no verdict, carries options + care plan; route reflects the red-flag flag', () => {
    const skeleton = buildEquipoiseCardSkeleton(dp, { requiresImmediateMD: true, urgencyLevel: 'urgent', treatmentPlan: { plan: 1 } });
    expect(skeleton.pending).toBe(true);
    expect(skeleton.status).toBe('pending');
    expect(skeleton.verdict).toBeNull();
    expect(skeleton.decision).toEqual({ question: 'A vs B?', optionA: 'A', optionB: 'B' });
    expect(skeleton.carePlanHome).toEqual({ plan: 1 });
    expect(skeleton.route.toHuman).toBe(true);
    expect(skeleton.route.label).toBe('Urgent surgical consult');
  });

  test('no red-flag → no routing claim', () => {
    const skeleton = buildEquipoiseCardSkeleton(dp, {});
    expect(skeleton.route.toHuman).toBe(false);
    expect(skeleton.evidenceLedger).toEqual([]);
  });
});
