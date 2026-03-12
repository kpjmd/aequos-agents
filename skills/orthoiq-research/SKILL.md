---
name: orthoiq-research
description: Clinical research synthesis skill for OrthoIQ. Fetches and critically appraises musculoskeletal and sports medicine literature from PubMed, applies evidence grading, and returns clinically contextualized citations. Use when a user submits an orthopedic or sports medicine question requiring literature support, when the research agent is invoked, or when asked to "find evidence", "what does the research say", "are there studies on", or "cite literature" for any MSK/ortho topic.
metadata:
  author: OrthoIQ
  version: 1.0.0
  mcp-server: orthoiq-mcp
  category: healthcare
  tags: [orthopedics, sports-medicine, research, pubmed, evidence-based]
---

# OrthoIQ Research Agent Skill

This skill governs how the OrthoIQ research agent fetches, filters, appraises, and presents musculoskeletal literature. Raw PubMed access is the tool. This skill provides the clinical expertise to use it well.

**CRITICAL**: Never return a flat citation list. Every research response must be clinically contextualized, evidence-graded, and patient-profile-aware. A citation that is technically relevant but population-mismatched is actively misleading in a clinical context.

---

## Step 1: Parse the Clinical Question Before Searching

Before calling the PubMed API, decompose the user's question into structured components:

- **Population**: Age range, sex if relevant, activity level (recreational / competitive / occupational), comorbidities mentioned
- **Condition**: Specific diagnosis or symptom complex (be precise — "knee pain" vs "medial compartment OA" vs "patellofemoral syndrome" produce different searches)
- **Intervention or exposure**: Treatment, surgical technique, exercise protocol, device, or risk factor in question
- **Outcome**: What the user actually wants to know — pain, function, return to sport, surgical rates, imaging findings, complication rates

Construct PubMed queries using MeSH terms where possible. Run 2-3 targeted queries rather than one broad query. Prefer specificity over recall.

---

## Step 2: Filter by Study Design Hierarchy

Apply this evidence hierarchy in order. Return the highest available evidence level. Only descend to lower levels if higher-quality evidence is absent or insufficient.

| Level | Study Type | Use When |
|-------|-----------|----------|
| 1 | Systematic review / Meta-analysis | Available and population-matched |
| 2 | RCT | No SR available; or SR is outdated >5 years |
| 3 | Prospective cohort | No RCT; or RCT is underpowered |
| 4 | Retrospective cohort / Registry data | Rare conditions or long-term outcomes only |
| 5 | Case series / Expert opinion | Emerging techniques, no higher evidence exists |

**Do not mix levels without flagging it.** If you return a Level 1 and Level 4 together, explicitly note why the lower-level evidence was included.

---

## Step 3: Apply Population Relevance Filters

This is where most generic research tools fail. Apply these filters before surfacing citations:

**Age matching**
- Pediatric (<18): Growth plate considerations apply. Adult studies are NOT applicable.
- Young adult (18-35): High-demand athlete studies are often appropriate.
- Middle-aged (35-55): Distinguish between degenerative vs. acute/traumatic pathology. Studies of elite collegiate athletes have limited applicability.
- Older adult (55+): Comorbidity burden, bone quality, and recovery timeline differ substantially. Flag if a study excluded patients >65.

**Activity level matching**
- Recreational vs. competitive vs. elite athletes have meaningfully different outcome expectations and intervention thresholds. Flag mismatches.

**Surgical vs. conservative question**
- If the user asked about conservative management and the dominant evidence base is surgical, flag this explicitly:
  > "Note: The majority of high-quality evidence for this condition is surgical. Conservative management evidence is limited to [X]."

**Laterality / anatomical specificity**
- ACL vs. PCL, medial vs. lateral meniscus, rotator cuff vs. labrum — confirm the study matches the specific structure in the question.

---

## Step 4: Assign Evidence Grades

For each citation returned, assign a grade using the OrthoIQ Evidence Grade system:

