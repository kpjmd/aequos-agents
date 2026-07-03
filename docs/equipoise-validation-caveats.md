# AequOs Equipoise Instrument — Validation Status & Caveats

**Purpose.** An honest, shareable statement of what the AequOs equipoise-detection instrument does,
what its numbers mean, and what still stands between "high internal agreement" and an independently
*validated* claim. Written for collaborators and for scoping the next validation phase. This is a living
document — the benchmark and method are expected to keep evolving.

**Last updated:** 2026-07-03.

---

## 1. What the instrument is

AequOs detects **clinical equipoise** — decisions where a well-informed surgeon could reasonably choose
either option because the right answer is genuinely patient-dependent — versus **settled** decisions
where current evidence favors one option for the typical patient. It does this with an *archetype-flip*
method: it runs a 4-lens specialist panel across several patient archetypes that vary the clinical axes
known to drive orthopedic decisions (functional demand × surgical risk; pathology extent × bone quality;
fracture pattern; injury biology), and calls a decision **contested** if the panel's modal answer flips
across archetypes. As of 2026-07-03 this validated method runs in production (background sweep), not just
in the offline benchmark.

## 2. The headline numbers — with honest error bars

Against a 122-case internally-authored benchmark, N=3, per-slug majority (post-adjudication labels):

| segment | point estimate | 95% CI (Wilson) | n |
|---|---|---|---|
| sensitivity (detects genuine equipoise) | 0.978 | **[0.92, 0.99]** | 88/90 |
| specificity (leaves settled cases alone) | 0.952 | **[0.77, 0.99]** | 20/21 |
| absolute-indication routing (red flags → surgery) | 1.000 | **[0.74, 1.00]** | 11/11 |

Read these with the intervals, not the point estimates. Sensitivity (n=90) is reasonably pinned.
**Specificity and absolute-indication rest on ~11–21 cases each, so their intervals are very wide** — a
"1.000" on 11 red-flag cases is statistically indistinguishable from anything down to ~0.74.

## 3. Caveats (what a skeptic will — correctly — raise)

**C1 — The benchmark co-evolved with the model (label circularity).** Across two adjudication rounds,
11 of the 122 labels were changed, and **every one moved toward the detector's output, none against**:
7 false positives were relabeled `settled → genuine_equipoise` (turning misses into hits, lifting both
sensitivity and specificity), and 4 false negatives were relabeled `genuine → settled_conservative`. The
cleanest evidence is the project's own same-runs re-score: per-run sensitivity went 259/282 → 259/270 —
**not one panel run became correct; 12 wrong runs were removed from the denominator by relabeling.**
Round 1 similarly lifted control specificity 0.743 → 0.941. All 11 were adjudicated by a single rater
(the developing surgeon), with no blinded second rater and no inter-rater reliability reported.

**C2 — Sensitivity is structurally inflated as clinical axes accumulate.** The method is "contested if
ANY axis flips" (a pure OR). This is monotone: each axis added can only turn `converged` into
`contested`, so sensitivity can only rise and specificity can only fall as axes grow. Axes were added one
at a time, each to rescue a specific previously-missed case, and each catches *only* the case it was
introduced for (demand → acl-graft-choice; pathology → pkr-vs-tka; fracture-pattern → nail-vs-plate;
biology → open-fracture/radial-nerve). The axes are each clinically real, which makes this hard to see —
but a general construct would catch many cases per axis, not exactly one. There is no principled stopping
rule; new axes are discovered by benchmark misses.

**C3 — External validity is untested.** All 122 cases are internally authored, and the label mix skews
operative (the settled-conservative segment was the smallest). Precision on a self-authored benchmark
does not establish that the instrument generalizes to cases and decision types it has never seen.

**C4 — Small-n / thin reproducibility.** N=3 majority vote; 7/122 slugs flip 2-1. The wide CIs in §2 are
the honest consequence. A larger N would tighten nothing that matters here — the binding constraint is
per-segment case count, not runs.

