import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import logger from './logger.js';
import { loadArtifact } from '../../recalibration/artifacts.js';
import {
  loadManifest,
  loadCases,
  anchorSetVersion,
  loadTargetOperatingPoint,
} from '../../anchor-set/index.js';
import { equipoiseStatsSchema, equipoiseAdminStatsSchema } from '../schemas/equipoise-stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALIDATION_SUMMARY_PATH = join(__dirname, '..', '..', 'docs', 'equipoise-validation-summary.json');
const MODEL_VERSION = 'same_family_multi_version';

const DISCLAIMER = 'internally validated on an internal benchmark; not clinical proof';

function loadValidationSummary() {
  return JSON.parse(readFileSync(VALIDATION_SUMMARY_PATH, 'utf8'));
}

/** Tally cases by a field (label or controversy_stratum) across every case, active or not. */
function tallyBy(cases, key) {
  return cases.reduce((acc, c) => {
    const v = c[key] ?? 'unknown';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}

export function buildAnchorSummary(manifest, cases) {
  return {
    version: manifest.anchor_set_version,
    total: manifest.case_count,
    active: manifest.active_case_count,
    by_class: manifest.label_breakdown,
    by_stratum: tallyBy(cases, 'controversy_stratum'),
  };
}

/**
 * Derives calibration status from calibration_maps WITHOUT ever surfacing platt/isotonic content —
 * Level 3 is currently degenerate (see docs/equipoise-instrument.md §6), so the honest thing to
 * surface is a status string, never the curve itself.
 */
function deriveCalibrationStatus(calibrationMaps) {
  const perAgent = calibrationMaps?.per_agent || {};
  const fittedAgents = Object.keys(perAgent);
  const allDegenerate = fittedAgents.length === 0 || fittedAgents.every((a) => perAgent[a]?.degenerate);
  return allDegenerate ? 'pending (needs harder outcome set)' : 'fitted';
}

export function buildDetectorSummary(artifact, targetOperatingPoint) {
  const perClass = Object.entries(artifact.report.per_class_sensitivity).map(([label, stats]) => ({
    label,
    p: stats.p,
    lo: stats.lo,
    hi: stats.hi,
    n: stats.n,
  }));

  const entropyLift = artifact.report.entropy_lift?.evidence_split_at_operating_point;
  const modalOnlyGate = artifact.report.entropy_lift?.modal_only_gate;

  return {
    gate_passed: artifact.gate_passed,
    sensitivity: artifact.achieved_sensitivity,
    specificity: artifact.achieved_specificity,
    target: {
      sensitivity: targetOperatingPoint.target_sensitivity,
      specificity: targetOperatingPoint.min_specificity,
    },
    per_class: perClass,
    entropy_lift_summary: entropyLift
      ? {
          recall_full: entropyLift.recall_full,
          recall_modal_only: entropyLift.recall_modal_only,
          entropy_adds_lift: entropyLift.entropy_adds_lift,
          modal_only_reaches_target: modalOnlyGate?.reaches_target ?? null,
        }
      : null,
    calibration_status: deriveCalibrationStatus(artifact.calibration_maps),
  };
}

export function buildValiditySummary(validationDoc) {
  return {
    recognition_contamination: 'none',
    appraisal: 'confirmed',
    cue_injection: {
      overall_confidence_delta: validationDoc.cue_injection.overall_confidence_delta,
      gap_of_deltas: validationDoc.cue_injection.gap_of_deltas,
      gap_of_deltas_ci: validationDoc.cue_injection.gap_of_deltas_ci,
      cases_showing_inflation: validationDoc.cue_injection.cases_showing_inflation,
      conclusion: validationDoc.cue_injection.conclusion,
      batch_id: validationDoc.cue_injection.batch_id,
    },
    masked_evidence: {
      confidence_by_grade: validationDoc.masked_evidence.confidence_by_grade,
      no_difference_deferral: validationDoc.masked_evidence.no_difference_deferral,
      strong_evidence_follow: validationDoc.masked_evidence.strong_evidence_follow,
      conclusion: validationDoc.masked_evidence.conclusion,
      batch_id: validationDoc.masked_evidence.batch_id,
    },
  };
}

export function buildAdminOperational(artifact) {
  const perAgent = artifact.calibration_maps?.per_agent || {};
  const fitted = Object.keys(perAgent);
  const degenerate = fitted.filter((a) => perAgent[a]?.degenerate);
  const skipped = Object.keys(artifact.calibration_maps?.skipped || {});
  const uncalibrated = artifact.calibration_maps?.uncalibrated || [];

  return {
    model_version: artifact.model_version,
    anchor_set_version: artifact.anchor_set_version,
    gate_passed: artifact.gate_passed,
    achieved_sensitivity: artifact.achieved_sensitivity,
    achieved_specificity: artifact.achieved_specificity,
    threshold: artifact.threshold,
    calibration_coverage: { fitted, degenerate, uncalibrated, skipped },
  };
}

/**
 * Best-effort live convergence numbers from the DB views. Isolated from the artifact-derived
 * metrics so a DB outage never breaks the primary (files-first) response.
 */
async function loadConvergence(sql) {
  if (!sql) return null;
  try {
    const [byModel, accuracy] = await Promise.all([
      sql`SELECT * FROM v_convergence_by_model`,
      sql`SELECT * FROM v_benchmark_accuracy`,
    ]);
    return { by_model: byModel, benchmark_accuracy: accuracy };
  } catch (error) {
    logger.warn(`equipoise-stats: convergence query failed: ${error.message}`);
    return null;
  }
}

function loadSources() {
  const manifest = loadManifest();
  if (!manifest) {
    throw new Error('equipoise-stats: anchor-set MANIFEST.json not found — anchor set has not been built');
  }
  const cases = loadCases();
  const artifact = loadArtifact(MODEL_VERSION, anchorSetVersion());
  if (!artifact) {
    throw new Error(
      `equipoise-stats: release artifact not found for (${MODEL_VERSION}, ${anchorSetVersion()})`
    );
  }
  const targetOperatingPoint = loadTargetOperatingPoint();
  const validationDoc = loadValidationSummary();
  return { manifest, cases, artifact, targetOperatingPoint, validationDoc };
}

function buildPublicPayload(sources, convergence) {
  const { manifest, cases, artifact, targetOperatingPoint, validationDoc } = sources;
  return {
    anchor_set: buildAnchorSummary(manifest, cases),
    detector: buildDetectorSummary(artifact, targetOperatingPoint),
    validity: buildValiditySummary(validationDoc),
    ...(convergence ? { convergence } : {}),
    disclaimer: DISCLAIMER,
    generated_at: new Date().toISOString(),
  };
}

export async function getEquipoiseStats({ sql } = {}) {
  const sources = loadSources();
  const convergence = await loadConvergence(sql);
  return equipoiseStatsSchema.parse(buildPublicPayload(sources, convergence));
}

export async function getEquipoiseAdminStats({ sql } = {}) {
  const sources = loadSources();
  const convergence = await loadConvergence(sql);
  const payload = buildPublicPayload(sources, convergence);
  return equipoiseAdminStatsSchema.parse({
    ...payload,
    operational: buildAdminOperational(sources.artifact),
  });
}
