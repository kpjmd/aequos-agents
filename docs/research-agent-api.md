# Research Agent API Reference

## Table of Contents

1. [Overview](#1-overview)
2. [Endpoints](#2-endpoints)
   - [POST /research/trigger](#post-researchtrigger)
   - [GET /research/:consultationId](#get-researchconsultationid)
3. [Research Result Schema](#3-research-result-schema)
4. [Token Economics](#4-token-economics)
5. [Integration Guide](#5-integration-guide)
6. [Testing Guide](#6-testing-guide)

---

## 1. Overview

The Research Agent subsystem enriches orthopedic consultations with curated, evidence-based literature sourced from PubMed. It operates as a **fire-and-forget** service: the trigger endpoint returns immediately with a `pending` status while literature retrieval and curation run asynchronously in the background (up to 15 seconds). Callers poll a separate status endpoint until research is complete.

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

| Tier | Max Citations Returned | Token Bonus |
|------|----------------------|-------------|
| `basic` (default) | 3 | — |
| `premium` | 5 | +2 (`PREMIUM_ACCESS`) |

All citations pass a minimum quality score threshold of **6/10** before being returned. Results are sorted descending by quality score, then by relevance score.

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
| `triage` | `consultationResult.triage` | Triage context injected into the enriched query |
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
    "triage": { "urgency": "moderate", "recommendedSpecialists": ["movement", "strength"] },
    "responses": { "movement": "Assess for ligamentous laxity..." }
  }
}
```

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
| `research.intro` | `string` | 2-3 paragraph patient-friendly summary generated by Claude |
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

const consultationId = consultation.consultationId; // or generate a UUID

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