## 4. What is genuinely solid (for balance)

- The **production path now runs the validated method** (fixed 2026-07; previously production used a
  single-population panel with ~0% equipoise sensitivity).
- The panel's conservatism is **evidence-corrigible, not a fixed prior**: a controlled probe showed
  strong contrary evidence moves 100% of specialists, while a matched sham (authority, no data) moves 0%.
- Each clinical axis is defensible on its face — a surgeon would endorse demand×risk, pathology,
  fracture pattern, and injury biology as the real drivers of these decisions.

## 5. What "validated" actually requires (both are people/process, not code)

1. **Independent, blinded raters.** At least one clinician who is not the developer re-classifies the
   benchmark — starting with the 11 adjudicated cases (see the blinded re-rate packet) — with
   inter-rater reliability (Cohen's/Fleiss' κ) reported. This is the direct remedy for C1.
2. **An independent held-out benchmark.** New cases — especially decision types not yet represented —
   authored by someone else, scored **once with the axes frozen and zero tuning**. If the axes are
   general, they catch new equipoise cases without new axes; if they're fitted, the held-out set exposes
   fresh gaps. This is the direct remedy for C2/C3.

## 6. "How many cases do we need?" — the statistical answer

There is no single total. Precision is governed by the **per-segment** count of the claim you want to
make, not the grand total. For a proportion near p with a 95% margin m, n ≈ 1.96²·p(1−p)/m²:

| target claim | cases **per segment** for ±0.10 | for ±0.05 | for ±0.03 |
|---|---|---|---|
| specificity ≈ 0.95 | ~19 | ~73 | ~203 |
| sensitivity ≈ 0.90 | ~35 | ~139 | ~385 |

So the current weak links are explicit: the settled-non-absolute segment (n≈21, ±0.10) and the
absolute-indication segment (n≈11, ±0.13). To claim "specificity 0.95 ± 0.05" you'd need ~75 settled
controls; today there are 21. Sensitivity (n=90) is already near ±0.05.

**But for a novel instrument, statistical power is the *second* constraint.** The first is **independence
and coverage**: a smaller benchmark authored and labeled by an outside clinician, balanced across
decision types, body regions, and both settled directions, is worth more than a larger self-authored one.
Grow the settled-conservative and red-flag segments (they're both under-powered *and* the least
independent), fix the operative skew, and split off a held-out portion — in that order — before chasing a
large total.

## Appendix — the 11 adjudicated cases (the C1 ledger)

| slug | round | relabel |
|---|---|---|
| periprosthetic-femur-fracture-vancouver-b1-orif-vs-revision | 1 | settled_operative → genuine_equipoise |
| knee-dislocation-multi-ligamentous-injury-brace-vs-reconstruction | 1 | settled_operative → genuine_equipoise |
| quadriceps-tendon-rupture-active | 1 | settled_operative → genuine_equipoise |
| high-energy-talus-fracture-displaced-cast-vs-orif | 1 | settled_operative → genuine_equipoise |
| acute-femoral-neck-fracture-garden-i-nonoperative-vs-screws | 1 | settled_operative → genuine_equipoise |
| chronic-osteomyelitis-antibiotics-alone-vs-debridement-and-antibiotics | 1 | settled_operative → genuine_equipoise |
| uncomplicated-morton-neuroma-orthotics-vs-neurectomy | 1 | settled_conservative → genuine_equipoise |
| ankle-fracture-stable-weberb-op-vs-nonop | 2 | genuine_equipoise → settled_conservative |
| elbow-epicondylitis-lateral-surgery-vs-conservative | 2 | genuine_equipoise → settled_conservative |
| frozen-shoulder-physio-vs-surgical-release | 2 | genuine_equipoise → settled_conservative |
| cervical-radiculopathy-acdf-vs-pt | 2 | genuine_equipoise → settled_conservative |

All 11: provenance `md_adjudication`, single rater. Reproduce the re-score with
`scripts/equipoise-audit.js` once benchmark_probe runs are available.
