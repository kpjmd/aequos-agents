/**
 * The four behavioral feature computations (pure).
 */
import {
  betweenArchetypeModalVariance, withinArchetypeStanceEntropy, choiceLabilityRate,
  confidenceStats, computeFeatures, entropyBinary, poolModal,
} from '../detector/features.js';

const cell = (archetypeKey, stance, over = {}) => ({
  archetypeKey, replicate: 1, order: 'AB', agent: 'p', stance, confidence: 0.8, evidenceGrade: 'B', ...over,
});

describe('helpers', () => {
  test('poolModal returns null on tie and on empty', () => {
    expect(poolModal([cell('a', 'A'), cell('a', 'B')])).toBeNull();
    expect(poolModal([cell('a', 'defer')])).toBeNull();
    expect(poolModal([cell('a', 'A'), cell('a', 'A'), cell('a', 'B')])).toBe('A');
  });
  test('entropyBinary is 1 for a balanced split, 0 for unanimous', () => {
    expect(entropyBinary([cell('a', 'A'), cell('a', 'B')])).toBeCloseTo(1);
    expect(entropyBinary([cell('a', 'A'), cell('a', 'A')])).toBe(0);
  });
});

describe('feature 1 — between-archetype modal variance (patient-dependent)', () => {
  test('a modal FLIP across archetypes → variance>0, distinct_modal_count=2', () => {
    const cells = [
      cell('a1', 'A'), cell('a1', 'A'),
      cell('a2', 'A'), cell('a2', 'A'),
      cell('a3', 'B'), cell('a3', 'B'),
    ];
    const r = betweenArchetypeModalVariance(cells);
    expect(r.distinctModalCount).toBe(2);
    expect(r.value).toBeGreaterThan(0);
  });
  test('no flip → variance 0, distinct 1', () => {
    const cells = [cell('a1', 'A'), cell('a2', 'A'), cell('a3', 'A')];
    const r = betweenArchetypeModalVariance(cells);
    expect(r.value).toBe(0);
    expect(r.distinctModalCount).toBe(1);
  });
});

describe('feature 2 — within-archetype entropy (evidence-split)', () => {
  test('a 2-2 within-archetype split → high entropy even with NO between-archetype flip', () => {
    const cells = [
      cell('a1', 'A'), cell('a1', 'A'), cell('a1', 'B'), cell('a1', 'B'),
      cell('a2', 'A'), cell('a2', 'A'), cell('a2', 'B'), cell('a2', 'B'),
    ];
    const bmv = betweenArchetypeModalVariance(cells);
    const ent = withinArchetypeStanceEntropy(cells);
    expect(bmv.value).toBe(0); // both archetypes tie → no modal → no between variance
    expect(ent.value).toBeCloseTo(1);
  });
  test('unanimous archetypes → entropy 0', () => {
    expect(withinArchetypeStanceEntropy([cell('a1', 'A'), cell('a1', 'A')]).value).toBe(0);
  });
});

describe('feature 3 — choice lability (equivalent-options)', () => {
  test('modal flips between AB and BA order → nonzero lability', () => {
    const cells = [
      cell('a1', 'A', { order: 'AB' }), cell('a1', 'A', { order: 'AB' }),
      cell('a1', 'B', { order: 'BA' }), cell('a1', 'B', { order: 'BA' }),
    ];
    const r = choiceLabilityRate(cells);
    expect(r.orderInstability).toBe(1);
    expect(r.value).toBeGreaterThan(0);
  });
  test('stable across order → zero order lability', () => {
    const cells = [
      cell('a1', 'A', { order: 'AB' }), cell('a1', 'A', { order: 'BA' }),
    ];
    expect(choiceLabilityRate(cells).orderInstability).toBe(0);
  });
});

describe('feature 4 — confidence stats (covariate)', () => {
  test('computed over substantive cells, grouped by evidence grade', () => {
    const cells = [
      cell('a1', 'A', { confidence: 0.9, evidenceGrade: 'A' }),
      cell('a1', 'B', { confidence: 0.7, evidenceGrade: 'C' }),
      cell('a1', 'defer', { confidence: 0.0 }), // excluded
    ];
    const r = confidenceStats(cells);
    expect(r.n).toBe(2);
    expect(r.mean).toBeCloseTo(0.8);
    expect(r.byGrade.A).toBeCloseTo(0.9);
  });
});

describe('computeFeatures emits all four with NO threshold/verdict', () => {
  test('shape', () => {
    const f = computeFeatures([cell('a1', 'A'), cell('a2', 'B')]);
    expect(f).toHaveProperty('between_archetype_modal_variance');
    expect(f).toHaveProperty('within_archetype_stance_entropy');
    expect(f).toHaveProperty('choice_lability_rate');
    expect(f).toHaveProperty('confidence');
    expect(f).not.toHaveProperty('verdict');
    expect(f).not.toHaveProperty('threshold');
  });
});
