# Divergence Spike — Findings (Step 0)

**Date:** 2026-06-07
**Harness:** `examples/divergence-spike.js` (throwaway)
**Artifacts:** `artifacts/divergence-spike-*.json`
**Question:** Does the existing 5-specialist panel meaningfully diverge today, and where?

## Method

Ran the real `coordinateMultiSpecialistConsultation` path (normal mode, real Anthropic
calls, no blockchain/DB/server) on 6 curated cases spanning clear-cut → clinical equipoise.
For each case an authored *central decision point* was defined; an LLM judge (Haiku, temp 0)
classified each specialist's natural response into one of the decision's stances, `defer`, or
`not_addressed`. Divergence = ≥2 distinct substantive stances at confidence ≥ 0.6. The judge is
a stand-in prototype for the Step 2 structural detector; agents were **not** asked "do you
disagree?" (per plan constraint #1).

## Results

| Case | Tier | Verdict | Stances |
|---|---|---|---|
| Acute ankle sprain | clear | converged | conservative (4); mind not_addressed |
| Acute mechanical LBP | clear | converged | stay-active conservative (5) |
| Partial rotator cuff tear (54yo tennis) | equipoise | converged | conservative rehab (5) |
| **ACL rupture (28yo soccer)** | **equipoise** | **DIVERGENT** | **Strength Sage → surgery (0.92); Movement Detective → rehab-first (0.72); Triage defer; Pain & Mind not_addressed** |
| Chronic LBP, opioid request | equipoise | converged | non-opioid multimodal (4); movement defer |
| Hamstring RTP in 10 days | equipoise | converged | cautious criteria-based (4); mind not_addressed |

**Divergence rate: 1/4 equipoise, 0/2 clear, 1/6 overall.**

## Conclusions

1. **Meaningful divergence IS achievable with the current role-differentiated agents** — so we do
   NOT need a separate "enable divergence" sub-task before building detection. The role prompts
   already produce divergent clinical *priors* on genuine equipoise. The ACL disagreement is real
   (verified against raw responses; quotes "evidence strongly favors surgical reconstruction" vs
   "20-30% can return to cutting sports without reconstruction") and mirrors a real clinical debate.

