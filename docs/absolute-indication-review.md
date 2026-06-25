# absolute_indication — MD review worksheet

Generated 2026-06-24 for review. Scan of all 122 benchmark DPs for the **red-flag /
absolute-indication** class: *operative answer is overwhelming; the only non-operative path is a
bailout* (e.g. patient can't survive surgery, rare atypical variant). A "contested" detector verdict
on these is **product-safe** — it routes to urgent surgical consultation (Phase 2b `route_to_human`) —
so they are **segmented** in `v_benchmark_accuracy`, not scored as equipoise.

Mark each candidate **Y** (tag absolute_indication) or **N**, then we apply confirmed Ys to
`db/seeds/absolute-indications.json` and re-seed.

---

## Already tagged (11) — confirmed last session, for reference

septic-native-joint · cauda-equina-syndrome · acute-compartment-syndrome ·
displaced-femoral-neck-young-adult · pelvic-ring-injury-vertical-shear · acute-sternoclavicular-posterior-dislocation ·
open-calcaneus-fracture · atlantoaxial-subluxation-with-myelopathy · pediatric-open-femur-fracture ·
distal-radius-with-acute-median-nerve-compression · traumatic-arthrotomy-knee

---

## A definitional question that sets the scope (please resolve first)

The 11 tagged cases are all **operative-vs-bailout** (non-op IS on the menu but is a bailout). The scan
turned up a second shape: **surgery is mandatory and BOTH options are operative** (the decision is
*timing* or *technique* of unavoidable surgery). Should `absolute_indication` also cover those?

- **Strict** (current 11): only "operative-vs-bailout-nonop" cases. → the candidates below are mostly **N**.
- **Broad**: also "surgery-mandatory, decision is timing/technique" cases. → flips some to **Y**.

This matters because in the product, a *both-options-operative* DP already implies surgery — the
red-flag value is "don't let the panel manufacture a non-op path." My recommendation: **strict** (keep
the tag meaning "non-op would be unsafe here"), and handle timing/technique-of-mandatory-surgery via a
separate future flag if needed. Your call.

---

## Candidates from the untagged scan

| # | slug | current label | why flagged | my rec |
|---|---|---|---|---|
| 1 | `open-fracture-debridement-timing` | genuine | **Open fracture → debridement is mandatory.** But both options are operative (sub-6h vs urgent); equipoise is on the (debunked) 6-hour rule. Red-flag *only* under the broad definition. | Y if broad, N if strict — **your call** |

That is the **only** untagged DP whose surgery is non-negotiable. Everything else in the genuine set is
true operative-vs-conservative equipoise.

---

## Considered and EXCLUDED (near-misses I checked, with why-not)

So you can see the reasoning rather than trust a silent filter:

| slug | why NOT absolute |
|---|---|
| `radial-nerve-palsy-humeral-fracture-exploration-vs-observation` | Closed humeral shaft + radial palsy → **observation is standard** (~70% spontaneous recovery). Genuine equipoise, not a mandate. |
| `thoracolumbar-burst-fracture-no-neuro-op-vs-nonop` | DP explicitly specifies **no neuro deficit** → brace-vs-surgery genuinely debated. (A burst *with* deficit would be a red-flag.) |
| `lumbar-disc-herniation-radiculopathy` | Explicitly **no progressive deficit** → conservative-vs-microdiscectomy genuine. (Progressive deficit / cauda is the red-flag, already tagged.) |
| `pediatric-supracondylar-gartland2` | Gartland **II uncomplicated** → cast-vs-pin equipoise. (Gartland III / pulseless hand would be emergent — not this DP.) |
| `developmental-dysplasia-hip-closed-vs-open-reduction` | Reduction is needed, but it's a **technique choice** (closed vs open), not an emergent mandate. |
| `calcaneus-fracture-displaced-op-vs-nonop` | **Closed** displaced calcaneus → op-vs-nonop genuinely debated. (Open calcaneus already tagged.) |
| 3 untagged settled_operative (`hip-fracture-surgery-timing-fit`, `orthopedic-major-surgery-txa`, `progressive-idiopathic-scoliosis-cobb-55`) | Already reviewed last session: timing optimization / adjunct intervention / accepted-FP respectively — not absolute. |

---

## Bottom line

The 11 existing tags capture the emergent red-flag class. The only open item is the **definition**
(strict vs broad) and the single case it hinges on (`open-fracture-debridement-timing`). The genuine
set is, correctly, genuine equipoise.

**Note (separate from tagging):** several DPs hard-specify the *non*-red-flag variant in their text
(e.g. "no neuro deficit", "Gartland II", "uncomplicated") — good curation hygiene. A future expansion
could add the matched red-flag variants (burst *with* deficit, Gartland III pulseless, etc.) as new
DPs, which would naturally be absolute_indication.
