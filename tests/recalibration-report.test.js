/**
 * Per-class + Wilson CI + entropy-lift reporting.
 */
import { wilson, buildReport } from '../recalibration/report.js';

const feat = (mv, ent) => ({
  between_archetype_modal_variance: mv, within_archetype_stance_entropy: ent, choice_lability_rate: 0,
  confidence: { mean: 0.8 },
});

describe('wilson score interval', () => {
  test('n=0 → widest interval, no estimate', () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1, successes: 0, n: 0 });
  });
  test('symmetric case 5/10 matches the closed form', () => {
    const w = wilson(5, 10);
    expect(w.p).toBeCloseTo(0.5, 6);
    expect(w.lo).toBeCloseTo(0.2366, 3);
    expect(w.hi).toBeCloseTo(0.7634, 3);
  });
  test('bounds stay within [0,1] at the extremes', () => {
    const w = wilson(10, 10);
    expect(w.p).toBe(1);
    expect(w.hi).toBeLessThanOrEqual(1);
    expect(w.lo).toBeGreaterThan(0);
  });
});

describe('buildReport per-class + entropy lift', () => {
  // es_ent fires ONLY on entropy (mv below cutoff); es_modal fires on modal variance.
  const cases = [
    { id: 'es_ent', label: 'evidence_split', absolute: false, features: feat(0, 1.0) },
    { id: 'es_modal', label: 'evidence_split', absolute: false, features: feat(0.25, 0) },
    { id: 'pd1', label: 'patient_dependent', absolute: false, features: feat(0.25, 0) },
    { id: 'st1', label: 'settled', absolute: false, features: feat(0, 0) },
    { id: 'st2', label: 'settled', absolute: false, features: feat(0, 0) },
    { id: 'peds', label: 'evidence_split', pediatric: true, features: feat(0, 1.0) }, // excluded
  ];
  const threshold = { between_archetype_modal_variance: 0.2, within_archetype_stance_entropy: 0.5 };
  const target = { targetSensitivity: 0.85, minSpecificity: 0.8 };

  const rep = buildReport(cases, threshold, target);

  test('per-class sensitivity carries Wilson CIs and excludes pediatric', () => {
    expect(rep.per_class_sensitivity.evidence_split.n).toBe(2); // peds excluded
    expect(rep.per_class_sensitivity.evidence_split.p).toBe(1); // both fire (one on entropy, one on modal)
    expect(rep.per_class_sensitivity.patient_dependent.p).toBe(1);
    expect(rep.specificity.n).toBe(2);
    expect(rep.specificity.p).toBe(1); // settled cases stay quiet
  });

  test('entropy adds lift: one evidence_split case caught only by entropy', () => {
    const el = rep.entropy_lift.evidence_split_at_operating_point;
    expect(el.recall_full).toBe(1);
    expect(el.recall_modal_only).toBe(0.5); // only es_modal fires on modal variance alone
    expect(el.entropy_unique_count).toBe(1);
    expect(el.entropy_unique_ids).toEqual(['es_ent']);
    expect(el.entropy_adds_lift).toBe(true);
  });

  test('modal-only gate summary is reported', () => {
    expect(rep.entropy_lift.modal_only_gate).toHaveProperty('best_youden');
    expect(typeof rep.entropy_lift.modal_only_gate.reaches_target).toBe('boolean');
  });
});
