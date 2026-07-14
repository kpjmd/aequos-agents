# Equipoise Vignette Screener

Predict whether a decision fork will fire a **contested equipoise card** on `/api/v1/consult`
*before* spending a live consult — for curating kpjmd.com/ask "contested content" candidates.

The screener runs the **exact validated archetype-flip sweep** used by the production consult path
(`runArchetypeFlipSweep`), so its verdict matches what you'll get live. No database; it needs only
`ANTHROPIC_API_KEY` (already in `.env`).

> Location: `scripts/screen-vignette.js` (branch `feat/equipoise-benchmark-expansion`).

---

## Quick start

```bash
# Single fork, inline:
npm run screen:vignette -- \
  --question "For a full-thickness supraspinatus tear from an acute fall, is early surgical repair or continued non-operative management the better approach?" \
  --a "early surgical repair" \
  --b "continued non-operative management"
```

```bash
# Batch a whole library from a JSON file, with reproducibility runs:
npm run screen:vignette -- --file scripts/candidates.example.json --runs 3

# Machine-readable output (for piping into your own tooling):
npm run screen:vignette -- --file candidates.json --json
```

> Note the `--` after the npm script name — it passes the flags through to the script.

### Flags

| Flag | Meaning |
|---|---|
| `--question`, `-q` | The decision fork, phrased as a question |
| `--a`, `--option-a` | Option A label |
| `--b`, `--option-b` | Option B label |
| `--decision-type` | Flip axis (see below). Default = `demand_risk` |
| `--file` | JSON file of candidates (array; batch mode) |
| `--runs N`, `--n N` | Reproducibility runs per candidate (default 1; **use 3** for library screening) |
| `--limit N` | Max concurrent panels per axis (default 2) |
| `--json` | Emit machine-readable JSON instead of the readout |

### `candidates.json` format

```json
[
  {
    "id": "acute-cuff-tear",
    "question": "…the decision fork as a question…",
    "optionA": "early surgical repair",
    "optionB": "continued non-operative management",
    "decisionType": null
  }
]
```

`decisionType` selects the flip axis (matches production's classifier output):

| value | axis used |
|---|---|
| `null` / omitted / `"conservative_vs_operative"` / `"which_intervention"` | **demand_risk** (default) |
| `"which_operation"` | pathology × bone-quality × fracture-pattern (technique/implant choice) |
| `"timing_of_surgery"` | demand_risk + biological_window |

A novel library vignette that doesn't match a curated benchmark slug gets `null` in production, so the
default here mirrors what you'll actually see live.

---

## Reading the output

```
CANDIDATE: acute-cuff-tear
Q: For a full-thickness supraspinatus tear from an acute fall, …
   A: early surgical repair   |   B: continued non-operative management
   axis: demand_risk (decision_type: default)
────────────────────────────────────────────────────────────
Run 1: CONTESTED ✅
  demand_risk: FLIP
    high-demand, low surgical risk       → early surgical repair
    average demand and risk              → early surgical repair
    low-demand, elevated surgical risk   → continued non-operative management
────────────────────────────────────────────────────────────
VERDICT: CONTESTED in 1/1 run(s)  →  ✅ WILL fire a contested equipoise card
```

- **FLIP** — the panel's modal answer changes across archetypes → the decision is patient-dependent → **contested** (fires).
- **INTERNAL SPLIT** — one archetype's panel disagrees internally → also contested, but usually a *borderline* signal.
- **stable** — same answer across all archetypes → **converged** (card reveals but does not contest).
- **BORDERLINE** — contested in some runs but not others → the case sits on the flip threshold; not reliable library material.

---

## How it decides (the mental model)

The instrument measures **population equipoise**: *does the right answer flip based on the patient's
functional demand and surgical risk?* The sweep re-runs your fork across three archetypes
(high-demand/low-risk, average, low-demand/high-risk), **holding your fixed clinical facts constant**,
and calls it contested only if the modal answer flips (or an archetype is internally split).

**The one thing that trips people up:** the sweep **overwrites** the patient specifics you write
(age, activity level) with its own archetypes. So "68-year-old, highly active" is *washed out* — activity
is the variable being tested. Only the facts that aren't demand/risk (pathology, chronicity, tissue
quality, mechanism) are held constant. State those neutrally and let the sweep vary demand.

The screening test to apply before you even write the vignette:

> *"Would I genuinely operate on the marathon runner but rehab the frail, sedentary patient — same pathology?"*
> If **yes** → it flips → contested. If the answer is "conservative trial first for everyone, then
> reassess" → it converges.

---

## Tips for building contested content

1. **Screen with `--runs 3`.** LLM panels are stochastic; a single run of a borderline case is a
   coin-flip. Publish only cases that are **stably contested** — ideally a clean **FLIP**, not a
   one-run internal split.
2. **Use a genuine either/or fork**, not a conservative-first ladder. "X now **or** Y first" frames
   Y-first as reasonable for nearly everyone and **converges by construction**. Prefer
   "early surgical repair **vs** continued non-operative management."
3. **Choose decisions that truly flip on demand.** Reliable firers:
   - acute *traumatic* full-thickness rotator cuff tear (not chronic/atraumatic — that converges on PT-first)
   - ACL rupture: reconstruction vs structured rehabilitation
   - displaced midshaft clavicle fracture
   - acute Achilles rupture
   - first-time shoulder dislocation: stabilize vs rehab
4. **For technique/implant choices, set `decisionType: "which_operation"`** — those flip on the
   pathology/bone-quality axis, not demand (e.g. UKA vs TKA, ACL graft choice, nail vs plate).
5. **Write pathology neutrally.** Don't lean on patient demographics; the archetypes supply demand/risk.

---

## Cost & performance

Each **run** = axes × archetypes × 4 panelists on Sonnet:

- `demand_risk` (default): ~12 Sonnet calls/run
- `which_operation`: ~36 Sonnet calls/run

So a `--runs 3` demand-risk screen ≈ 36 Sonnet calls. Batch overnight if screening a large library.

---

## Notes

- The screener forces `ENABLE_BLOCKCHAIN=false` and quiets logs by default — set `LOG_LEVEL=debug`
  in your shell to see agent chatter.
- A **converged** verdict is not a failure of the tool — it's a true statement that the decision has a
  demand-independent answer. Those make good *informational* content, just not *contested* content.
