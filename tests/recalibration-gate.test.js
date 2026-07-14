/**
 * Recalibration Level 1 threshold derivation + release gate.
 */
import { deriveThreshold } from '../recalibration/levels/level1.js';
import { assertGate, GateError } from '../recalibration/gate.js';
import { recalibrate } from '../recalibration/index.js';
import { artifactPath } from '../recalibration/artifacts.js';

const feat = (mv, ent, lab = 0) => ({
  between_archetype_modal_variance: mv, within_archetype_stance_entropy: ent, choice_lability_rate: lab,
  confidence: { mean: 0.8 },
});

// Separable set: patient_dependent flips (high modal variance), evidence_split splits (high entropy),
// settled is quiet on both.
const separable = [
  { id: 'pd1', label: 'patient_dependent', absolute: false, features: feat(0.22, 0) },
  { id: 'pd2', label: 'patient_dependent', absolute: false, features: feat(0.20, 0) },
  { id: 'es1', label: 'evidence_split', absolute: false, features: feat(0, 1.0) },
  { id: 'es2', label: 'evidence_split', absolute: false, features: feat(0, 0.9) },
  { id: 'st1', label: 'settled', absolute: false, features: feat(0, 0) },
  { id: 'st2', label: 'settled', absolute: false, features: feat(0, 0.1) },
  { id: 'eq1', label: 'equivalent_options', absolute: false, features: feat(0, 0, 0.5) },
  { id: 'abs1', label: 'settled', absolute: true, features: feat(0.2, 0) }, // segmented, not scored for spec
];

const target = { targetSensitivity: 0.85, minSpecificity: 0.8 };

describe('deriveThreshold', () => {
  test('separable data → gate passes at target', () => {
    const r = deriveThreshold(separable, target);
    expect(r.gate_passed).toBe(true);
    expect(r.achieved_sensitivity).toBeGreaterThanOrEqual(0.85);
    expect(r.achieved_specificity).toBeGreaterThanOrEqual(0.8);
    expect(r.coverage.equivalent_options_lability_covered).toBe(1); // lability separately covers equiv-options
  });

  test('absolute-indication settled case is NOT counted in the specificity control arm', () => {
    const r = deriveThreshold(separable, target);
    expect(r.coverage.settled_control_n).toBe(2); // st1, st2 — abs1 segmented out
  });

  test('inseparable data → gate does not pass', () => {
    const bad = [
      { id: 'pd', label: 'patient_dependent', absolute: false, features: feat(0, 0) }, // should fire but quiet
      { id: 'st', label: 'settled', absolute: false, features: feat(0.3, 1) },          // should be quiet but loud
    ];
    const r = deriveThreshold(bad, target);
    expect(r.gate_passed).toBe(false);
  });
});

describe('release gate', () => {
  test('assertGate throws loudly when gate not passed', () => {
    const failing = { gate_passed: false, achieved_sensitivity: 0.5, achieved_specificity: 0.3, threshold: {} };
    expect(() => assertGate(failing, target, { modelVersion: 'm', anchorSetVersion: 'v' })).toThrow(GateError);
  });
  test('assertGate returns the result when passed', () => {
    const ok = { gate_passed: true, achieved_sensitivity: 0.9, achieved_specificity: 0.9, threshold: {} };
    expect(assertGate(ok, target, { modelVersion: 'm', anchorSetVersion: 'v' })).toBe(ok);
  });
});

describe('recalibrate() artifact', () => {
  test('keyed by (model_version, anchor_set_version), calibration_maps null (Level 3 stub)', () => {
    const art = recalibrate('claude-sonnet-4-6', '0.1.0-provisional', { cases: separable, target });
    expect(art.model_version).toBe('claude-sonnet-4-6');
    expect(art.anchor_set_version).toBe('0.1.0-provisional');
    expect(art.calibration_maps).toBeNull();
    expect(art.gate_passed).toBe(true);
    // artifact path encodes both versions
    expect(artifactPath('claude-sonnet-4-6', '0.1.0-provisional')).toMatch(/claude-sonnet-4-6__0.1.0-provisional\.json$/);
  });
});
