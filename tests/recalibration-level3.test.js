/**
 * Recalibration Level 3 — per-agent Platt/isotonic calibration + masked-evidence outcome adapter.
 */
import { fitPlatt, applyPlatt, fitIsotonic, applyIsotonic, level3, level3FromOutcomePairs } from '../recalibration/levels/level3.js';
import { outcomePairsFromRows } from '../recalibration/outcome-from-masked.js';

// Synthetic monotone signal: higher confidence → more likely correct.
function monotonePairs() {
  const pairs = [];
  for (let i = 0; i < 200; i++) {
    const x = i / 200; // confidence in [0,1)
    // Correct with probability increasing in x; deterministic split at 0.5 for a clean monotone target.
    pairs.push({ x, y: x > 0.5 ? 1 : 0 });
  }
  return pairs;
}

describe('fitPlatt', () => {
  test('recovers an increasing calibration on monotone data', () => {
    const map = fitPlatt(monotonePairs());
    expect(map.n).toBe(200);
    const lo = applyPlatt(map, 0.1);
    const hi = applyPlatt(map, 0.9);
    expect(hi).toBeGreaterThan(lo);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
  });
  test('empty → degenerate map', () => {
    expect(fitPlatt([]).n).toBe(0);
  });
});

describe('fitIsotonic', () => {
  test('produces a non-decreasing step map', () => {
    const map = fitIsotonic(monotonePairs());
    let prev = -1;
    for (const blk of map.blocks) { expect(blk.y).toBeGreaterThanOrEqual(prev); prev = blk.y; }
  });
  test('pools an adjacent violator (PAV)', () => {
    // Two points out of order → pooled to their mean.
    const map = fitIsotonic([{ x: 0.2, y: 1 }, { x: 0.4, y: 0 }]);
    expect(map.blocks.length).toBe(1);
    expect(map.blocks[0].y).toBeCloseTo(0.5);
  });
  test('applyIsotonic is monotone across the range', () => {
    const map = fitIsotonic(monotonePairs());
    expect(applyIsotonic(map, 0.9)).toBeGreaterThanOrEqual(applyIsotonic(map, 0.1));
  });
});

describe('level3 per-agent grouping', () => {
  test('fits agents above the min-sample floor, skips those below', () => {
    const features = [];
    const labels = [];
    // painWhisperer: 20 pairs (fit). movementDetective: 3 pairs (skipped).
    for (let i = 0; i < 20; i++) { features.push({ agent: 'painWhisperer', confidence: i / 20 }); labels.push(i > 10 ? 1 : 0); }
    for (let i = 0; i < 3; i++) { features.push({ agent: 'movementDetective', confidence: 0.5 }); labels.push(1); }
    const { calibration_maps } = level3(features, labels);
    expect(calibration_maps.per_agent.painWhisperer).toBeTruthy();
    expect(calibration_maps.per_agent.painWhisperer.n).toBe(20);
    expect(calibration_maps.per_agent.movementDetective).toBeUndefined();
    expect(calibration_maps.skipped.movementDetective.n).toBe(3);
  });
});

describe('masked-evidence outcome adapter', () => {
  const rows = [
    { agent: 'painWhisperer', confidence: 0.9, stance: 'A', evidenceStructure: { effect_direction: 'A' } }, // correct
    { agent: 'painWhisperer', confidence: 0.4, stance: 'B', evidenceStructure: { effect_direction: 'A' } }, // wrong
    { agent: 'strengthSage', confidence: 0.8, stance: 'B', evidenceStructure: { effect_direction: 'B' } },  // correct
    { agent: 'strengthSage', confidence: 0.5, stance: 'defer', evidenceStructure: { effect_direction: 'none' } }, // dropped
  ];
  test('correct = (stance === effect_direction); none-direction rows dropped', () => {
    const pairs = outcomePairsFromRows(rows);
    expect(pairs).toHaveLength(3);
    expect(pairs.find((p) => p.confidence === 0.9).correct).toBe(1);
    expect(pairs.find((p) => p.confidence === 0.4).correct).toBe(0);
  });

  test('a deferral on a directional row is EXCLUDED, not scored as wrong', () => {
    const withDefer = [
      { agent: 'painWhisperer', confidence: 0.7, stance: 'defer', evidenceStructure: { effect_direction: 'A' } },
      { agent: 'painWhisperer', confidence: 0.8, stance: 'A', evidenceStructure: { effect_direction: 'A' } },
    ];
    const pairs = outcomePairsFromRows(withDefer);
    expect(pairs).toHaveLength(1); // the defer dropped, not counted as correct=0
    expect(pairs[0].correct).toBe(1);
  });
  test('level3FromOutcomePairs bridges to (features, labels)', () => {
    const pairs = [];
    for (let i = 0; i < 12; i++) pairs.push({ agent: 'painWhisperer', confidence: i / 12, correct: i > 6 ? 1 : 0 });
    const { calibration_maps } = level3FromOutcomePairs(pairs);
    expect(calibration_maps.per_agent.painWhisperer.n).toBe(12);
  });
});
