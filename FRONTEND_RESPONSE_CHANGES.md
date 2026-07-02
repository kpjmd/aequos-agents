# Frontend Response Format Changes

## Overview
All AequOs Agents now return user-friendly, markdown-formatted text in the `response` field, ready for direct display to users/patients.

## What Changed

### Before
```javascript
{
  response: "[Raw LLM output with structured prompts and sections]",
  assessment: { ... },
  recommendations: [ ... ],
  // ... other structured fields
}
```

### After
```javascript
{
  response: "# Pain Whisperer Assessment\n\n## Summary\n\n- Pain level: 7/10...",
  rawResponse: "[Raw LLM output - for internal use only]",
  assessment: { ... },
  recommendations: [ ... ],
  // ... all structured fields preserved
}
```

## Response Structure

### Individual Agent Responses

All specialist agents (TriageAgent, PainWhispererAgent, MovementDetectiveAgent, StrengthSageAgent, MindMenderAgent) now return:

```typescript
{
  // USER-FACING FIELD - Display this to patients
  response: string,  // Markdown-formatted, user-friendly text

  // INTERNAL FIELDS - For processing and coordination
  rawResponse: string,  // Original LLM output
  specialist: string,
  specialistType: string,
  assessment: {
    primaryFindings: string[],
    confidence: number,
    dataQuality: number,
    clinicalImportance: string
  },
  recommendations: Array<{
    intervention: string,
    priority: number,
    evidenceGrade: string,
    contraindications: string[],
    timeline: string,
    expectedOutcome: string
  }>,
  keyFindings: Array<{
    finding: string,
    confidence: number,
    clinicalRelevance: string,
    requiresMDReview: boolean
  }>,
  questionsForAgents: Array<{
    targetAgent: string,
    question: string,
    priority: string
  }>,
  followUpQuestions: string[],

  // Metadata
  confidence: number,
  responseTime: number,
  timestamp: string,
  status: string,

  // Agent-specific fields
  urgencyLevel?: string,  // Triage
  painScore?: number,  // Pain Whisperer
  functionalLevel?: number,  // Strength Sage
  riskLevel?: string,  // All agents
  // ... etc
}
```

### Coordinator Synthesis Response

The `coordinateMultiSpecialistConsultation()` response now includes:

```typescript
{
  synthesizedRecommendations: {
    // USER-FACING FIELD - Display this to patients
    synthesis: string,  // Markdown-formatted collaborative care plan

    // INTERNAL FIELDS
    rawSynthesis: string,  // Original synthesis output
    coordinationMetadata: {
      interAgentDialogue: [ ... ],
      disagreements: [ ... ],
      emergentFindings: [ ... ]
    },
    treatmentPlan: {
      phase1: { ... },
      phase2: { ... },
      phase3: { ... }
    },
    confidenceFactors: {
      dataCompleteness: number,
      interAgentAgreement: number,
      evidenceQuality: number,
      overallConfidence: number
    },
    clinicalFlags: {
      redFlags: [ ... ],
      requiresImmediateMD: boolean,
      urgencyLevel: string
    },
    prescriptionData: { ... },
    suggestedFollowUp: [ ... ],
    feedbackPrompts: { ... }
  },
  responses: [ ... ],  // Individual agent responses
  // ... other fields
}
```

## Markdown Format

The `response` field contains markdown with the following structure:

### Individual Agent Response
```markdown
# [Specialist Name] Assessment

## Summary

- Finding 1
- Finding 2
- Finding 3

**Urgency Level:** ⚠️ Semi-urgent
**Pain Level:** 7/10

## Key Clinical Findings

🔴 **Critical finding** *(Requires physician review)*
   - Confidence: 85%

🟡 **Important finding**
   - Confidence: 75%

## Recommended Treatment Plan

### 1. Intervention Name

- **Timeline:** Immediate
- **Evidence Level:** Grade A
- **Expected Outcome:** 30-50% pain reduction in 2-4 weeks

### 2. Second Intervention

- **Timeline:** Week 2-4
- **Evidence Level:** Grade B
- **Expected Outcome:** Improved function

## Questions to Help Refine Your Care

- What activities specifically trigger or worsen your pain?
- How does the pain affect your sleep quality?

---

*Assessment Confidence: 75%*
*Data Quality: 90%*
```