2. **It is rare and equipoise-specific**, exactly as predicted. Clear cases converge (good — the
   panel isn't manufacturing disagreement). This makes the **gate mandatory**: detect/surface
   dialogue only when real divergence exists, both for signal quality and cost.

3. **Divergence splits along specialist lens** (return-to-function → surgery; conservative
   biomechanics → rehab-first). This is the differentiator: lens-driven, well-grounded disagreement.

4. **Today this divergence is implicit and discarded.** Agents express positions in prose; a judge
   had to *infer* them, and several were `not_addressed`/`defer`. The existing conference detects
   none of it (it keys off hardcoded `agreementWithTriage: 'full'`). → **Step 1 is the right next
   move**: make agents emit explicit structured positions on shared decision points (with a `defer`
   option), converting implicit-and-thrown-away divergence into explicit-and-detectable.

5. **The "defer / stay-in-lane" behavior is the anti-hallucination guardrail working naturally**
   (constraint #3): Pain & Mind declined to opine on the surgical decision; Movement deferred on
   opioids; Triage routed the ACL decision to a surgeon. Step 1 should formalize and preserve this,
   not suppress it.

## Calibration for Steps 1–2

- Confidence floor of **0.6** cleanly separated substantive stances from noise; judge confidences
  clustered high (0.72–0.95). Carry 0.6 into the Step 2 detector as a starting threshold.
- `defer` and `not_addressed` must be first-class, non-divergent outcomes in the detector.

## Step 1 producer validation (2026-06-07, follow-on)

Built `TriageAgent.identifyDecisionPoints` + `OrthopedicSpecialist.statePosition` using real
structured output (LangChain `withStructuredOutput` + zod; `src/utils/dialogue-schemas.js`).
Smoke-tested on ACL (equipoise) and ankle (clear). Two findings:

1. **First attempt collapsed divergence to false consensus** — all specialists picked rehab-first
   on ACL (vs the spike's split). Two causes, both fixed:
   - *Hedged option framing.* Triage wrote one option as "rehab, surgery reserved for failure" —
     pre-loaded as the safe choice. Fix: triage prompt now requires NEUTRAL, SYMMETRIC option
     framing.
   - *Commit-before-reasoning.* The position schema had `stance` before `reasoning`, so structured
     output picked-then-justified. Fix: `reasoning` field now FIRST (think-then-commit).
2. **After fixes: divergence restored and gate works.** ACL → 2-vs-1 split (Mind Mender → early
   reconstruction on a fear-avoidance rationale; Movement + Strength → rehab-first), all
   lens-grounded. Ankle → 0 decision points (gate skips position pass).

**Carry into Step 2:** divergence is framing-sensitive and has run-to-run variance — the *dissenter
identity* is unstable, but the *existence of genuine contest* and the *per-side reasoning* are the
stable, valuable signal. Detection must surface "this decision is contested + reasoning on each
side," NOT "specialist X is the holdout." Capture reasoning (users + V2 training), not just votes.

## Step 2 diagnostic — divergence is stable; decision-point SELECTION was the noise (2026-06-07)

First Step-2 end-to-end run converged (0 divergences) on the ACL case despite Step-1 showing a
split — looked like stochastic divergence. A controlled variance test (fixed, neutrally-framed
surgery-timing decision point; 4 specialists × 3 trials) resolved it:

| Specialist | T1 | T2 | T3 |
|---|---|---|---|
| Pain | rehab | rehab | rehab |
| Movement | **surgery** | **surgery** | **surgery** |
| Strength | rehab | rehab | rehab |
| Mind | **surgery** | **surgery** | **surgery** |

**Positions are stable and genuinely lens-divergent — a reproducible 2-vs-2 split** (conf 0.72–0.82).
The noise was NOT in the positions; it was in **triage's ranking of which decision is "most
central,"** which varies run-to-run. Capping at `MAX_DECISION_POINTS = 1` gambled on a single
decision and sometimes evaluated one the panel agreed on, missing the real split elsewhere.

**Fix:** evaluate ALL of triage's contested decision points (cap 3), detect divergence on any.
**Implication:** genuine *stable vote-divergence* exists, so detection can be a real disagreement
detector (not just a softer "surface considerations" model). Neutral option framing +
think-then-commit + evaluating all contested points = reliable detection on contested cases.

## Step 3 — dialogue round is REAL (2026-06-07)

On the ACL case, after each specialist saw the OPPOSING positions+reasoning, 3 of 4 revised, each
citing the specific argument that moved them (Pain & Mind: rehab→surgery on the active giving-way /
secondary-damage argument; Movement: surgery→rehab on KANON/Delaware-Oslo "rehab IS the diagnostic
test"). Strength HELD rehab-first with a substantive rebuttal. **The split PERSISTED** (sides
rebalanced rather than collapsing to consensus) — the strongest signal of genuine equipoise and the
settleable artifact for V2. Position deltas captured per specialist (the "what changed in the
conference" artifact the old code never produced).

**Watch (not a blocker):** 3/4 change rate is high — possible mild suggestibility. Reassurance: they
*redistributed* rather than all caving to one voice (sycophancy would collapse onto the speaker); the
split held. Consider a tuning probe (e.g. balance the reconsider prompt, or sample) later.

## Reconsideration probe — revision is GENUINE deliberation, not suggestibility (2026-06-08)

The Step-3 "watch" above is RESOLVED. Ran a sham-rebuttal control (`examples/reconsider-probe.js`,
throwaway; artifact `artifacts/reconsider-probe-2026-06-08T02-41-42-254Z.json`): reuse
`reconsiderPosition` unchanged and manipulate ONLY the strength of the opposing argument, holding the
specialist's frozen initial position, the stance being pushed, and the number of dissenters fixed.
Two conditions, 4 specialists × N=5 (40 reconsider calls, normal/Sonnet, production temp):

- **C0 genuine-strong** — real evidence-grounded opposing reasoning.
- **C1 vacuous-sham** — same stance/length/dissenter-count, ZERO clinical substance (restated
  preference / appeal to authority / vague "evidence supports this").

| Specialist | own stance | C0 genuine | C1 sham | Δ |
|---|---|---|---|---|
| Pain Whisperer | rehab-first | 0.40 | 0.00 | +0.40 |
| Movement Detective | surgery | 0.20 | 0.00 | +0.20 |
| Strength Sage | rehab-first | 0.40 | 0.00 | +0.40 |
| Mind Mender | surgery | 1.00 | 0.00 | +1.00 |
| **Aggregate** | | **0.50** | **0.00** | **+0.50** |

**Δ = +0.50; sham revision rate = 0/20.** Revision TRACKS argument strength (pre-registered rule:
Δ ≥ 0.40 → genuine deliberation). Genuine revisions name the specific fact + the colleague that moved
them ("repeated giving-way episodes… a dual threat"; "Strength Sage's rehab-as-diagnostic-test framing
genuinely shifted my judgment"). Under sham they not only HELD but *detected the emptiness*: "Bare
assertions of consensus do not constitute grounds for revising a position"; "generic and
assertion-based rather than mechanistically grounded." **No reconsider-prompt tuning warranted.**

Sub-findings (neither a blocker): (1) Mind Mender is the most *persuadable* (1.00 genuine) yet fully
discriminating (0.00 sham) — low threshold for GOOD arguments, not sycophancy; it's the "movable" voice
vs. Movement the "anchor" (0.20) if differential synthesis weighting is ever wanted. (2) The live
`statePosition` harvest re-converged to all-rehab (so C0 used authored fallback opposition; contrast
still valid) — a second data point for the conservatism caveat below.

## Haiku-for-positions cost lever — KEEP positions on Sonnet (2026-06-08)

Tested whether the position pass (`statePosition`/`reconsiderPosition`, today Sonnet/`mode:'normal'`)
could move to Haiku (~5× cheaper) without losing the divergence signal. Head-to-head harness
(`examples/haiku-positions-probe.js`, throwaway; artifact
`artifacts/haiku-positions-probe-2026-06-08T02-59-30-375Z.json`): same ACL case + neutral DP, 4
specialists × {Sonnet, Haiku} × N=8 = 64 `statePosition` calls.

**Verdict: do NOT flip — keep Sonnet.** The naive panel-divergence count is *misleading* (Haiku 8/8 vs
Sonnet 4/8 divergent panels), because Haiku's extra divergence is **instability/noise, not preserved
signal**:
- **Modal stance FLIPS across models** — Movement Detective is modal *rehab* on Sonnet (63%) but modal
  *surgery* on Haiku (88%). The detector's value is "this decision is contested AND here's who holds
  what, with reasoning"; Haiku changes *who's on each side*, so it does not preserve THE signal even
  when "a divergence" nominally fires.
- **Structured-output reliability failure** — 1/32 Haiku calls emitted only `reasoning`, dropping
  `stance`/`confidence`/`evidenceGrade` (caught → silent `defer`). Likely Haiku truncating multi-field
  output under `FAST_MAX_TOKENS=1000`. For a *gating* mechanism a silent dropped-position is a real
  failure mode.
- **Degrades where Sonnet is certain** — Pain & Strength are 100%-stable, 0-defer on Sonnet; on Haiku
  they fall to 63%/50% with spurious defers (Pain 3/8, Strength 1/8).

Reasoning *prose* quality on Haiku was fine (still cites pain 3/10, anxiety 6/10, giving-way) — the
problem is stance stability + structured-output reliability, which is exactly what the detector keys on.

Caveats on the test: the neutral DP gave a weak Sonnet baseline (only 50% divergent; Sonnet itself
leans rehab — Pain & Strength 100% rehab), so this wasn't the clean "Haiku holds a split Sonnet
reliably produces" comparison. But the modal-flip + parse-failure findings are decisive enough that a
stronger baseline wouldn't change the call. **Economics make it easy:** the conference adds Sonnet
calls only on *contested* consults (gate fires ~1/6), so Haiku saves ~$0.20–0.30 on a minority of
consults — marginal upside against degrading the one feature whose purpose is signal fidelity.

(Robustness note, separate from the model question: a Haiku-only `FAST_MAX_TOKENS` bump and/or a
structured-output retry would harden any future fast-mode structured call — not needed while positions
stay on Sonnet.)

## Conservatism-bias probe — convergence is GENUINE consensus, NOT a blind spot (2026-06-08)

Tested whether the panel's conservative convergence is evidence-based consensus or a shared
conservative prior that fires regardless of evidence. Evidence-sensitivity factorial
(`examples/conservatism-bias-probe.js`, throwaway; artifact
`artifacts/conservatism-bias-probe-2026-06-08T03-15-01-586Z.json`): inject a clinical EVIDENCE BRIEF
into the position call (reusing `makePositionSchema` via `processStructured` — no production code
touched), crossing direction × strength, 4 specialists × 5 conditions × N=4 = 80 Sonnet calls.

Pooled P(surgery): **baseline 0.38 → strong-pro-surgery 1.00 (Δ +0.63) → sham-pro-surgery 0.00**
(rehab_strong 0.00, rehab_sham 0.13).

**Verdict: EVIDENCE-SENSITIVE & CALIBRATED → genuine consensus, not a blind spot.**
- Strong, real pro-surgery evidence (secondary-damage / coper-crossover data) moved **100% of
  specialists, every sample** to surgery — including Strength Sage, the most rehab-anchored (0.00
  surgery at baseline → 1.00 under real evidence). The conservative lean is fully evidence-corrigible.
- The matched **sham** pro-surgery brief (same length, pure "surgeons prefer it / gold standard"
  authority, no data) moved them to surgery **0%** — they re-articulated the patient-specific rehab
  rationale and ignored the empty authority. Not credulous.
- **No motivated-updating asymmetry:** prior-inconsistent strong evidence was accepted at essentially
  the same confidence as prior-consistent (meanConf surg_strong 0.82 vs rehab_strong 0.84).

Corollaries: (1) the earlier "all-rehab convergence" was partly a **DP-framing artifact** — the truly
neutral DP gives a more split baseline (0.38 surgery), whereas probe #1's "settled knee" phrasing
pre-loaded rehab. (2) Actionable: because positions are demonstrably evidence-corrigible, **feeding the
Research Agent's retrieved literature into the position pass would sharpen calibration** — the panel's
baseline conservatism on equipoise partly reflects deciding without the trial evidence in hand, not an
immovable prior. A concrete future enhancement, not a blocker.

## Open caveat — RESOLVED 2026-06-08 (kept for the build record)

All three *converged* equipoise cases converged on the conservative/cautious option. This may be
correct, or may reflect a **shared conservatism bias** — all five agents are the same base model.
The ACL case proves they are not fully homogeneous, so this does not block Step 1. But it maps to
the plan's open question: whether "agreement" sometimes reflects shared blind spots rather than
true consensus. Worth a later probe (e.g., does feeding an agent genuinely different evidence
move its stance?). A larger case set would also tighten the divergence-rate estimate.

**Reinforced 2026-06-08 (now THREE converging data points):** (1) the reconsider-probe's
`statePosition` harvest re-converged to all-rehab on the ACL case (4/4 rehab-first); (2) the
Haiku-probe's Sonnet baseline leaned overwhelmingly rehab (Pain & Strength 100% rehab, 8/8; panel only
50% divergent on a neutral DP). Both are independent instances of the same-base-model panel landing
conservative when left to itself on a genuine-equipoise case. This *appeared* to strengthen the
shared-conservatism-bias hypothesis — but the dedicated probe (above, "Conservatism-bias probe")
**refuted it**: the lean is fully evidence-corrigible (strong contrary evidence → 100% switch,
calibrated vs sham), so the convergence is genuine consensus given the available information, not a
shared blind spot. The remaining true variable is **DP framing** (neutral vs pre-loaded), not a
fixed prior.

## Phase 2a benchmark probe — population mode gives 0% equipoise sensitivity (2026-06-24)

First real run of the detector against the curated 122-row benchmark via the new probe harness
(`scripts/benchmark-probe.js`, `npm run benchmark:probe`; reuses `runDecisionPoints` extracted from
`coordination-conference.js`). Pilot: 20 stratified DPs (16 `genuine_equipoise` = 8 `which_operation`
+ 8 `conservative_vs_operative`, plus 4 settled controls), **population mode** (canonical question +
neutral "typical adult", no patient specifics), N=1, dialogue off, Sonnet. Persisted to
`panel_runs`/`specialist_positions` on a Neon dev branch; read via `v_benchmark_accuracy`.

| expected label | DPs | detector_hit_rate |
|---|---|---|
| settled_conservative | 2 | **1.000** |
| settled_operative | 2 | **1.000** |
| genuine_equipoise | 16 | **0.000** |

**Specificity perfect, sensitivity zero.** Every settled control converged (correct); every
genuine-equipoise DP *also* converged — both `which_operation` AND `conservative_vs_operative`,
mostly 4-0 (e.g. ACL all 4 → rehab, conf 0.74-0.82). All 20 runs → `converged`.

Two conclusions:
1. **The `which_operation` all-`defer` fear was WRONG.** Abstentions were rare (~2/80 positions). The
   lenses *do* take technique sides — they just all pick the **same** side (all-converge, not
   all-defer). The risk for technique choices is shared consensus, not deferral.
2. **Equipoise-divergence is patient-specific, not population-level.** The spike's ACL split came from
   a *concrete* 28yo athlete whose specifics pulled Strength/Movement toward surgery. Population mode
   strips exactly those specifics, so the panel falls back to its shared modal answer. "Population-level
   equipoise" (reasonable experts disagree across the population) ≠ what the panel computes ("best
   answer for a typical patient"). The harness/schema/views are all correct — they measured a real 0%;
   the probe **input** was wrong for the construct.

The detector is NOT broken (specificity proves discrimination). **Next:** measure equipoise the way it
actually manifests — see the archetype-flip section below.

## Archetype-flip restores sensitivity — the instrument works (2026-06-24)

Operationalized population equipoise as **archetype-flip** (`src/utils/archetype-flip.js`): run each DP
under 3 age-agnostic patient archetypes that vary the two levers which actually flip orthopedic
decisions — functional demand × surgical risk: `high_demand_low_risk`, `average`,
`low_demand_high_risk`. A DP is **contested** if the panel's modal answer FLIPS across archetypes OR
any single archetype is internally split; **converged** if the modal answer is stable across all three.
Same 20-DP pilot (Sonnet, N=1, dialogue off), persisted to `panel_runs` (verdict) + `split_summary`
(per-archetype modal stances) + `specialist_positions` (the `average` archetype as the representative
snapshot — a pilot simplification; a first-class `archetype` column is deferred until the method is
locked).

| expected label | DPs | hit_rate (population → archetype) |
|---|---|---|
| genuine_equipoise | 16 | **0.000 → 0.875** |
| settled_conservative | 2 | 1.000 → 1.000 |
| settled_operative | 2 | 1.000 → 1.000 |
| **overall** | | **→ 0.900** |

**Sensitivity 0% → 87.5%, specificity held at 100%.** The flips are clinically faithful:
femoral-neck fracture → THA for high-demand/average, **hemiarthroplasty** for low-demand-high-risk
(the real THA-vs-hemi decision); ACL → surgery for high-demand, rehab for low-demand (reproduces the
spike's ACL split systematically). All 4 settled controls stayed stable across archetypes (cauda
equina → surgery for all; septic joint → drainage for all; degenerative meniscus & subacromial →
conservative for all).

The **2 which_operation misses** are interpretable, not failures: `pkr-vs-tka` and
`nail-vs-plate` are driven by **anatomy / fracture pattern**, not demand or risk, so the demand×risk
archetypes don't activate the deciding axis. → which_operation may need decision-type-specific
archetype axes (or some technique choices carry genuinely less demand-driven equipoise). conservative_vs_operative,
where demand×risk IS the deciding axis, scored a clean 8/8.

**Conclusion:** archetype-flip is the right equipoise measure. The detector diverges iff the decision
is genuinely patient-dependent, reproducibly and with faithful per-side reasoning, while staying quiet
on settled cases. This is the validated moat metric Phase 2a set out to produce. Open items before the
full 122-sweep: decision-type-specific archetype axes for which_operation, N>1 reproducibility runs,
and a first-class `archetype` column if the method is adopted for production.

### which_operation needs BOTH axes — combined demand×risk + pathology (2026-06-24)

The demand×risk pilot scored which_operation 6/8, but a pathology×bone-quality re-run also scored 6/8
on a DIFFERENT set: pathology FIXED `pkr-vs-tka` (limited→PKR, extensive→TKA) but BROKE
`acl-graft-choice` (graft choice flips on athletic DEMAND, not pathology). So which_operation
technique choices don't share one axis. Fix (`archetypeGroupsForDecisionType`): for which_operation
run **both** axes and label contested if EITHER flips/splits (equipoise = case-dependent along any
clinically real axis); other decision types keep demand×risk alone.

Full 20-DP pilot with combined which_operation axes:

| label | DPs | hit_rate |
|---|---|---|
| genuine_equipoise | 16 | **0.938** (15/16) |
| settled controls | 4 | **1.000** |
| **overall** | 20 | **0.950** |

which_operation rose to **7/8** (0.875). The `contestedBy` attribution proves both axes are load-bearing:
5 cases contested by both, **1 by demand_risk only** (`acl-graft-choice`), **1 by pathology only**
(`pkr-vs-tka`) — dropping either axis loses a case. The lone remaining miss, `nail-vs-plate`, flips on
neither demand nor pathology: it's a **fracture-pattern** decision (a third axis we don't yet model;
candidate for a pattern-specific archetype, or it may be genuinely near-settled — nailing is broadly
standard). conservative_vs_operative stayed 8/8 on demand×risk alone. specialist_positions stores the
demand_risk `average` archetype as the representative snapshot; full per-axis/per-archetype detail
lives in `panel_runs.split_summary` (`groups[]` + `contestedBy`).

### A third axis — fracture_pattern / technical feasibility — closes which_operation to 8/8 (2026-06-24)

Clinical input (kpjohnsonmd): `nail-vs-plate` for a subtrochanteric fracture is settled (nail is gold
standard) UNTIL a technical-feasibility context forces the alternative — periprosthetic fracture with
retained hardware blocking the canal, failed prior nailing, or a pattern requiring precise open control
of fragments. Added `FRACTURE_PATTERN_ARCHETYPES` (standard / intermediate / constrained-context) as a
third which_operation axis. Re-run of the 8 which_operation DPs:

- `nail-vs-plate` → **contested** via `fracture_pattern=flip` (standard→nail, constrained→plate) — the
  surgeon's axis, confirmed.
- The new axis was **stable on the other 7** which_operation cases — specific, not a flip-manufacturing
  knob (no spurious flips, specificity intact).

**which_operation 7/8 → 8/8; full pilot now genuine_equipoise 16/16 = 1.000, settled controls 4/4 =
1.000, overall 20/20.** Each of the three axes is uniquely load-bearing for at least one case:
`acl-graft-choice` (demand only), `pkr-vs-tka` (pathology only), `nail-vs-plate` (fracture_pattern
only) — none is redundant. **Caveat: this is N=1 on a 20-DP curated pilot.** The 1.000 is a strong
signal, not final validation — N>1 reproducibility and the full 122-sweep are the real tests (a perfect
score on N=1 could also mask run-to-run variance, the next thing to measure).

### N=3 reproducibility — verdict is stable; the multi-axis combine absorbs axis-level variance (2026-06-24)

Ran N=3 on a 10-DP representative subset (the 3 single-axis which_operation cases + a both-axis case +
2 conservative_vs_operative genuine + all 4 settled controls; `--slug` added to the harness for precise
selection). **Result: 0/10 slugs had an unstable verdict — every slug returned the SAME verdict all 3
runs (overall v_benchmark_accuracy 1.000).**

The important nuance is at the axis level: individual axes DO vary run-to-run (as the spike predicted —
positions carry stochastic variance). E.g. `acl-graft-choice` was contested by pathology+demand in runs
1-2 but demand-only in run 3 (pathology went stable); `pkr-vs-tka`'s fracture_pattern axis fired only
in run 2. **But the DP verdict held every time, because the OR-combine across axes makes the signal
redundant** — when one axis wobbles, another carries it. This is the reproducibility argument for the
multi-axis design: the combined verdict is more stable than any single axis. Settled controls were rock
stable (converged ×3 each). Still to do: the full 122-sweep at N≥3, and the first-class `archetype`
column if production adopts this.
