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

## Open caveat (carry into the build, not a blocker)

All three *converged* equipoise cases converged on the conservative/cautious option. This may be
correct, or may reflect a **shared conservatism bias** — all five agents are the same base model.
The ACL case proves they are not fully homogeneous, so this does not block Step 1. But it maps to
the plan's open question: whether "agreement" sometimes reflects shared blind spots rather than
true consensus. Worth a later probe (e.g., does feeding an agent genuinely different evidence
move its stance?). A larger case set would also tighten the divergence-rate estimate.
