/**
 * Deterministic CSV → anchor-case mapping.
 */
import {
  deterministicLabel, heuristicOptionClass, heuristicStratum, buildVignette, rowToCase,
  KNOWN_EQUIVALENT_OPTIONS,
} from '../anchor-set/scripts/lib/mapping.mjs';
import { SCHEMA_VERSION } from '../anchor-set/schema/case-schema.js';

const row = (over = {}) => ({
  slug: 'r', title: 't', body_region: 'knee', decision_type: 'conservative_vs_operative', is_operative: true,
  canonical_question: 'A vs B?', option_a_label: 'A', option_b_label: 'B',
  expected_equipoise: 'genuine_equipoise', equipoise_rationale: 'why', label_provenance: 'literature', ...over,
});

describe('deterministic label mapping', () => {
  test('settled_* → settled (mechanical)', () => {
    expect(deterministicLabel(row({ expected_equipoise: 'settled_conservative' }))).toEqual({ label: 'settled', needsJudgment: false });
    expect(deterministicLabel(row({ expected_equipoise: 'settled_operative' }))).toEqual({ label: 'settled', needsJudgment: false });
  });

  test('genuine × conservative_vs_operative / timing → patient_dependent (mechanical)', () => {
    expect(deterministicLabel(row({ decision_type: 'conservative_vs_operative' }))).toEqual({ label: 'patient_dependent', needsJudgment: false });
    expect(deterministicLabel(row({ decision_type: 'timing_of_surgery' }))).toEqual({ label: 'patient_dependent', needsJudgment: false });
  });

  test('genuine × which_* needs judgment (LLM proposes evidence_split | equivalent_options)', () => {
    expect(deterministicLabel(row({ decision_type: 'which_operation' }))).toEqual({ label: null, needsJudgment: true });
    expect(deterministicLabel(row({ decision_type: 'which_intervention' }))).toEqual({ label: null, needsJudgment: true });
  });
});

describe('heuristic fallbacks', () => {
  test('known-equivalent slugs → equivalent_options, others → evidence_split', () => {
    const known = [...KNOWN_EQUIVALENT_OPTIONS][0];
    expect(heuristicOptionClass(row({ slug: known }))).toBe('equivalent_options');
    expect(heuristicOptionClass(row({ slug: 'some-random-which-op' }))).toBe('evidence_split');
  });

  test('stratum defaults to quietly_contested unless curated editorialized', () => {
    expect(heuristicStratum(row({ slug: 'unknown' }))).toBe('quietly_contested');
    expect(heuristicStratum(row({ slug: 'acl-graft-choice' }))).toBe('editorialized');
  });
});

describe('rowToCase assembly', () => {
  const opts = { reviewer: 'md', schemaVersion: SCHEMA_VERSION };
  const heuristicJudgment = { label: 'evidence_split', stratum: 'quietly_contested', proposedBy: 'deterministic' };

  test('carries provenance from the CSV row + overlays', () => {
    const c = rowToCase(row({ decision_type: 'which_operation' }), { absolute: true, pediatric: false }, heuristicJudgment, opts);
    expect(c.provenance.legacy_expected_equipoise).toBe('genuine_equipoise');
    expect(c.provenance.legacy_decision_type).toBe('which_operation');
    expect(c.provenance.absolute_indication).toBe(true);
    expect(c.label).toBe('evidence_split');
  });

  test('pediatric rows are FLAGGED, not dropped', () => {
    const c = rowToCase(row(), { absolute: false, pediatric: true }, heuristicJudgment, opts);
    expect(c.provenance.is_pediatric).toBe(true);
    expect(c.label).toBe('patient_dependent'); // still labeled
  });

  test('settled case gets stratum n_a and mechanical proposed_by', () => {
    const c = rowToCase(row({ expected_equipoise: 'settled_operative', decision_type: 'conservative_vs_operative' }), { absolute: false, pediatric: false }, heuristicJudgment, opts);
    expect(c.label).toBe('settled');
    expect(c.controversy_stratum).toBe('n_a');
    expect(c.reviews[0].proposed_by).toBe('deterministic');
  });

  test('vignette is the deterministic template (no LLM)', () => {
    const v = buildVignette(row());
    expect(v).toMatch(/typical adult/i);
    expect(v).toMatch(/A vs B\?/);
    expect(v).toMatch(/1\. A/);
  });
});
