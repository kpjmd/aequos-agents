import { z } from 'zod';

const anchorSetSchema = z.object({
  version: z.string(),
  total: z.number().int(),
  active: z.number().int(),
  by_class: z.record(z.string(), z.number().int()),
  by_stratum: z.record(z.string(), z.number().int()),
}).strict();

const perClassSchema = z.object({
  label: z.string(),
  p: z.number(),
  lo: z.number(),
  hi: z.number(),
  n: z.number().int(),
}).strict();

const entropyLiftSummarySchema = z.object({
  recall_full: z.number(),
  recall_modal_only: z.number(),
  entropy_adds_lift: z.boolean(),
  modal_only_reaches_target: z.boolean().nullable(),
}).strict().nullable();

// .strict() is the honesty-guard enforcement point: an accidental leak of calibration_maps content
// (platt/isotonic curve values, the raw stratum gap, etc.) onto this object fails validation instead
// of silently shipping to the frontend.
const detectorSchema = z.object({
  gate_passed: z.boolean(),
  sensitivity: z.number(),
  specificity: z.number(),
  target: z.object({
    sensitivity: z.number(),
    specificity: z.number(),
  }).strict(),
  per_class: z.array(perClassSchema),
  entropy_lift_summary: entropyLiftSummarySchema,
  calibration_status: z.string(),
}).strict();

const cueInjectionSchema = z.object({
  overall_confidence_delta: z.number(),
  gap_of_deltas: z.number(),
  gap_of_deltas_ci: z.tuple([z.number(), z.number()]),
  cases_showing_inflation: z.string(),
  conclusion: z.string(),
  batch_id: z.string(),
}).strict();

const maskedEvidenceSchema = z.object({
  confidence_by_grade: z.record(z.string(), z.number()),
  no_difference_deferral: z.string(),
  strong_evidence_follow: z.string(),
  conclusion: z.string(),
  batch_id: z.string(),
}).strict();

const validitySchema = z.object({
  recognition_contamination: z.string(),
  appraisal: z.string(),
  cue_injection: cueInjectionSchema,
  masked_evidence: maskedEvidenceSchema,
}).strict();

export const equipoiseStatsSchema = z.object({
  anchor_set: anchorSetSchema,
  detector: detectorSchema,
  validity: validitySchema,
  convergence: z.object({
    by_model: z.array(z.record(z.string(), z.any())),
    benchmark_accuracy: z.array(z.record(z.string(), z.any())),
  }).optional(),
  disclaimer: z.string(),
  generated_at: z.string(),
});

const calibrationCoverageSchema = z.object({
  fitted: z.array(z.string()),
  degenerate: z.array(z.string()),
  uncalibrated: z.array(z.string()),
  skipped: z.array(z.string()),
}).strict();

const operationalSchema = z.object({
  model_version: z.string(),
  anchor_set_version: z.string(),
  gate_passed: z.boolean(),
  achieved_sensitivity: z.number(),
  achieved_specificity: z.number(),
  threshold: z.record(z.string(), z.number()),
  calibration_coverage: calibrationCoverageSchema,
}).strict();

export const equipoiseAdminStatsSchema = equipoiseStatsSchema.extend({
  operational: operationalSchema,
});
