/**
 * GET /equipoise/stats logic (src/utils/equipoise-stats.js) — no HTTP boot, matches repo pattern of
 * testing route logic as pure/injectable functions. Fixtures deliberately use values that differ from
 * the real committed release artifact, so a passing assertion proves the payload is DERIVED from the
 * artifact/anchor-set inputs rather than a hardcoded constant.
 */
import { describe, test, expect, jest } from '@jest/globals';

const fixtureArtifact = {
  model_version: 'same_family_multi_version',
  anchor_set_version: '0.2.0-ratified',
  gate_passed: true,
  achieved_sensitivity: 0.7777,
  achieved_specificity: 0.8888,
  threshold: {
    between_archetype_modal_variance: 0.2222,
    within_archetype_stance_entropy: 0.3546,
  },
  calibration_maps: {
    per_agent: {
      agentA: { degenerate: true, accuracy: 1, n: 10 },
      agentB: { degenerate: true, accuracy: 1, n: 5 },
    },
    skipped: {},
    uncalibrated: ['agentC'],
  },
  report: {
    per_class_sensitivity: {
      patient_dependent: { p: 0.8, lo: 0.6, hi: 0.9, successes: 8, n: 10 },
      evidence_split: { p: 0.75, lo: 0.5, hi: 0.9, successes: 6, n: 8 },
    },
    specificity: { p: 0.9, lo: 0.8, hi: 0.95, successes: 18, n: 20 },
    entropy_lift: {
      evidence_split_at_operating_point: {
        n: 8,
        recall_full: 0.75,
        recall_modal_only: 0.5,
        entropy_adds_lift: true,
      },
      modal_only_gate: { reaches_target: false },
    },
  },
};

const fixtureManifest = {
  anchor_set_version: '0.2.0-ratified',
  case_count: 20,
  active_case_count: 18,
  label_breakdown: { patient_dependent: 5, evidence_split: 4, equivalent_options: 3, settled: 8 },
};

function makeFixtureCases() {
  const strata = [
    ...Array(3).fill('editorialized'),
    ...Array(9).fill('quietly_contested'),
    ...Array(8).fill('n_a'),
  ];
  return strata.map((controversy_stratum, i) => ({ id: `case-${i}`, controversy_stratum }));
}

const fixtureTargetOperatingPoint = { target_sensitivity: 0.85, min_specificity: 0.8 };

jest.unstable_mockModule('../recalibration/artifacts.js', () => ({
  loadArtifact: jest.fn(() => fixtureArtifact),
}));

jest.unstable_mockModule('../anchor-set/index.js', () => ({
  loadManifest: jest.fn(() => fixtureManifest),
  loadCases: jest.fn(() => makeFixtureCases()),
  anchorSetVersion: jest.fn(() => '0.2.0-ratified'),
  loadTargetOperatingPoint: jest.fn(() => fixtureTargetOperatingPoint),
}));

const {
  buildAnchorSummary,
  buildDetectorSummary,
  buildValiditySummary,
  buildAdminOperational,
  getEquipoiseStats,
  getEquipoiseAdminStats,
} = await import('../src/utils/equipoise-stats.js');
const { equipoiseStatsSchema } = await import('../src/schemas/equipoise-stats.js');

function makeMockSql(byModelRows, benchmarkRows) {
  return jest.fn((strings) => {
    const q = strings.join('').toLowerCase();
    if (q.includes('v_convergence_by_model')) return Promise.resolve(byModelRows);
    if (q.includes('v_benchmark_accuracy')) return Promise.resolve(benchmarkRows);
    return Promise.resolve([]);
  });
}

describe('buildAnchorSummary — pure', () => {
  test('derives version/total/active/by_class from the manifest, by_stratum from cases', () => {
    const summary = buildAnchorSummary(fixtureManifest, makeFixtureCases());
    expect(summary).toEqual({
      version: '0.2.0-ratified',
      total: 20,
      active: 18,
      by_class: { patient_dependent: 5, evidence_split: 4, equivalent_options: 3, settled: 8 },
      by_stratum: { editorialized: 3, quietly_contested: 9, n_a: 8 },
    });
  });

  test('changing the manifest changes the output (not a hardcoded constant)', () => {
    const otherManifest = { ...fixtureManifest, case_count: 999, label_breakdown: { settled: 999 } };
    const summary = buildAnchorSummary(otherManifest, []);
    expect(summary.total).toBe(999);
    expect(summary.by_class).toEqual({ settled: 999 });
    expect(summary.by_stratum).toEqual({});
  });
});

