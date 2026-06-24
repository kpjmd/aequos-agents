/**
 * Pure-data validation of the equipoise seed sets (no DB — fits the no-DATABASE_URL test env).
 * Loads through the same shared loader the seed runner uses, and enforces the moat invariants:
 * binary options, valid ground-truth labels, and — critically — that settled controls are present
 * (guardrail #4: settled controls must never be silently dropped, or v_benchmark_accuracy can't
 * show the detector stays quiet when it should).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDecisionPoints, EXPECTED_COLUMNS } from '../db/seeds/load-decision-points.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EQUIPOISE_LABELS = ['genuine_equipoise', 'settled_conservative', 'settled_operative', 'evolving'];
const PROVENANCE = ['literature', 'guideline', 'expert_consensus', 'md_adjudication'];

const REQUIRED_NONEMPTY = [
  'slug', 'title', 'body_region', 'decision_type', 'canonical_question',
  'option_a_label', 'option_b_label', 'expected_equipoise',
];

describe('decision_points benchmark CSV', () => {
  const rows = loadDecisionPoints();

  test('loads a non-trivial set of rows', () => {
    expect(rows.length).toBeGreaterThanOrEqual(100);
  });

  test('header maps to the expected decision_points columns', () => {
    expect(Object.keys(rows[0]).sort()).toEqual([...EXPECTED_COLUMNS].sort());
  });

  test('every row has required fields non-empty', () => {
    for (const r of rows) {
      for (const col of REQUIRED_NONEMPTY) {
        expect(String(r[col] ?? '').trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('expected_equipoise and label_provenance use valid enum values', () => {
    for (const r of rows) {
      expect(EQUIPOISE_LABELS).toContain(r.expected_equipoise);
      // label_provenance is optional but, when present, must be a valid enum value
      if (String(r.label_provenance ?? '').trim() !== '') {
        expect(PROVENANCE).toContain(r.label_provenance);
      }
    }
  });

  test('is_operative is a strict boolean (independent of expected_equipoise)', () => {
    for (const r of rows) {
      expect(typeof r.is_operative).toBe('boolean');
    }
  });

  test('binary v1: exactly two distinct, non-empty options per row', () => {
    for (const r of rows) {
      const a = String(r.option_a_label ?? '').trim();
      const b = String(r.option_b_label ?? '').trim();
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
      expect(a).not.toBe(b);
    }
  });

  test('slugs are unique', () => {
    const slugs = rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('guardrail #4: all three label classes present (settled controls not dropped)', () => {
    const byLabel = (label) => rows.filter((r) => r.expected_equipoise === label).length;
    expect(byLabel('genuine_equipoise')).toBeGreaterThanOrEqual(1);
    expect(byLabel('settled_conservative')).toBeGreaterThanOrEqual(1);
    expect(byLabel('settled_operative')).toBeGreaterThanOrEqual(1);
  });
});

describe('model_versions seed', () => {
  const models = JSON.parse(
    readFileSync(join(__dirname, '..', 'db', 'seeds', 'model-versions.json'), 'utf8')
  );

  test('each entry has provider + model_string', () => {
    for (const m of models) {
      expect(String(m.provider ?? '').trim().length).toBeGreaterThan(0);
      expect(String(m.model_string ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  test('model_string values are unique', () => {
    const strings = models.map((m) => m.model_string);
    expect(new Set(strings).size).toBe(strings.length);
  });
});
