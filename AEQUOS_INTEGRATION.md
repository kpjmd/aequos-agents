# AequOs Platform Integration Guide

## Overview
This guide details the enhanced `/consultation` endpoint with smart triage-first routing for the AequOs platform. The system now intelligently routes questions to relevant specialists based on data completeness, improving performance and user experience.

## Key Enhancements

### 1. Smart Triage-First Routing
- All consultations now go through triage agent first for data assessment
- Automatic specialist selection based on available data
- Graceful degradation for incomplete data
- Confidence scoring for quality assurance

### 2. Enhanced Response Structure

The `/consultation` endpoint now returns additional metadata:

```javascript
{
  success: true,
  consultation: {
    // Existing fields
    consultationId: "consultation_xxx",
    synthesizedRecommendations: {...},
    participatingSpecialists: ["triage", "pain_whisperer", ...],
    responses: [...],
    
    // NEW FIELDS
    dataCompleteness: 0.65,           // 0-1 score indicating data quality
    suggestedFollowUp: [              // Questions to improve response
      "On a scale of 1-10, how would you rate your pain?",
      "How long have you been experiencing these symptoms?"
    ],
    triageConfidence: 0.85,           // Triage agent's routing confidence
    specialistCoverage: {             // Which specialists participated
      "triage": true,
      "pain_whisperer": true,
      "movement_detective": false,
      "strength_sage": true,
      "mind_mender": false            // Skipped due to missing psychData
    }
  },
  fromCache: false,
  mode: "fast",
  responseTime: 4500,
  timestamp: "2025-09-28T..."
}
```

## Request Format

### Minimum Required Data Structure

```javascript
POST /consultation
{
  caseData: {
    // REQUIRED MINIMUM
    symptoms: "knee pain when walking",  // Required: Main symptom description
    primaryComplaint: "knee pain",        // Required: Chief complaint
    
    // HIGHLY RECOMMENDED (improves quality)
    painLevel: 7,                         // 1-10 scale if pain present
    duration: "chronic",                  // acute/chronic/sub-acute
    age: 42,                              // Patient age
    location: "right knee",               // Specific body location
    
    // SPECIALIST-SPECIFIC DATA (include if available)
    painData: {                          // For Pain Whisperer
      location: "right knee",
      quality: "sharp",                  // sharp/dull/burning/throbbing
      triggers: ["walking", "stairs"],
      relievers: ["rest", "ice"]
    },
    movementData: {                      // For Movement Detective
      restrictions: ["bending"],
      gaitProblems: true,
      patterns: ["antalgic gait"]
    },
    functionalData: {                    // For Strength Sage
      limitations: ["climbing stairs"],
      goals: ["return to walking"],
      strengthDeficits: true
    },
    psychData: {                        // For Mind Mender
      anxietyLevel: 6,                  // 1-10 scale
      fearAvoidance: true,
      copingStrategies: ["meditation"]
    }
  },
  requiredSpecialists: [],              // Optional: Leave empty for smart routing
  mode: "fast"                          // "fast" or "normal"
}
```

## Data Completeness Levels

### Level 1: Minimal (0-30% completeness)
- Only symptoms and primaryComplaint
- Triage-only response
- High number of follow-up questions

### Level 2: Basic (30-60% completeness)
- Core data present (pain, duration, location)
- 2-3 specialists activated
- Some follow-up questions

### Level 3: Good (60-80% completeness)
- Most core data + some specialist data
- 3-4 specialists activated
- Few follow-up questions

### Level 4: Complete (80-100% completeness)
- All relevant data fields
- All applicable specialists activated
- No follow-up questions needed

## Feedback Integration

### Feedback Endpoint

```javascript
POST /feedback
{
  consultationId: "consultation_xxx",
  patientId: "patient_xxx",           // Optional
  feedback: {
    userSatisfaction: 9,              // 1-10 scale
    outcomeSuccess: true,              // Did recommendations help?
    
    mdReview: {                       // MD review data
      approved: true,
      corrections: [],                 // Array of correction notes
      additionalNotes: "Good assessment",
      specialistAccuracy: {            // Per-specialist accuracy (0-1)
        "pain": 0.9,
        "movement": 0.85,
        "strength": 0.88
      }
    },
    
    followUpDataProvided: {           // Answers to follow-up questions
      "painDescription": "sharp, intermittent",
      "triggerMovements": "climbing stairs"
    }
  }
}
```

### Feedback Response

```javascript
{
  success: true,
  message: "Feedback processed successfully",
  feedbackId: "feedback_xxx",
  tokenRewards: [                     // If applicable
    {
      agent: "Pain Whisperer",
      reward: 31,
      accuracy: 0.9
    }
  ],
  timestamp: "2025-09-28T..."
}
```

## UI Integration Recommendations

### 1. Display Data Completeness
Show a progress bar or percentage indicator:
- 0-30%: Red - "Limited data, basic assessment only"
- 30-60%: Yellow - "Partial data, some specialists unavailable"
- 60-80%: Light Green - "Good data, comprehensive assessment"
- 80-100%: Green - "Complete data, full specialist consultation"

### 2. Specialist Coverage Indicator
Show which specialists contributed:
- ✓ Triage Coordinator
- ✓ Pain Specialist
- ✗ Movement Analyst (insufficient data)
- ✓ Strength Expert
- ✗ Mind-Body Specialist (no psychological data)

### 3. Follow-up Questions Section
If `suggestedFollowUp` array is not empty:
```html
<div class="follow-up-questions">
  <h4>For Better Results, Please Answer:</h4>
  <ul>
    <li>On a scale of 1-10, how would you rate your pain?</li>
    <li>How long have you been experiencing these symptoms?</li>
  </ul>
  <button>Answer Questions</button>
</div>
```