describe('buildDetectorSummary — pure', () => {
  test('sensitivity/specificity/gate_passed/per_class come from the artifact, not a constant', () => {
    const detector = buildDetectorSummary(fixtureArtifact, fixtureTargetOperatingPoint);
    expect(detector.gate_passed).toBe(true);
    expect(detector.sensitivity).toBe(0.7777);
    expect(detector.specificity).toBe(0.8888);
    expect(detector.target).toEqual({ sensitivity: 0.85, specificity: 0.8 });
    expect(detector.per_class).toEqual([
      { label: 'patient_dependent', p: 0.8, lo: 0.6, hi: 0.9, n: 10 },
      { label: 'evidence_split', p: 0.75, lo: 0.5, hi: 0.9, n: 8 },
    ]);
    expect(detector.entropy_lift_summary).toEqual({
      recall_full: 0.75,
      recall_modal_only: 0.5,
      entropy_adds_lift: true,
      modal_only_reaches_target: false,
    });
  });

  test('honesty guard: calibration_status is a derived status string, never raw curve content', () => {
    const detector = buildDetectorSummary(fixtureArtifact, fixtureTargetOperatingPoint);
    expect(detector.calibration_status).toBe('pending (needs harder outcome set)');
    expect(JSON.stringify(detector)).not.toMatch(/platt|isotonic|blocks/i);
  });

  test('calibration_status flips to fitted once at least one agent is non-degenerate', () => {
    const artifact = {
      ...fixtureArtifact,
      calibration_maps: {
        ...fixtureArtifact.calibration_maps,
        per_agent: {
          agentA: { degenerate: false, accuracy: 0.7, n: 40 },
          agentB: { degenerate: true, accuracy: 1, n: 5 },
        },
      },
    };
    const detector = buildDetectorSummary(artifact, fixtureTargetOperatingPoint);
    expect(detector.calibration_status).toBe('fitted');
  });
});

describe('buildAdminOperational — pure', () => {
  test('splits calibration_maps.per_agent into fitted vs degenerate, surfaces uncalibrated/skipped', () => {
    const operational = buildAdminOperational(fixtureArtifact);
    expect(operational.calibration_coverage).toEqual({
      fitted: ['agentA', 'agentB'],
      degenerate: ['agentA', 'agentB'],
      uncalibrated: ['agentC'],
      skipped: [],
    });
    expect(operational.gate_passed).toBe(true);
    expect(operational.achieved_sensitivity).toBe(0.7777);
    expect(operational.threshold).toEqual(fixtureArtifact.threshold);
  });
});

describe('buildValiditySummary — pure', () => {
  test('surfaces only conclusions + provenance from the committed validation doc', () => {
    const doc = {
      cue_injection: {
        overall_confidence_delta: -0.04,
        gap_of_deltas: 0.001,
        gap_of_deltas_ci: [-0.01, 0.01],
        cases_showing_inflation: '0/57',
        conclusion: 'no recognition contamination',
        batch_id: 'msgbatch_test1',
      },
      masked_evidence: {
        confidence_by_grade: { low: 0.4, moderate: 0.6, high: 0.7 },
        no_difference_deferral: '100%',
        strong_evidence_follow: '75%',
        conclusion: 'the panel appraises supplied evidence',
        batch_id: 'msgbatch_test2',
      },
    };
    const validity = buildValiditySummary(doc);
    expect(validity.recognition_contamination).toBe('none');
    expect(validity.appraisal).toBe('confirmed');
    expect(validity.cue_injection.batch_id).toBe('msgbatch_test1');
    expect(validity.masked_evidence.batch_id).toBe('msgbatch_test2');
  });
});

describe('getEquipoiseStats — orchestrator (mocked loaders)', () => {
  test('assembles a schema-valid public payload from the mocked artifact/anchor-set', async () => {
    const payload = await getEquipoiseStats({ sql: null });
    expect(payload.anchor_set.by_class.settled).toBe(8);
    expect(payload.detector.sensitivity).toBe(0.7777);
    expect(payload.disclaimer).toMatch(/not clinical proof/);
    expect(payload.convergence).toBeUndefined();
    expect(() => equipoiseStatsSchema.parse(payload)).not.toThrow();
  });

  test('honesty guard: serialized public payload has no calibration curve values or raw stratum gap', () => {
    return getEquipoiseStats({ sql: null }).then((payload) => {
      const json = JSON.stringify(payload);
      expect(json).not.toMatch(/platt|isotonic/i);
      expect(json).not.toMatch(/16\.6/);
    });
  });

  test('a leaked calibration_maps field on the detector object fails schema validation', async () => {
    const payload = await getEquipoiseStats({ sql: null });
    const tampered = { ...payload, detector: { ...payload.detector, calibration_maps: fixtureArtifact.calibration_maps } };
    expect(() => equipoiseStatsSchema.parse(tampered)).toThrow();
  });

  test('DB is optional — omits convergence when sql is null, includes it when sql resolves rows', async () => {
    const withoutDb = await getEquipoiseStats({ sql: null });
    expect(withoutDb.convergence).toBeUndefined();

    const mockSql = makeMockSql([{ slug: 'x', convergence_rate: 0.5 }], [{ slug: 'x', detector_hit_rate: 0.9 }]);
    const withDb = await getEquipoiseStats({ sql: mockSql });
    expect(withDb.convergence.by_model).toEqual([{ slug: 'x', convergence_rate: 0.5 }]);
    expect(withDb.convergence.benchmark_accuracy).toEqual([{ slug: 'x', detector_hit_rate: 0.9 }]);
  });

  test('a convergence query failure does not break the artifact-derived response', async () => {
    const failingSql = jest.fn(() => Promise.reject(new Error('db unreachable')));
    const payload = await getEquipoiseStats({ sql: failingSql });
    expect(payload.convergence).toBeUndefined();
    expect(payload.detector.gate_passed).toBe(true);
  });
});

describe('getEquipoiseAdminStats — orchestrator (mocked loaders)', () => {
  test('extends the public payload with operational.calibration_coverage', async () => {
    const payload = await getEquipoiseAdminStats({ sql: null });
    expect(payload.operational.calibration_coverage.degenerate).toEqual(['agentA', 'agentB']);
    expect(payload.operational.calibration_coverage.uncalibrated).toEqual(['agentC']);
    expect(payload.anchor_set.by_class.settled).toBe(8);
  });
});
