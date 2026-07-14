/**
 * Deterministic CSV-row → anchor-case mapping (pure, testable — no I/O, no LLM).
 *
 * This is the mechanical half of the migration. The build spec fixes the mapping:
 *   - settled_conservative | settled_operative        -> settled          (stratum n_a)
 *   - genuine_equipoise × {conservative_vs_operative,
 *                          timing_of_surgery}          -> patient_dependent (stratum needs judgment)
 *   - genuine_equipoise × {which_operation,
 *                          which_intervention}          -> evidence_split | equivalent_options
 *                                                          (needs judgment — LLM proposes, MD ratifies)
 *
 * The which-option label and the controversy_stratum are genuine judgment calls. The real proposer is
 * the Haiku pass in relabel-llm.mjs; the HEURISTIC functions here are a FREE, offline fallback so the
 * deterministic path is independently runnable and every emitted case is schema-valid (all four label
 * classes represented). Heuristic proposals are stamped proposed_by:'deterministic' and flagged in the
 * review note so the MD knows they are the weakest-confidence proposals.
 */

/** which-option genuine cases whose two options are, on current evidence, genuinely EQUIVALENT
 * (P(superiority) ≈ 0.5 — a forced pick looks confident yet neither dominates). Curated seed for the
 * offline fallback; the LLM pass refines this. These are the blind-spot cases the confidence
 * threshold cannot separate from `settled`. */
export const KNOWN_EQUIVALENT_OPTIONS = new Set([
  'medial-compartment-knee-oa-pkr-vs-tka',
  'carpal-tunnel-endoscopic-vs-open-release',
  'total-knee-arthroplasty-cr-vs-ps',
  'tka-cemented-vs-cementless-fixation',
  'rotator-cuff-tear-single-vs-double-row-repair',
  'acdf-allograft-vs-autograft',
  'hip-arthroplasty-dual-mobility-vs-standard-cup',
  'femoral-shaft-fracture-retrograde-vs-antegrade-nail',
]);

/** Contested cases that are FAMOUS / editorialized debates (named trials, eponymous techniques, or
 * well-known public controversy). The stratum gap between these and quietly-contested cases estimates
 * the topic-recognition share of detector performance, so this split must exist in the set. Curated
 * seed for the fallback; the LLM pass refines. */
export const EDITORIALIZED = new Set([
  'clavicle-midshaft-displaced-op-vs-nonop',
  'ac-joint-type-iii-op-vs-nonop',
  'achilles-rupture-op-vs-nonop',
  'acl-rupture-early-surgery-vs-rehab',
  'acl-graft-choice',
  'shoulder-instability-bankart-vs-latarjet',
  'proximal-humerus-orif-vs-reverse-shoulder-arthroplasty',
  'degenerative-spondylolisthesis-decompression-vs-fusion',
  'lumbar-disc-herniation-surgery-vs-conservative',
  'subacromial-pain-syndrome-physical-therapy-vs-corticosteroid-injection',
  'femoral-neck-fracture-older-tha-vs-hemi',
  'meniscus-tear-degenerative-pt-vs-arthroscopic',
]);

export const OPTION_DECISION_TYPES = ['which_operation', 'which_intervention'];
export const PATIENT_DEPENDENT_DECISION_TYPES = ['conservative_vs_operative', 'timing_of_surgery'];

/**
 * The mechanical label mapping. Returns { label, needsJudgment } — needsJudgment=true for the
 * which-option cases whose split between evidence_split/equivalent_options requires a proposal.
 * @param {{decision_type:string, expected_equipoise:string}} row
 */
export function deterministicLabel(row) {
  const { decision_type, expected_equipoise } = row;
  if (expected_equipoise === 'settled_conservative' || expected_equipoise === 'settled_operative') {
    return { label: 'settled', needsJudgment: false };
  }
  if (expected_equipoise === 'genuine_equipoise') {
    if (PATIENT_DEPENDENT_DECISION_TYPES.includes(decision_type)) {
      return { label: 'patient_dependent', needsJudgment: false };
    }
    if (OPTION_DECISION_TYPES.includes(decision_type)) {
      return { label: null, needsJudgment: true }; // evidence_split | equivalent_options
    }
  }
  // 'evolving' sentinel or anything unexpected: flag for manual review (should not occur in active set).
  return { label: null, needsJudgment: true };
}

/** Offline heuristic for the which-option label (fallback when no LLM proposal is available). */
export function heuristicOptionClass(row) {
  return KNOWN_EQUIVALENT_OPTIONS.has(row.slug) ? 'equivalent_options' : 'evidence_split';
}

/** Offline heuristic for controversy_stratum on a contested case (fallback). */
export function heuristicStratum(row) {
  return EDITORIALIZED.has(row.slug) ? 'editorialized' : 'quietly_contested';
}

/**
 * Clinical vignette v1: a deterministic template (no LLM synthesis) — the canonical question plus the
 * numbered options plus the neutral typical-adult frame the population-mode position prompt already
 * uses. Reproducible and cheap; the schema field exists so a richer vignette can replace it later
 * without migration.
 * @param {{canonical_question:string, option_a_label:string, option_b_label:string}} row
 */
export function buildVignette(row) {
  return (
    `Typical adult patient for whom this decision arises (no atypical comorbidities or contraindications).\n\n` +
    `Decision: ${row.canonical_question}\n` +
    `Options:\n  1. ${row.option_a_label}\n  2. ${row.option_b_label}`
  );
}

/**
 * Assemble a full anchor case from a CSV row + overlays + a judgment source. Pure; the caller supplies
 * `judgment` (from LLM or heuristic) and `reviewer`.
 * @param {object} row - parsed CSV row (is_operative already boolean)
 * @param {{absolute:boolean, pediatric:boolean}} overlays
 * @param {{label:string|null, stratum:string|null, proposedBy:string, rationale?:string, sourceCitations?:Array}} judgment
 * @param {{reviewer:string, schemaVersion:string}} opts
 */
export function rowToCase(row, overlays, judgment, opts) {
  const det = deterministicLabel(row);
  const label = det.label || judgment.label;
  const isContested = label !== 'settled';
  const controversy_stratum = isContested ? judgment.stratum : 'n_a';

  // proposed_by reflects the WEAKEST-confidence input that determined a judgment field: if the label
  // was mechanical AND stratum came from a heuristic, the case is only as trustworthy as that stratum.
  const proposedBy = det.needsJudgment || isContested ? judgment.proposedBy : 'deterministic';

  return {
    id: row.slug,
    schema_version: opts.schemaVersion,
    decision_point: row.canonical_question,
    options: [row.option_a_label, row.option_b_label],
    clinical_vignette: buildVignette(row),
    label,
    label_rationale: row.equipoise_rationale || '',
    controversy_stratum,
    source_citations: judgment.sourceCitations || [],
    provenance: {
      legacy_slug: row.slug,
      legacy_expected_equipoise: row.expected_equipoise,
      legacy_decision_type: row.decision_type,
      legacy_label_provenance: row.label_provenance || null,
      legacy_body_region: row.body_region,
      legacy_is_operative: Boolean(row.is_operative),
      absolute_indication: Boolean(overlays.absolute),
      is_pediatric: Boolean(overlays.pediatric),
    },
    reviews: [
      {
        reviewer: opts.reviewer,
        review_date: null,
        review_status: 'provisional',
        proposed_by: proposedBy,
        notes:
          (det.needsJudgment ? 'which-option label ' : '') +
          (isContested ? `stratum via ${judgment.proposedBy}` : 'mechanical mapping') +
          (judgment.rationale ? ` — ${judgment.rationale}` : ''),
      },
    ],
  };
}
