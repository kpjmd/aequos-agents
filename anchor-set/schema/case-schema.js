/**
 * Anchor-set case schema (the durable, model-independent labeled benchmark).
 *
 * ONE JSON file per case lives under anchor-set/cases/<id>.json. This zod schema is the single
 * source of truth for what a valid case looks like; anchor-set/scripts/validate.mjs and the jest
 * suite both import it so they check the same shape. Consistent with src/utils/dialogue-schemas.js
 * (zod, no new deps).
 *
 * Design (per the build spec — owner decisions, do not re-open):
 *   - FOUR label classes, not the legacy 3: patient_dependent | evidence_split | equivalent_options
 *     | settled. `equivalent_options` is the blind spot (partial-vs-total knee etc.) that looks
 *     identical to `settled` under a confidence threshold — it is separated by behavioral signals,
 *     never carried in the label heuristic.
 *   - controversy_stratum is LOAD-BEARING for validation: it splits contested cases into
 *     `editorialized` (famous/named debates — the pattern-matching-contaminated set) vs
 *     `quietly_contested` (guideline discordance, no famous debate). The stratum gap estimates how
 *     much detector performance is topic-recognition vs genuine appraisal. Never `n_a` on a
 *     contested case; always `n_a` on a settled case.
 *   - reviews is a LIST (not a scalar reviewer/date), so external-reviewer sign-off and inter-rater
 *     agreement can be added later without a schema migration. Everything is `provisional` for now.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0';

export const LABELS = ['patient_dependent', 'evidence_split', 'equivalent_options', 'settled'];
export const STRATA = ['editorialized', 'quietly_contested', 'n_a'];
export const REVIEW_STATUSES = ['provisional', 'ratified', 'corrected', 'rejected'];
export const PROPOSED_BY = ['deterministic', 'llm_haiku', 'human'];

/** A contested (non-settled) label — must carry a real controversy_stratum. */
export const CONTESTED_LABELS = ['patient_dependent', 'evidence_split', 'equivalent_options'];

export const SourceCitationSchema = z.object({
  pmid: z.string().nullable().optional(),
  title: z.string(),
  year: z.number().int().nullable().optional(),
});

export const ReviewSchema = z.object({
  reviewer: z.string(),
  review_date: z.string().nullable(),
  review_status: z.enum(REVIEW_STATUSES),
  proposed_by: z.enum(PROPOSED_BY),
  notes: z.string().default(''),
});

export const ProvenanceSchema = z.object({
  legacy_slug: z.string(),
  legacy_expected_equipoise: z.string(),
  legacy_decision_type: z.string(),
  legacy_label_provenance: z.string().nullable(),
  legacy_body_region: z.string(),
  legacy_is_operative: z.boolean(),
  absolute_indication: z.boolean(),
  is_pediatric: z.boolean(),
});

export const CaseSchema = z
  .object({
    id: z.string().min(1),
    schema_version: z.string(),
    decision_point: z.string().min(1),
    options: z.array(z.string()).length(2),
    clinical_vignette: z.string().min(1),
    label: z.enum(LABELS),
    label_rationale: z.string().default(''),
    controversy_stratum: z.enum(STRATA),
    source_citations: z.array(SourceCitationSchema).default([]),
    provenance: ProvenanceSchema,
    reviews: z.array(ReviewSchema).min(1),
  })
  .superRefine((c, ctx) => {
    // Stratum completeness is the load-bearing invariant: contested => real stratum, settled => n_a.
    if (c.label === 'settled' && c.controversy_stratum !== 'n_a') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['controversy_stratum'],
        message: `settled case must have controversy_stratum "n_a", got "${c.controversy_stratum}"`,
      });
    }
    if (CONTESTED_LABELS.includes(c.label) && c.controversy_stratum === 'n_a') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['controversy_stratum'],
        message: `contested case (label=${c.label}) must have a real controversy_stratum, not "n_a"`,
      });
    }
  });

/**
 * Validate one case object. Returns { ok, errors } rather than throwing so the validator can
 * accumulate failures across all files and report them together.
 * @param {unknown} obj
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateCase(obj) {
  const res = CaseSchema.safeParse(obj);
  if (res.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export default CaseSchema;
