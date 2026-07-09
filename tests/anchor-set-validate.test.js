/**
 * Anchor-set schema + set-level validation.
 */
import { validateCase, LABELS, CONTESTED_LABELS, SCHEMA_VERSION } from '../anchor-set/schema/case-schema.js';
import { runSetValidation } from '../anchor-set/scripts/validate-lib.mjs';

function goodCase(over = {}) {
  return {
    id: 'x-case',
    schema_version: SCHEMA_VERSION,
    decision_point: 'A vs B?',
    options: ['A', 'B'],
    clinical_vignette: 'typical adult…',
    label: 'patient_dependent',
    label_rationale: 'because',
    controversy_stratum: 'quietly_contested',
    source_citations: [],
    provenance: {
      legacy_slug: 'x-case', legacy_expected_equipoise: 'genuine_equipoise', legacy_decision_type: 'conservative_vs_operative',
      legacy_label_provenance: 'literature', legacy_body_region: 'knee', legacy_is_operative: true,
      absolute_indication: false, is_pediatric: false,
    },
    reviews: [{ reviewer: 'md', review_date: null, review_status: 'provisional', proposed_by: 'deterministic', notes: '' }],
    ...over,
  };
}

describe('case schema', () => {
  test('a well-formed case passes', () => {
    expect(validateCase(goodCase()).ok).toBe(true);
  });

  test('settled case must have stratum n_a', () => {
    const bad = validateCase(goodCase({ label: 'settled', controversy_stratum: 'editorialized' }));
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toMatch(/controversy_stratum/);
    expect(validateCase(goodCase({ label: 'settled', controversy_stratum: 'n_a' })).ok).toBe(true);
  });

  test('contested case may not have stratum n_a', () => {
    const bad = validateCase(goodCase({ label: 'evidence_split', controversy_stratum: 'n_a' }));
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toMatch(/controversy_stratum/);
  });

  test('options must be exactly 2', () => {
    expect(validateCase(goodCase({ options: ['A'] })).ok).toBe(false);
  });

  test('label must be in the enum', () => {
    expect(validateCase(goodCase({ label: 'genuine_equipoise' })).ok).toBe(false);
  });

  test('reviews must be a non-empty list', () => {
    expect(validateCase(goodCase({ reviews: [] })).ok).toBe(false);
  });
});

describe('set-level validation', () => {
  const deps = { validateCase, LABELS, CONTESTED_LABELS };
  function fullSet() {
    return [
      goodCase({ id: 'a', label: 'patient_dependent', controversy_stratum: 'editorialized' }),
      goodCase({ id: 'b', label: 'evidence_split', controversy_stratum: 'quietly_contested' }),
      goodCase({ id: 'c', label: 'equivalent_options', controversy_stratum: 'quietly_contested' }),
      goodCase({ id: 'd', label: 'settled', controversy_stratum: 'n_a' }),
    ];
  }

  test('a set with all 4 labels + both strata + matching manifest is OK', () => {
    const cases = fullSet();
    const r = runSetValidation(cases, { case_count: cases.length }, deps);
    expect(r.ok).toBe(true);
  });

  test('missing a label class fails coverage', () => {
    const cases = fullSet().filter((c) => c.label !== 'equivalent_options');
    const r = runSetValidation(cases, { case_count: cases.length }, deps);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/equivalent_options/);
  });

  test('missing a contested stratum fails', () => {
    const cases = fullSet().map((c) => (c.controversy_stratum === 'editorialized' ? { ...c, label: 'settled', controversy_stratum: 'n_a' } : c));
    const r = runSetValidation(cases, { case_count: cases.length }, deps);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/editorialized/);
  });

  test('MANIFEST count mismatch is caught', () => {
    const cases = fullSet();
    const r = runSetValidation(cases, { case_count: 999 }, deps);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/MANIFEST/);
  });

  test('duplicate ids are caught', () => {
    const cases = [...fullSet(), goodCase({ id: 'a', label: 'settled', controversy_stratum: 'n_a' })];
    const r = runSetValidation(cases, { case_count: cases.length }, deps);
    expect(r.errors.join()).toMatch(/duplicate/);
  });
});
