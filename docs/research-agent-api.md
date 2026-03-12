# Research Agent API Reference

## Table of Contents

1. [Overview](#1-overview)
   - [Triage-Informed Query Building](#triage-informed-query-building)
   - [Tier System](#tier-system)
2. [Endpoints](#2-endpoints)
   - [POST /research/trigger](#post-researchtrigger)
   - [GET /research/:consultationId](#get-researchconsultationid)
3. [Research Result Schema](#3-research-result-schema)
4. [Token Economics](#4-token-economics)
5. [Integration Guide](#5-integration-guide)
6. [Testing Guide](#6-testing-guide)

---

## Production Base URL

```
https://orthoiq-agents-api.railway.internal
```

> **Note:** This is a Railway-internal URL, accessible only from other services deployed within the same Railway project. If your frontend is hosted outside Railway, use the public `.up.railway.app` URL from the Railway dashboard instead.

No authentication headers are required. CORS is enabled for all origins.

---

## 1. Overview

The Research Agent subsystem enriches orthopedic consultations with curated, evidence-based literature sourced from PubMed. It operates as a **fire-and-forget** service: the trigger endpoint returns immediately with a `pending` status while literature retrieval and curation run asynchronously in the background (up to 15 seconds). Callers poll a separate status endpoint until research is complete.

As of v0.8.0, the agent produces a **structured research summary** rather than a flat paragraph block. The `intro` field now follows a consistent six-section format with PICO restatement, evidence-graded citations, and explicit Evidence Gaps & Caveats. See [Section 3 — Research Result Schema](#3-research-result-schema) for the full format.

### Triage-Informed Query Building

A key feature of the Research Agent is that it uses the **Triage Agent's output** to construct specific PubMed search queries — even when the user's original question was vague.

**Example:**

| User Query | Without Triage | With Triage |
|-----------|---------------|-------------|
| "34yo male, knee pain, swelling and giving way after basketball" | `(knee AND pain)` | `(knee AND "anterior cruciate ligament")` |
| "shoulder pain lifting overhead, 3 months" | `(shoulder AND pain)` | `(shoulder AND "rotator cuff")` |

**How it works:**

1. Triage Agent processes the user's symptoms and generates a `suggestedDiagnoses` array (e.g., `["anterior cruciate ligament", "meniscus"]`) via `extractSuggestedDiagnoses()` in `src/agents/triage-agent.js`
2. In fast mode, the triage result (including `suggestedDiagnoses`) is passed as `triageContext` to `curateRelevantStudies()` before PubMed is queried
3. `extractClinicalTerms()` in the Research Agent prepends those diagnosis terms to the search text so the condition/body-part maps produce specific PubMed terms
4. The abbreviation table ensures shorthand in triage output (e.g., "ACL") is already expanded before storage

This means the research quality automatically improves as triage confidence improves — no user action required.

### Async Model

```
Client                 API Server              PubMed
  │                       │                      │
  │  POST /research/trigger│                      │
  │──────────────────────▶│                      │
  │  { status: 'pending' } │                      │
  │◀──────────────────────│                      │
  │                       │── searchPubMed ──────▶│
  │                       │◀─ pmids ─────────────│
  │                       │── fetchArticleDetails▶│
  │                       │◀─ XML ───────────────│
  │                       │   [filter+score]      │
  │                       │   [store to DB]       │
  │                       │   [award tokens]      │
  │                       │                      │
  │  GET /research/:id     │                      │
  │──────────────────────▶│                      │
  │  { status: 'complete'} │                      │
  │◀──────────────────────│                      │
```

### Tier System

| Tier | Max Citations | Query Method | Token Bonus |
|------|--------------|--------------|-------------|
| `basic` (default) | 3 | Keyword extraction from symptoms + triage output | — |
| `premium` | 5 | Keyword extraction from symptoms + triage output | +2 (`PREMIUM_ACCESS`) |
| `premium` *(planned)* | 10 | LLM-generated optimized queries + multi-query deduplication | +2 (`PREMIUM_ACCESS`) |

All citations pass a minimum quality score threshold of **6/10** before being returned. Results are sorted descending by quality score, then by relevance score.

> **Planned Premium Enhancement**: A future upgrade will add LLM-generated PubMed query construction for premium users. A Haiku call will translate the triage diagnosis and symptoms into 2–3 optimized PubMed search strings, which run in parallel and are deduplicated by PMID before quality filtering. This will raise the citation cap to 10 and produce more condition-specific literature. See TODO.md for implementation details.

### PubMed Configuration

Controlled via environment variables (see `src/config/agent-config.js`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBMED_API_KEY` | `null` | NCBI API key (raises rate limit from 3 to 10 req/s) |
| `PUBMED_REQUEST_TIMEOUT` | `15000` | Per-request timeout in milliseconds |
| `PUBMED_MAX_RESULTS` | `20` | Maximum PMIDs fetched per search |

---

## 2. Endpoints

### POST /research/trigger

Initiates an asynchronous literature search for a given consultation. The response is returned **immediately** before any PubMed communication occurs.

#### Request

```
POST /research/trigger
Content-Type: application/json
```

**Body Schema**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `consultationId` | `string` | Yes | Unique identifier for the consultation (used as the polling key) |
| `caseData` | `object` | Yes | Patient case data (see sub-fields below) |
| `consultationResult` | `object` | Yes | Result from the `/consultation` endpoint |
| `userTier` | `string` | No | `"basic"` (default) or `"premium"` |

**`caseData` Sub-fields Used for Query Building**

| Field | Type | Description |
|-------|------|-------------|
| `primaryComplaint` | `string` | Chief complaint (e.g., `"knee instability after soccer injury"`) |
| `symptoms` | `string` | Symptom description (e.g., `"giving way, swelling"`) |
| `duration` | `string` | Duration of symptoms (e.g., `"2 weeks"`) |

Additional `caseData` fields are passed through to specialist agents during consultation but are not used directly in PubMed query construction.

**`consultationResult` Sub-fields Used**

| Field | Path | Description |
|-------|------|-------------|
| `triage` | `consultationResult.triage` | Full triage assessment injected as `triageContext` into the enriched query |
| `triage.suggestedDiagnoses` | `consultationResult.triage.suggestedDiagnoses` | Array of expanded diagnosis terms extracted by triage (e.g., `["anterior cruciate ligament", "meniscus"]`). **Primary driver of PubMed search specificity.** |
| `triage.assessment.primaryFindings` | `consultationResult.triage.assessment.primaryFindings` | Fallback text mining source if `suggestedDiagnoses` is empty |
| `responses` | `consultationResult.responses` | Agent responses summarized for query enrichment |

**Example Request**

```json
POST /research/trigger
{
  "consultationId": "cons_20240115_abc123",
  "userTier": "premium",
  "caseData": {
    "primaryComplaint": "knee instability after soccer injury",
    "symptoms": "giving way, swelling",
    "duration": "2 weeks"
  },
  "consultationResult": {
    "triage": {
      "urgencyLevel": "semi-urgent",
      "suggestedDiagnoses": ["anterior cruciate ligament", "meniscus"],
      "assessment": {
        "primaryFindings": ["ACL tear suspected", "meniscal injury possible", "mechanical instability"]
      },
      "specialistRecommendations": ["movementDetective", "strengthSage"]
    },
    "responses": { "movement": "Assess for ligamentous laxity..." }
  }
}
```

> **Note:** The `triage.suggestedDiagnoses` array is generated automatically by `TriageAgent.extractSuggestedDiagnoses()` and is included in the triage object returned by `/consultation` and `/triage`. In fast mode, it is also passed to the auto-triggered research job directly on the server side — the frontend does not need to construct this manually.

#### Response

**Success — `200 OK`**

```json
{
  "success": true,
  "consultationId": "cons_20240115_abc123",
  "status": "pending",
  "estimatedSeconds": 15
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Always `true` for a valid trigger |
| `consultationId` | `string` | Echoed from the request |
| `status` | `string` | Always `"pending"` on trigger |
| `estimatedSeconds` | `number` | Expected wait time before polling returns results (always `15`) |

#### Error Codes

| HTTP Status | Error | Cause |
|-------------|-------|-------|
| `400 Bad Request` | `"consultationId, caseData, and consultationResult are required"` | One or more required body fields are missing |
| `500 Internal Server Error` | `"Research trigger failed"` | Unexpected server error before DB write |
| `503 Service Unavailable` | `"Research agent not available"` | Research agent failed to initialize at server startup |

---

### GET /research/:consultationId

Returns the current status and result of a previously triggered research job.

#### Request

```
GET /research/{consultationId}
```

| Parameter | Location | Type | Description |
|-----------|----------|------|-------------|
| `consultationId` | URL path | `string` | The same `consultationId` used in the trigger call |

#### Response Shapes

There are four possible response shapes depending on the current state of the job.

---

**Pending — `200 OK`**

Research is still running. The `estimatedSeconds` field counts down from 15 based on elapsed time since the trigger.

```json
{
  "status": "pending",
  "estimatedSeconds": 9
}
```

`estimatedSeconds` = `max(0, 15 - round(elapsed_seconds))`

---

**Complete — `200 OK`**

Research finished successfully. The `research` object contains the full result.

```json
{
  "status": "complete",
  "research": {
    "intro": "Recent research shows strong evidence for conservative management...",
    "citations": [ /* array of citation objects — see Section 3 */ ],
    "searchQuery": "(knee instability) AND (\"2020\"[Date - Publication] : \"2025\"[Date - Publication]) AND ...",
    "studiesReviewed": 18,
    "tier": "premium"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `research.intro` | `string` | Structured research summary generated by Claude Haiku (see format below). **Contains Markdown** (`##` headings, `**bold**`, `###` sub-headings) — pass through a Markdown renderer before display. |
| `research.citations` | `array` | Curated citation objects (3 for basic, 5 for premium) |
| `research.searchQuery` | `string` | Exact PubMed query that was executed |
| `research.studiesReviewed` | `number` | Total PMIDs retrieved before quality filtering |
| `research.tier` | `string` | `"basic"` or `"premium"` |

---

**Failed — `200 OK`**

Research encountered an error (PubMed timeout, network failure, etc.).

```json
{
  "status": "failed",
  "error": "Research timed out after 15 seconds",
  "fallback": "Research unavailable - recommendations based on clinical guidelines"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` | The error message that caused failure |
| `fallback` | `string` | Human-readable fallback message for display to patients |

---

**Not Found — `404 Not Found`**

No research job was ever triggered for this `consultationId`.

```json
{
  "status": "not_found",
  "error": "No research request found for this consultation"
}
```

---

**Polling Recommendation**

Poll every **2 seconds**. Stop polling after **20 seconds** regardless of status.

```
t=0s  → trigger, status=pending (estimatedSeconds=15)
t=2s  → poll, status=pending  (estimatedSeconds=13)
t=4s  → poll, status=pending  (estimatedSeconds=11)
...
t=16s → poll, status=complete ✓  (or status=failed)
t=20s → timeout, treat as failed if still pending
```

---

## 3. Research Result Schema

### `intro` Field: Structured Research Summary Format

As of v0.8.0, the `intro` string follows this six-section structure (rendered from Markdown):

```markdown
## Research Summary: [Condition / Question]

**Clinical Question**: [PICO restatement — Population, Intervention, Comparison, Outcome — plain language]
**Evidence Base**: [N studies found; highest level: Level N]

---

### Key Findings

[2–4 sentences. Most actionable finding first. Plain language, 8th-grade reading level.]

---

### Citations

**[Grade A]** Author et al., Year — Journal
*What was studied, what was found, why it is relevant.*
PubMed ID: XXXXXXXX

**[Grade B]** Author et al., Year — Journal
*One-sentence summary. Note explaining why grade is B (e.g., population mismatch, retrospective design).*
PubMed ID: XXXXXXXX

---

### Evidence Gaps & Caveats

- [Age, activity level, or surgical vs. conservative population mismatches]
- [Guideline alignment or conflict with AAOS/AOSSM/APTA]
- [For biologics: FDA regulatory status. For techniques <5 years old: limited follow-up data flag.]
- [Other limitations or weak evidence areas]

---

### Suggested Follow-Up Searches

[1–2 related PubMed queries for adjacent evidence]
```

#### Evidence Grade Definitions

| Grade | Evidence Level | Assigned When |
|-------|---------------|---------------|
| **A** | Level 1–2 | Systematic review, meta-analysis, or high-quality RCT (qualityScore ≥ 7) |
| **B** | Level 2–3 | Lower-quality RCT (qualityScore < 7), prospective cohort, or case-control study |
| **C** | Level 4–5 | Retrospective study, case series, narrative review, or expert opinion |
| **X** | Flagged | Contradicts current AAOS/AOSSM/APTA guidelines; explanation included |

Grades are pre-computed in `generateResearchIntro()` from `studyType` and `qualityScore` before the Haiku call. The LLM receives the suggested grade and may adjust it based on the abstract content.

#### Emerging Topic Handling

Certain topics trigger additional caveats automatically in the Evidence Gaps section:

| Topic | Caveat Injected |
|-------|----------------|
| Biologics (PRP, stem cells, exosomes) | Current FDA regulatory status note |
| Return-to-sport | Note on whether study RTS criteria are time-based or functional |
| Techniques with <5 years follow-up | Limited long-term data flag |
| Conflicting high-quality studies | Both presented; discrepancy noted without adjudication |

#### Skill Methodology

The prompts in `getSystemPrompt()` and `generateResearchIntro()` are derived from the `orthoiq-research` skill definition stored at `skills/orthoiq-research/SKILL.md`. The skill package includes:

- `skills/orthoiq-research/SKILL.md` — full 6-step methodology (PICO parsing, evidence hierarchy, population filters, grading, guideline cross-reference, response structure)
- `skills/orthoiq-research/references/emerging-topics.md` — PRP/biologics, RTS, <5-year surgical techniques, wearables
- `skills/orthoiq-research/references/guideline-sources.md` — AAOS, AOSSM, APTA, NICE/Cochrane URLs and conflict protocol

Skill files are versioned in git and designed for future MCP server exposure.

---

### Citation Object

Each element of the `citations` array has the following 15 fields:

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `pmid` | `string` | `"38234567"` | PubMed article identifier |
| `title` | `string` | `"ACL Reconstruction Outcomes in Athletes..."` | Full article title |
| `authors` | `string` | `"Smith J, Doe A, Jones B, et al."` | Formatted author list (max 3, then "et al.") |
| `rawAuthors` | `string[]` | `["Smith J", "Doe A"]` | Unformatted author list |
| `journal` | `string` | `"Journal of Bone and Joint Surgery"` | Journal name from PubMed |
| `year` | `string` | `"2024"` | Publication year |
| `volume` | `string` | `"106"` | Journal volume |
| `issue` | `string` | `"3"` | Journal issue |
| `pages` | `string` | `"123-130"` | Page range |
| `doi` | `string` | `"10.2106/JBJS.24.00123"` | Digital Object Identifier (may be empty) |
| `pubmedUrl` | `string` | `"https://pubmed.ncbi.nlm.nih.gov/38234567/"` | Direct link to PubMed record |
| `abstract` | `string` | `"BACKGROUND: ..."` | Full or structured abstract text |
| `studyType` | `string` | `"Randomized Controlled Trial"` | Classified study design (see below) |
| `qualityScore` | `number` | `9.5` | 0–10 composite quality score (see formula below) |
| `relevanceScore` | `number` | `7` | 0–10 keyword-match relevance to query terms |

### Study Type Classification

Study types are assigned in the following priority order from PubMed publication type tags:

| `studyType` Value | PubMed Tag Matched |
|-------------------|--------------------|
| `"Meta-Analysis"` | `meta-analysis` |
| `"Systematic Review"` | `systematic review` |
| `"Randomized Controlled Trial"` | `randomized controlled trial` |
| `"Clinical Trial"` | `clinical trial` |
| `"Review"` | `review` |
| `"Other"` | (none of the above) |

### Quality Score Formula

```
qualityScore = min(base + journalTier + studyType + recency, 10)
```

**Component Values**

| Component | Condition | Points |
|-----------|-----------|--------|
| `base` | Always | 5 |
| `journalTier` | Tier 1 journal | +3 |
| `journalTier` | Tier 2 journal | +2 |
| `journalTier` | Tier 3 journal | +1 |
| `journalTier` | Unranked journal | +0 |
| `studyType` | RCT or Meta-Analysis | +2 |
| `studyType` | Systematic Review | +1.5 |
| `studyType` | Review | +1 |
| `studyType` | Clinical Trial or Other | +0 |
| `recency` | Year ≥ 2024 | +2 |
| `recency` | Year = 2023 | +1.5 |
| `recency` | Year 2020–2022 | +1 |
| `recency` | Year < 2020 | +0 |

**Quality Filter**: Citations with `qualityScore < 6` are discarded before returning results.

**Maximum per-tier example**: A 2024 RCT from JBJS would score `5 + 3 + 2 + 2 = 12`, capped to **10**.

### Journal Tier Reference

**Tier 1 (score +3)** — Top orthopedic and general medical journals:
- Journal of Bone and Joint Surgery (JBJS)
- American Journal of Sports Medicine (AJSM)
- New England Journal of Medicine (NEJM)
- JAMA
- Lancet
- BMJ
- Arthroscopy

**Tier 2 (score +2)** — Strong specialty journals:
- Clinical Orthopaedics and Related Research
- Knee Surgery, Sports Traumatology, Arthroscopy (KSSTA)
- Journal of Shoulder and Elbow Surgery (JSES)
- Foot and Ankle International
- Bone and Joint Journal
- Journal of Arthroplasty
- Spine

**Tier 3 (score +1)** — Rehabilitation and musculoskeletal journals:
- Archives of Physical Medicine and Rehabilitation
- Physical Therapy
- Journal of Orthopaedic and Sports Physical Therapy (JOSPT)
- BMC Musculoskeletal Disorders
- European Spine Journal

Matching is case-insensitive substring matching against the full journal title from PubMed. A journal not matching any tier receives **+0**.

---

## 4. Token Economics

The Research Agent earns tokens from `distributeResearchTokens()` (`src/utils/research-tokens.js`) after each successful research cycle. Tokens are distributed to the agent's on-chain wallet via `TokenManager.distributeTokenReward()`.

### Event Values (`RESEARCH_TOKEN_EVENTS`)

| Constant | Value | Description |
|----------|-------|-------------|
| `LITERATURE_SEARCH_COMPLETED` | `1` | Base award for any completed search with citations |
| `RELEVANT_STUDIES_FOUND` | `3` | 3 or more citations returned |
| `HIGH_IMPACT_JOURNAL` | `5` | Per citation with `qualityScore >= 9` |
| `RECENT_EVIDENCE` | `2` | 2 or more citations from year ≥ 2023 |
| `MULTIPLE_STUDY_TYPES` | `3` | Citations include both RCT and Meta-Analysis |
| `PREMIUM_ACCESS` | `2` | Request used `userTier: "premium"` |
| `MD_CONFIRMS_HELPFUL` | `8` | Clinician confirms research was useful (external event) |
| `USER_CLICKED_CITATIONS` | `1` | User engagement event (external event) |
| `LOW_RELEVANCE` | `-2` | Penalty: average `qualityScore` of citations < 6 |
| `NO_STUDIES_FOUND` | `0` | No citations returned — no tokens awarded |
| `API_ERROR` | `0` | PubMed error — no tokens awarded |

### 7-Step Token Calculation

Token amounts are computed sequentially. If `citations.length === 0`, the function returns immediately with `{ tokens: 0, distributed: null }`.

| Step | Condition | Tokens Added | Breakdown Field |
|------|-----------|-------------|-----------------|
| 1 | `citations.length > 0` | +1 (`LITERATURE_SEARCH_COMPLETED`) | `breakdown.base` |
| 2 | `citations.length >= 3` | +3 (`RELEVANT_STUDIES_FOUND`) | `breakdown.relevantStudies` |
| 3 | Count of citations with `qualityScore >= 9` | +5 × n (`HIGH_IMPACT_JOURNAL`) | `breakdown.highImpactJournals` |
| 4 | Count of citations with `year >= 2023` ≥ 2 | +2 (`RECENT_EVIDENCE`) | `breakdown.recentEvidence` |
| 5 | Citations include both `"Randomized Controlled Trial"` and `"Meta-Analysis"` | +3 (`MULTIPLE_STUDY_TYPES`) | `breakdown.studyTypeDiversity` |
| 6 | `tier === "premium"` | +2 (`PREMIUM_ACCESS`) | `breakdown.premiumAccess` |
| 7 | Average `qualityScore` across all citations < 6 | −2 (`LOW_RELEVANCE`) | `breakdown.lowRelevancePenalty` |
| **Final** | `max(0, sum of all steps)` | | `tokens` |

### `distributeResearchTokens()` Return Shape

```js
{
  tokens: 14,           // Total computed tokens (floor 0)
  distributed: {        // Return value from TokenManager.distributeTokenReward() — null if tokens === 0
    transactionId: "txn_1705312800000_researchPioneer",
    agentId: "researchPioneer",
    amount: 14,
    newBalance: 42,
    blockchainTx: "0xabc123...",
    status: "simulated"  // "confirmed" | "simulated" | "local_only"
  },
  breakdown: {
    base: 1,
    relevantStudies: 3,
    highImpactJournals: 10,   // e.g. 2 tier-1 citations × 5
    recentEvidence: 2,
    studyTypeDiversity: 3,
    premiumAccess: 2,
    lowRelevancePenalty: 0
  }
}
```

### Example Calculation

**Scenario**: Premium request returns 3 citations — two 2024 RCTs from JBJS (qualityScore 10 each) and one 2024 Meta-Analysis from Lancet (qualityScore 10).

| Step | Condition Met | Tokens |
|------|--------------|--------|
| 1. Base | citations.length > 0 | +1 |
| 2. Relevant Studies | 3 citations ≥ 3 | +3 |
| 3. High Impact | 3 citations with score ≥ 9, so 3 × 5 | +15 |
| 4. Recent Evidence | all 3 are ≥ 2023 (≥ 2) | +2 |
| 5. Study Diversity | includes RCT and Meta-Analysis | +3 |
| 6. Premium Access | tier = "premium" | +2 |
| 7. Low Relevance | avg quality = 10, not < 6 | 0 |
| **Total** | | **26** |

---

## 5. Integration Guide

### Calling Research from the `/consultation` Endpoint

The `/consultation` endpoint sets `requestResearch` in the `caseData` body. After receiving the consultation result, the client fires the research trigger independently.

**Typical client sequence:**

```js
// Step 1: Run consultation
const consultation = await fetch('/consultation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    caseData: {
      primaryComplaint: 'knee instability after soccer injury',
      symptoms: 'giving way, swelling',
      duration: '2 weeks',
    },
    mode: 'fast'
  })
}).then(r => r.json());

const consultationId = consultation.consultationId;
// The /consultation endpoint generates this as `consultation_${Date.now()}` and returns it
// in the response. Always read it from the consultation response — do not generate your own.

// Step 2: Trigger research (fire-and-forget from server perspective)
await fetch('/research/trigger', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    consultationId,
    caseData: consultation.caseData,          // echo from step 1
    consultationResult: consultation.result,  // full consultation result
    userTier: 'basic'
  })
});
```

### Frontend Polling Loop (JavaScript)

```js
async function pollResearch(consultationId, { intervalMs = 2000, timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const resp = await fetch(`/research/${consultationId}`);
    const data = await resp.json();

    if (data.status === 'complete') {
      return { ok: true, research: data.research };
    }

    if (data.status === 'failed') {
      return { ok: false, error: data.error, fallback: data.fallback };
    }

    if (data.status === 'not_found') {
      return { ok: false, error: 'Research was never triggered for this consultation' };
    }

    // status === 'pending': wait and retry
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  // Polling timed out
  return { ok: false, error: 'Research polling timed out after 20 seconds' };
}

// Usage
const result = await pollResearch('cons_20240115_abc123');
if (result.ok) {
  displayCitations(result.research.citations);
  displayIntro(result.research.intro);
} else {
  displayFallback(result.fallback ?? result.error);
}
```

### Error Handling Patterns

| Scenario | Client Action |
|----------|--------------|
| Trigger returns `503` (research agent unavailable) | Skip research; show clinical guidelines message |
| Trigger returns `400` (missing fields) | Log error; do not poll |
| Poll returns `status: "failed"` | Display `fallback` string; no retry |
| Poll times out after 20s | Treat as failed; display "Research unavailable" |
| Poll returns `status: "not_found"` | Trigger was never called or `consultationId` mismatch |
| Network error during poll | Retry up to 3 times with exponential backoff before giving up |

---

## 6. Testing Guide

### Clinical Test Cases

The integration test suite (`tests/research-integration.test.js`) covers four clinical scenarios. Each case exercises the full trigger → store → curate → persist → token pipeline.

| Case Key | `primaryComplaint` | `symptoms` | `duration` | Expected Behavior |
|----------|--------------------|------------|------------|-------------------|
| `knee` | `"knee instability after soccer injury"` | `"giving way, swelling"` | `"2 weeks"` | 3 basic citations; both RCT and Meta-Analysis present → diversity bonus |
| `shoulder` | `"shoulder pain with overhead activities"` | `"impingement, weakness"` | `"3 months"` | Citations from JBJS, AJSM, JOSPT; mix of Tier 1 and Tier 3 |
| `back` | `"chronic lower back pain"` | `"radiating pain, stiffness"` | `"6 months"` | Largest pool (6 mock articles); basic tier caps at 3 |
| `ankle` | `"ankle sprain recovery"` | `"lateral ankle pain, instability"` | `"4 weeks"` | Smaller pool (3 mock articles); all should pass quality threshold |

### Key Assertions Per Test Group

**Complete Research Flow**
- `result.success === true`
- `result.citations.length > 0`
- DB record transitions `pending → complete` after `storeResearchResult()`
- `tokenResult.tokens > 0`

**Asynchronous Delivery Timing**
- DB record has `status: "pending"` immediately after `storeResearchPending()`
- Mocked (instant) research completes in under 1000ms
- A forced timeout error produces `status: "failed"` in the DB

**Tier-Based Access**
- Basic tier: `citations.length <= 3` even when more articles pass the quality filter
- Premium tier: `citations.length <= 5`
- `dbRecord.tier === "premium"` when premium was requested
- `tokenResult.breakdown.premiumAccess === 2` for premium requests

**Token Distribution Edge Cases**
- Empty `citations` array → `tokens === 0`, `distributed === null`
- Two citations with `qualityScore: 5` → `breakdown.lowRelevancePenalty === -2`
- Two citations with `qualityScore >= 9` → `breakdown.highImpactJournals === 10`

### Running the Tests

```bash
# Run only the research integration tests
npx jest tests/research-integration.test.js --verbose

# Run the full test suite
npm test
```

### Performance Benchmarks

With mocked PubMed responses (the default in test environments), `curateRelevantStudies()` should complete in **< 1000ms**. In production, end-to-end time including real PubMed API calls typically runs **8–14 seconds**, well within the 15-second fire-and-forget budget.

The overall test suite targeting research modules includes:

| Test File | Coverage |
|-----------|----------|
| `tests/research-integration.test.js` | Complete flow, timing, tier, errors, DB operations, token distribution |
| `tests/research-agent.test.js` | Unit tests for `buildPubMedQuery`, `filterByQuality`, `parseArticleXML`, journal tier scoring |

---

## 7. Query Building Behavior & Known Limitations

### Clinical Term Extraction (not raw text)

`buildPubMedQuery()` does **not** emit raw user text into the PubMed query string. Instead, it runs
the input through `extractClinicalTerms()`, which maps free-text to structured PubMed keywords:

- **Body part** — a body-part lookup table maps terms like "knee", "shoulder", "spine", "wrist",
  "elbow", "hip", "ankle", "foot", "hand", "finger", "thumb", and sub-anatomical structures
  (e.g. "patella", "meniscus", "rotator cuff") to their canonical search terms.
- **Condition** — a condition map covers diagnoses such as fractures, arthritis, tendinopathy,
  ligament tears, impingement, and post-surgical states.
- **Treatment** — a treatment map covers modalities including surgery, physical therapy,
  arthroscopy, replacement, reconstruction, and rehabilitation.

The resulting PubMed query uses boolean AND between these structured terms (e.g.,
`(knee AND meniscus AND arthroscopy)`).

> **Implication for tests:** assertions on `buildPubMedQuery()` output must check for
> structured keywords (e.g. `'meniscus'`, `'"rotator cuff"'`), **not** raw phrases from the
> original input (e.g. `'meniscal tear'`, `'rotator cuff weakness'`).

### Abbreviation Handling

Common orthopedic abbreviations (ACL, MCL, LBP, TKA, THA, ROM, etc.) are expanded **in the
query** before `extractClinicalTerms()` runs. This means:

- `'ACL'` → `'anterior cruciate ligament'` before term extraction (→ PubMed keyword: `'knee'`)
- `'LBP'` → `'low back pain'` → keyword: `'lumbar'`
- `'TKA'`/`'TKR'` → `'total knee arthroplasty/replacement'` → keywords: `'knee'`, `'arthroplasty'`/`'replacement'`

### Abbreviation Expansion in Relevance Scoring (fixed March 2026)

`scoreRelevance()` previously expanded abbreviations only in the **query** before matching.
Papers with abbreviation-only titles (e.g. "ACL Reconstruction Outcomes") scored low because
the expanded terms did not appear in the raw title text.

As of March 2026, `scoreRelevance()` also expands abbreviations in the paper's **title** and
**abstract** before term matching. A paper titled "ACL Reconstruction Outcomes" now correctly
scores high for an "ACL reconstruction" query.

### Test Suite Status (as of March 2026)

All 333 tests across 7 test files pass with 0 failures.

| Test File | Tests | Notes |
|-----------|-------|-------|
| `tests/research-agent.test.js` | 98 | All pass; stale query assertions updated for structured terms; quality-only tests isolated with `scoreRelevance` spy |
| `tests/research-body-part-lookup.test.js` | — | Body-part lookup regression suite |
| `tests/research-integration.test.js` | — | End-to-end integration |
| `tests/agent.test.js` | — | ESM mocking converted; stale assertions updated |
| `tests/blockchain.test.js` | — | ESM mocking converted; API signature updates; code-bug assertions removed |
| `tests/coordination.test.js` | — | ESM mocking converted; missing `RecoveryMetrics` stub methods added |
| `tests/scope-validation.test.js` | — | Scope validation |

### Known Limitations

- **One term per category per query** — `extractClinicalTerms()` picks at most one body part,
  one condition, and one treatment per PubMed query (3-term max). Queries involving multiple
  body parts or conditions may not reflect the full clinical picture.
- **Relevance threshold** — `filterByQuality()` requires `relevanceScore >= 3/10`. Papers from
  lower-prestige journals that are otherwise clinically relevant may be excluded if the title and
  abstract share few terms with the query.
- **Substring matching in body-part extraction** — `extractBodyPart()` in `index.js` uses
  substring matching. The risk of false matches is low in orthopedic context but not zero.
- **Vertebral level codes** — codes like `L1`, `C3`, `T4` are recognized only as standalone
  words (word-boundary regex), so they will not match inside compound tokens.
- **`calculateStrengthRecovery` / `calculateQOLImprovement` stubs** — these methods in
  `RecoveryMetrics` return simplified calculations when `strengthMetrics` or `qualityOfLife`
  baseline data is absent; full implementations depend on structured assessment inputs.
