# The Equipoise Instrument

**Status (2026-07-11): foundational milestone complete.** A files-first anchor set, a unified
behavioral detector, a re-calibratable release gate, and three validation experiments together form a
*validated* equipoise instrument — one that distinguishes genuine clinical equipoise (a decision where
reasonable experts disagree on the evidence) from settled standard-of-care, and does so by **appraising
evidence, not recognizing famous controversies.** This document is the durable summary of what was built
and what the validation shows.

The one honest asterisk: per-agent confidence *calibration* (recalibration Level 3) is wired and
gate-passing but its content is currently degenerate — see [Known limitations](#known-limitations). That
is deferred polish, not a blocker for the validity claim.

---

## 1. The durable asset — anchor set `0.2.0-ratified`

The moat is not a magic number; it is a **labeled corpus** plus a procedure to re-derive every number
from it. `anchor-set/cases/<id>.json`, one file per decision point (188 cases, 178 active after excluding
10 pediatric), MD-ratified.

- **4-class taxonomy** (`label`): `patient_dependent` 44 · `evidence_split` 18 · `equivalent_options` 11
  · `settled` 115.
- **`controversy_stratum`**: `editorialized` 33 (loud, named debates) · `quietly_contested` 40 (genuinely
  uncertain but not famous) · `n_a` 115 (settled). This split is what lets us test recognition vs
  appraisal.
- `reviews[]` is an append-only list (external reviewers add without migration); every case carries a
  `human`-proposed ratified label. Spine in `MANIFEST.json`; schema in `anchor-set/schema/`.
- Target operating point lives in **`anchor-set/config/target_operating_point.json`** (0.85 sensitivity /
  0.80 min specificity) — read only by recalibration, never hard-coded in detector logic.

**Invariant:** the anchor set is the source of truth; every threshold is a *derived* recalibration
output, never a declared constant.

## 2. The detector — behavioral features, no verdict

`detector/` computes four features per case over a grid of `demand/risk archetypes × 4 specialist lenses
× replicates × option-order{AB,BA}`. It emits features only — it never declares a threshold or a verdict
(that is recalibration's job).

| Feature | Signals | Class it catches |
|---|---|---|
| `between_archetype_modal_variance` | modal answer flips as the patient archetype changes | patient_dependent |
| `within_archetype_stance_entropy` | panel disagreement within one archetype (Shannon) | evidence_split |
| `choice_lability_rate` | instability under option-order swap + replicate redraw | equivalent_options |
| `confidence` | self-reported confidence (covariate, deliberately non-load-bearing) | — |

Entropy is only meaningful if panel members can disagree for *independent* reasons. The validated panel
composition is **`same_family_multi_version`** — one distinct Claude model per lens (painWhisperer =
opus-4-8, movementDetective = sonnet-4-6, strengthSage = haiku-4-5, mindMender = opus-4-6). This
decorrelation woke entropy (median 0.000 on a single-model pseudo-replicated panel → load-bearing here).

## 3. Recalibration — the part that survives upgrades

`recalibration/` re-derives the operating point from the anchor set and ships a **release gate**. On a
new model version you re-run the detector and re-fit; if no cutoff hits the target, the gate fails loudly
(that *is* the upgrade-broke-the-detector signal).

- **Level 1 — threshold (the gate).** Fire if `modal_variance ≥ t_v OR entropy ≥ t_e`; sweep `(t_v, t_e)`,
  pick max-specificity point meeting the target. Derived point: **`mv ≥ 0.2222 OR ent ≥ 0.3546`**.
- **Level 2 — percentile/z-score reference.** Expresses each feature as its rank against the anchor
  distribution for this model version, so ordering survives a uniform confidence shift an absolute cutoff
  would not. Persisted as `percentile_reference`.
- **Level 3 — per-agent Platt/isotonic calibration.** Maps raw confidence → empirical accuracy per
  specialist, fed by a masked-evidence outcome signal. Machinery complete; content degenerate on current
  data (§Known limitations).

**Release artifact:** `recalibration/store/same_family_multi_version__0.2.0-ratified.json` carries the
threshold, `percentile_reference`, `calibration_maps`, the gate result, and per-class Wilson CIs.

**Gate result (full 178-active run):**

| Segment | Sensitivity / Specificity (Wilson 95%) | n |
|---|---|---|
| patient_dependent | 84.6% [70.3–92.8] | 39 |
| evidence_split | 88.9% [67.2–96.9] | 18 |
| **overall sensitivity** | **0.860** | 57 |
| settled controls (specificity) | 90.7% [82.7–95.2] | 86 |

Entropy adds real lift: on evidence_split, recall is 88.9% (two-signal) vs 61.1% (modal-variance only),
and a modal-only gate *cannot* reach the target — the two-signal fusion is necessary.

## 4. Validation — is it measuring equipoise, or notoriety?

Three experiments in `validation/`, all panel-matched, triangulate the core threat (labels are
literature-derived, so a detector that just recognizes famous debates would be circular).

### 4.1 Stratum gap (`validation/run.js stratum-gap`, $0 — reuses detector artifacts)
Detector sensitivity split by `controversy_stratum`:

| Stratum | Sensitivity (Wilson 95%) | n |
|---|---|---|
| editorialized | 93.5% [79.3–98.2] | 31 |
| quietly_contested | 76.9% [57.9–89.0] | 26 |
| **gap** | **+16.6 pts** | |

Read alone this is ambiguous — a positive gap is predicted *both* by "the model recognizes fame" and by
"editorialized cases are genuinely more balanced." Cue-injection breaks the tie.

### 4.2 Cue-injection — the negative control (batch `msgbatch_01YLjWkbkyw9FeAyD9EhKyhH`)
Same case, neutral phrasing vs. a "this is a recognized controversy" cue carrying no clinical
information. If the sensitivity gap were recognition-driven, the cue should inflate confidence *more* on
famous cases.

| | cue-delta (cued − neutral) | 95% CI |
|---|---|---|
| editorialized | −0.039 | ±0.008 |
| quietly_contested | −0.040 | ±0.011 |
| **gap of deltas** | **+0.0008** | **[−0.013, +0.014]** |

The cue *lowers* confidence slightly (appraisal humility, not inflation), **identically across strata**,
and **0 of 57 cases** show inflation > +0.05. → The +16.6 gap is **not** fame-recognition; editorialized
cases score higher because they are genuinely more contested. Per-agent: opus-4-8 is cue-invariant
(Δ = 0.0000); smaller/older models deflate more; none inflate.

### 4.3 Masked-evidence — the positive control (batch `msgbatch_01BzSfDQaEeSDQQvA67ThdxM`)
Topic identity stripped to neutral "Option A / Option B"; only fabricated evidence of known direction and
GRADE to reason from.

- Confidence tracks GRADE certainty monotonically: **0.41 (low) → 0.64 (moderate) → 0.70 (high)**.
- Strong evidence (A/high, B/high — symmetric): 75% follow, 25% defer, ~0% oppose.
- Weak evidence (1 small trial): appropriately unconfident (0.41) and non-committal (50% defer).
- No-difference evidence: **100% defer** — textbook equipoise driven purely by supplied evidence.

→ The panel **appraises** supplied evidence, including appropriate skepticism of weak evidence and
appropriate deferral when told there is no difference.

**Conclusion:** validity is established. The instrument measures equipoise by appraising evidence, and
its sensitivity on quiet (non-famous) cases is genuine, not a recognition artifact.

## 5. Reproduce

```bash
# Detector features (already on disk as artifacts/detector/*.json for the ratified run):
node detector/index.js --submit --all --store --composition same_family_multi_version

# Recalibration + release gate (Level 1/2; add --outcomes for Level 3):
node recalibration/index.js --model same_family_multi_version \
  --outcomes artifacts/validation/masked-evidence-<batch>.json

# Validation:
node validation/run.js stratum-gap                                        # $0, reuses detector artifacts
node validation/run.js cue-injection   --select should-contest --composition same_family_multi_version --submit
node validation/run.js masked-evidence --select should-contest --composition same_family_multi_version --submit
```

## 6. Known limitations & future work

- **Level 3 calibration is degenerate.** When the panel commits on masked evidence it follows the
  evidence ~100% of the time (zero wrong commitments), so Platt/isotonic collapse to P ≈ 1.0 —
  non-discriminative. opus-4-8 defers on 100% of masked prompts → recorded as `uncalibrated`. The
  artifact flags `degenerate` / `uncalibrated` so no one trusts a flat curve. Masked-evidence is a strong
  *appraisal* probe but a poor *calibration-fit* set. A meaningful curve needs an outcome set with errors
  spread across the confidence range (near-threshold masked evidence with conflicting trials / borderline
  GRADE, or expert-adjudicated real-case labels). **Deferred polish.**
- **Deferred validation slots:** `temporalHoldout` (needs a curated post-training-cutoff equipoise-flip
  set) and `mechanismProbe` (needs the grounding evidence cache to audit enumerated citations) remain
  stubs in `validation/slots.js`.
- **/grounding/** (research-agent real evidence tables consulted before a stance) is built with a
  dry-run path; the cached real fetch and its downstream use (mechanismProbe) are not yet run.
- **Cross-provider decorrelation** (Gemini/DeepSeek/Groq) was deferred — same-family multi-version was
  sufficient to wake entropy, so it was not needed.
- **equivalent_options** is deliberately excluded from the sensitivity target (a forced pick looks
  confident); its `choice_lability` coverage is reported separately, not gated.