### Coordinator Synthesis Response
```markdown
# Multi-Specialist Care Plan

## Collaborative Assessment Summary

Your care team of 2 specialists has completed a comprehensive evaluation...

### ⚠️ Important Alerts

🚨 **Critical finding requiring attention**
   - *Please consult with a physician as soon as possible.*
   - Identified by: Pain Whisperer

## Specialist Insights

### 1. Pain Whisperer

**Key Finding:** Pain level: 7/10
**Top Recommendation:** Multimodal pain management approach

### 2. Movement Detective

**Key Finding:** Movement dysfunction detected
**Top Recommendation:** Movement pattern correction exercises

## Your Recovery Journey

### Phase 1: Acute Phase (0-2 weeks)

**Goals:**
- Pain control and symptom management
- Protect healing tissues
- Patient education

**Key Interventions:**
- Multimodal pain management (Daily)
- Rest and protection (As needed)

### Phase 2: Recovery Phase (2-6 weeks)

**Goals:**
- Restore mobility and flexibility
- Begin strength building

### Phase 3: Return to Activity Phase (6+ weeks)

**Goals:**
- Full functional restoration
- Return to sports/recreation

---

### Assessment Confidence Metrics

- **Overall Confidence:** 75%
- **Data Completeness:** 85%
- **Team Agreement:** 90%
- **Evidence Quality:** Grade B

---

*This collaborative assessment was prepared by your AequOs care team.*
```

## Frontend Implementation Guide

### 1. Simple Display (Recommended)
```javascript
// Just render the markdown response directly
const agentResponse = await fetch('/api/consultation', ...);
const markdown = agentResponse.response;

// Use a markdown renderer like react-markdown
<ReactMarkdown>{markdown}</ReactMarkdown>
```

### 2. Access Structured Data
```javascript
// All structured fields remain accessible
const painScore = agentResponse.painScore;  // 7
const recommendations = agentResponse.recommendations;  // Array
const urgency = agentResponse.urgencyLevel;  // "semi-urgent"

// Use for badges, metrics, analytics, etc.
```

### 3. Advanced: Combine Both
```javascript
// Display markdown for user
<ReactMarkdown>{agentResponse.response}</ReactMarkdown>

// Show structured data in UI components
<UrgencyBadge level={agentResponse.urgencyLevel} />
<ConfidenceScore value={agentResponse.confidence} />
<RecommendationsList items={agentResponse.recommendations} />
```

## Migration Checklist

- [ ] Update API response handlers to expect markdown in `response` field
- [ ] Add markdown rendering library (e.g., `react-markdown`, `marked`, `remark`)
- [ ] Update components to render `response` as markdown
- [ ] Optionally: Add custom markdown styling for medical content
- [ ] Update tests to expect markdown format
- [ ] Remove any parsing logic that expected structured text in `response`
- [ ] Update documentation/comments referencing response format

## Benefits

✅ **Ready to display** - No parsing or formatting needed on frontend
✅ **Consistent formatting** - All agents use same markdown structure
✅ **Professional appearance** - Headings, bullets, emphasis, emojis
✅ **Structured data preserved** - All fields still available for processing
✅ **Separation of concerns** - UI text vs. internal data clearly separated

## Notes

- The `rawResponse` field contains the original LLM output for debugging/logging
- All structured fields (assessment, recommendations, etc.) are unchanged
- Markdown uses GitHub Flavored Markdown (GFM) syntax
- Emojis are used for visual indicators (🚨 urgent, ⚠️ warning, etc.)
- Clinical flags marked with "*(Requires physician review)*" when applicable

## Questions?

Contact the AequOs backend team or refer to the agent source code:
- `src/agents/base-agent.js` - `formatUserFriendlyResponse()` method
- `src/utils/agent-coordinator.js` - `formatSynthesisResponse()` method