**Grade A** — High quality, directly applicable
- Level 1-2 evidence, population-matched, outcome-matched, published within 10 years

**Grade B** — Moderate quality or indirect applicability
- Level 3 evidence, OR Level 1-2 with population mismatch, OR older than 10 years but no more recent evidence exists

**Grade C** — Low quality or limited applicability
- Level 4-5 evidence, OR significant population mismatch, OR contradicted by more recent research (include note)

**Grade X** — Flagged for conflict or concern
- Study contradicts current AAOS/AOSSM/APTA guidelines
- Industry-funded study with potential bias
- Retracted or under investigation

Always show the grade prominently with each citation.

---

## Step 5: Cross-Reference with Clinical Guidelines

Before finalizing the response, check citations against known guideline positions:

- **AAOS Clinical Practice Guidelines** — for surgical indications, implant selection, rehabilitation timelines
- **AOSSM Position Statements** — for return-to-sport criteria, concussion, overuse injuries
- **APTA Clinical Practice Guidelines** — for conservative management and physical therapy protocols
- **NICE / Cochrane** — for systematic reviews on common MSK conditions

If a citation **supports** current guidelines → note alignment.
If a citation **contradicts** current guidelines → flag as Grade X and explain the discrepancy.
If guidelines are **silent** on the specific question → note this as a gap.

See `references/guideline-sources.md` for current guideline URLs and update cadences.

---

## Step 6: Structure the Research Response

Every research response must follow this format:

```
## Research Summary: [Condition / Question]

**Clinical Question**: [Restated PICO format]
**Evidence Base**: [X studies found; highest level: Level N]

---

### Key Findings

[2-4 sentences synthesizing what the literature says in plain clinical language.
Lead with the most actionable finding. Do not just list abstracts.]

---

### Citations

**[Grade A]** [Author et al., Year] — [Journal]
*[One sentence: what they studied, what they found, why it's relevant to this question]*
PubMed ID: XXXXXXXX

**[Grade B]** [Author et al., Year] — [Journal]
*[One sentence summary + note on why grade is B]*
PubMed ID: XXXXXXXX

---

### Evidence Gaps & Caveats

- [Any population mismatches in the available literature]
- [Guideline alignment or conflict]
- [Areas where evidence is weak or absent]
- [Recommendation for clinical judgment override if evidence is insufficient]

---

### Suggested Follow-Up Searches

[1-2 related queries the user may want to run for adjacent evidence]
```

---

## Special Handling: Emerging & Controversial Topics

For topics where the evidence base is rapidly evolving or actively contested:

**Biologics (PRP, stem cells, exosomes)**
- Always note FDA regulatory status alongside citations
- Distinguish in vitro / animal studies from human clinical trials
- PRP evidence is highly protocol-dependent — note concentration and activation method when reported

**Return-to-sport timelines**
- Time-based criteria alone are insufficient — always cross-reference with functional criteria from the literature
- Note when a study's RTS criteria are purely time-based (lower applicability)

**Emerging surgical techniques**
- Flag if a technique has <5 years of follow-up data
- Note learning curve effects if reported

See `references/emerging-topics.md` for current high-volatility topics.

---

## What This Skill Does NOT Do

- Does not provide diagnosis or replace clinical judgment
- Does not access full-text PDFs (abstracts and metadata only via PubMed API)
- Does not search grey literature, conference abstracts, or preprints unless explicitly requested
- Does not generate citations — all PMIDs must be verified via actual API call

---

## Error Handling

**PubMed API returns no results**
→ Broaden MeSH terms, try synonym terms, report that evidence is limited or absent for this specific question

**Query returns >50 results**
→ Apply hierarchy filter first, then population filter — do not surface more than 6-8 citations in a single response

**Conflicting high-quality studies**
→ Present both, note the conflict, suggest the discrepancy may reflect patient selection differences or outcome measure differences — do not adjudicate

**Question outside MSK/sports medicine scope**
→ Note scope boundary, do not attempt to apply MSK evidence grading to other specialties
