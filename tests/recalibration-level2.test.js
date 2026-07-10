/**
 * Recalibration Level 2 — percentile / z-score references.
 */
import { percentileRank, zscore, buildLevel2Reference, level2 } from '../recalibration/levels/level2.js';

const refDist = {
  settled: { modal_variance: [0, 0, 0], stance_entropy: [0.1, 0.2], lability: [0], confidence: [0.9, 0.95] },
  patient_dependent: { modal_variance: [0.22, 0.22], stance_entropy: [0], lability: [0], confidence: [0.7, 0.75] },
  evidence_split: { modal_variance: [0], stance_entropy: [0.6, 0.8], lability: [0], confidence: [0.6, null] },
};

describe('percentileRank', () => {
  test('fraction at or below', () => {
    expect(percentileRank([0.6, 0.7, 0.8], 0.7)).toBeCloseTo(2 / 3);
    expect(percentileRank([0.6, 0.7, 0.8], 0.9)).toBe(1);
    expect(percentileRank([0.6, 0.7, 0.8], 0.5)).toBe(0);
  });
  test('empty / null → null', () => {
    expect(percentileRank([], 0.5)).toBeNull();
    expect(percentileRank([0.5], null)).toBeNull();
  });
});

describe('zscore', () => {
  test('standard score', () => {
    expect(zscore(0.5, 0.1, 0.6)).toBeCloseTo(1);
  });
  test('zero spread → 0', () => {
    expect(zscore(0.5, 0, 0.9)).toBe(0);
  });
});

describe('buildLevel2Reference', () => {
  test('pools across labels, drops nulls, sorts', () => {
    const ref = buildLevel2Reference(refDist);
    expect(ref.confidence.sorted).toEqual([0.6, 0.7, 0.75, 0.9, 0.95]); // the null dropped
    expect(ref.confidence.n).toBe(5);
    expect(ref.modal_variance.sorted[0]).toBe(0);
  });
});

describe('level2 mapping', () => {
  const features = {
    between_archetype_modal_variance: 0.22,
    within_archetype_stance_entropy: 0.6,
    choice_lability_rate: 0,
    confidence: { mean: 0.75 },
  };
  test('maps raw feature vector to percentiles + z-scores', () => {
    const { percentiles, z_scores } = level2(refDist, features);
    expect(percentiles.confidence).toBeGreaterThan(0);
    expect(percentiles.confidence).toBeLessThanOrEqual(1);
    expect(typeof z_scores.stance_entropy).toBe('number');
  });

  test('uniform confidence shift preserves percentile ordering (the whole point of Level 2)', () => {
    // Shift every confidence in the reference AND the case by the same +0.05 — percentile must not move.
    const shifted = JSON.parse(JSON.stringify(refDist));
    for (const label of Object.keys(shifted)) {
      shifted[label].confidence = shifted[label].confidence.map((v) => (v == null ? null : v + 0.05));
    }
    const before = level2(refDist, features).percentiles.confidence;
    const after = level2(shifted, { ...features, confidence: { mean: 0.75 + 0.05 } }).percentiles.confidence;
    expect(after).toBeCloseTo(before);
  });
});