### 4. Confidence Score Display
Show overall consultation confidence:
- High (>80%): "High confidence assessment"
- Medium (50-80%): "Moderate confidence - consider providing more details"
- Low (<50%): "Limited confidence - additional information recommended"

## Error Handling

### Partial Success
Some specialists may not respond:
```javascript
if (consultation.specialistCoverage.mind_mender === false) {
  // Show notice that psychological assessment unavailable
}
```

### Timeout Handling
Fast mode has 50-second timeout:
```javascript
if (error.status === 504) {
  // Handle timeout - suggest retry or fallback to Claude AI
}
```

### Service Unavailable
```javascript
try {
  const health = await fetch('/health');
  if (!health.ok) throw new Error('Service down');
  // Proceed with consultation
} catch (error) {
  // Fallback to Claude AI
  useFallbackClaudeAI();
}
```

## Performance Optimization

### Caching
- Responses are cached for identical questions
- Cache hit returns instantly
- Similar questions return adapted cached responses

### Fast Mode (Default)
- 50-second timeout
- Returns when minimum specialists respond
- Best for real-time interactions

### Normal Mode
- 60-second timeout
- Waits for all specialists
- Best for comprehensive assessments

## Migration Checklist for AequOs Platform

1. **Parse New Response Fields**
   - [ ] Handle `dataCompleteness` score
   - [ ] Display `suggestedFollowUp` questions
   - [ ] Show `specialistCoverage` status
   - [ ] Use `triageConfidence` for quality indicator

2. **Update UI Components**
   - [ ] Add data completeness indicator
   - [ ] Show specialist participation badges
   - [ ] Create follow-up question UI
   - [ ] Add confidence score display

3. **Implement Feedback Flow**
   - [ ] Capture user satisfaction rating
   - [ ] Collect MD review data
   - [ ] Send feedback to `/feedback` endpoint
   - [ ] Handle token reward responses

4. **Ensure Data Structure**
   - [ ] Always send `symptoms` and `primaryComplaint`
   - [ ] Include available optional fields
   - [ ] Map user input to specialist data structures
   - [ ] Validate data before sending

5. **Error Handling**
   - [ ] Handle partial specialist responses
   - [ ] Implement timeout retry logic
   - [ ] Add health check before consultations
   - [ ] Configure Claude AI fallback

6. **Testing**
   - [ ] Test with minimal data
   - [ ] Test with complete data
   - [ ] Test timeout scenarios
   - [ ] Test feedback submission
   - [ ] Verify fallback behavior

## Example Integration Code

```javascript
// AequOs Platform Integration Example

async function consultAequOsAgents(userQuestion, additionalData = {}) {
  // Parse user question to extract basic data
  const caseData = {
    symptoms: userQuestion,
    primaryComplaint: extractChiefComplaint(userQuestion),
    ...additionalData
  };
  
  try {
    // Check service health
    const health = await fetch(`${AEQUOS_AGENTS_URL}/health`);
    if (!health.ok) throw new Error('Service unavailable');
    
    // Make consultation request
    const response = await fetch(`${AEQUOS_AGENTS_URL}/consultation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseData, mode: 'fast' })
    });
    
    if (!response.ok) {
      if (response.status === 504) {
        // Timeout - could retry or fallback
        return fallbackToClaudeAI(userQuestion);
      }
      throw new Error('Consultation failed');
    }
    
    const result = await response.json();
    
    // Update UI with new metadata
    updateDataCompletenessIndicator(result.consultation.dataCompleteness);
    displaySpecialistCoverage(result.consultation.specialistCoverage);
    
    // Show follow-up questions if any
    if (result.consultation.suggestedFollowUp?.length > 0) {
      showFollowUpQuestions(result.consultation.suggestedFollowUp);
    }
    
    return result.consultation;
    
  } catch (error) {
    console.error('AequOs Agents error:', error);
    // Fallback to Claude AI
    return fallbackToClaudeAI(userQuestion);
  }
}

// Send feedback after MD review
async function sendFeedback(consultationId, satisfaction, mdReview) {
  const feedback = {
    consultationId,
    feedback: {
      userSatisfaction: satisfaction,
      outcomeSuccess: mdReview.approved,
      mdReview: {
        approved: mdReview.approved,
        corrections: mdReview.corrections || [],
        specialistAccuracy: mdReview.accuracy || {}
      }
    }
  };
  
  try {
    await fetch(`${AEQUOS_AGENTS_URL}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback)
    });
  } catch (error) {
    console.error('Feedback submission failed:', error);
  }
}
```

## Support & Troubleshooting

### Common Issues

1. **All consultations returning triage-only**
   - Check if `primaryComplaint` is being sent
   - Verify data structure matches expected format
   - Ensure specialist-specific data uses correct field names

2. **Timeouts occurring frequently**
   - Use `mode: "fast"` for better performance
   - Consider implementing retry logic
   - Check network latency

3. **Missing specialist coverage**
   - Verify specialist data fields are populated
   - Check `dataCompleteness` score
   - Review `suggestedFollowUp` for missing data

4. **Feedback not processing**
   - Ensure `consultationId` matches original consultation
   - Verify `specialistAccuracy` uses correct specialist names
   - Check token reward responses for errors

## Version History

- **v2.0.0** - Smart triage routing, data completeness scoring, feedback integration
- **v1.0.0** - Initial multi-agent consultation system

## Contact

For issues or questions about the integration, please refer to the main project documentation or contact the development team.