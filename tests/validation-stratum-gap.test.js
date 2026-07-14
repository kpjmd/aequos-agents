/**
 * Stratum-gap validation slot — detector sensitivity split by controversy_stratum.
 */
import { stratumGap } from '../validation/slots.js';
import { wilson } from '../recalibration/report.js';

const feat = (mv, ent) => ({ between_archetype_modal_variance: mv, within_archetype_stance_entropy: ent, choice_lability_rate: 0 });
const threshold = { between_archetype_modal_variance: 0.2222, within_archetype_stance_entropy: 0.3546 };

// editorialized arm: all fire. quietly_contested arm: half fire. n_a settled ignored (not should-contest).
const cases = [
  { id: 'e1', label: 'patient_dependent', controversy_stratum: 'editorialized', features: feat(0.3, 0) },
  { id: 'e2', label: 'evidence_split', controversy_stratum: 'editorialized', features: feat(0, 0.5) },
  { id: 'q1', label: 'patient_dependent', controversy_stratum: 'quietly_contested', features: feat(0.3, 0) }, // fires
  { id: 'q2', label: 'evidence_split', controversy_stratum: 'quietly_contested', features: feat(0, 0.1) },   // misses
  { id: 's1', label: 'settled', controversy_stratum: 'n_a', features: feat(0, 0) },                          // not scored
];

describe('stratumGap', () => {
  const r = stratumGap(cases, threshold, wilson);

  test('splits sensitivity by stratum and computes per-label breakdown', () => {
    expect(r.by_stratum.editorialized.n).toBe(2);
    expect(r.by_stratum.editorialized.p).toBe(1); // both fire
    expect(r.by_stratum.quietly_contested.n).toBe(2);
    expect(r.by_stratum.quietly_contested.p).toBe(0.5); // one of two fires
    expect(r.by_stratum.editorialized.by_label.patient_dependent.n).toBe(1);
  });

  test('gap = editorialized − quietly_contested', () => {
    expect(r.gap).toBeCloseTo(0.5);
  });

  test('settled cases are excluded from should-contest coverage', () => {
    expect(r.coverage.should_contest_n).toBe(4);
  });

  test('reports the threshold it fired on (derived upstream, not a fresh constant)', () => {
    expect(r.threshold).toEqual(threshold);
  });

  test('null gap when a stratum arm is empty', () => {
    const oneArm = stratumGap([cases[0], cases[1]], threshold, wilson);
    expect(oneArm.gap).toBeNull();
  });
});
