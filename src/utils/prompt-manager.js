import logger from './logger.js';

class PromptManager {
  constructor() {
    this.modes = {
      FAST: 'fast',
      LEARNING: 'learning',
      COMPREHENSIVE: 'comprehensive'
    };
    
    this.stats = {
      fastModeUsage: 0,
      learningModeUsage: 0,
      avgTokensUsed: 0,
      totalPrompts: 0
    };
  }
  
  /**
   * Get optimized prompt based on mode and agent experience
   */
  getPrompt(agent, caseData, mode = 'fast') {
    const baseContext = this.extractKeyContext(caseData);
    
    switch (mode) {
      case this.modes.FAST:
        return this.getFastPrompt(agent, baseContext);
      case this.modes.LEARNING:
        return this.getLearningPrompt(agent, caseData);
      case this.modes.COMPREHENSIVE:
        return this.getComprehensivePrompt(agent, caseData);
      default:
        return this.getFastPrompt(agent, baseContext);
    }
  }
  
  /**
   * Fast mode prompt - optimized for speed (50-80 lines)
   */
  getFastPrompt(agent, context) {
    this.stats.fastModeUsage++;

    return {
      role: 'system',
      content: `You are ${agent.name}, ${agent.subspecialty || agent.specialization}.

CRITICAL: Provide immediate, actionable orthopedic guidance in PLAIN TEXT.

<patient_input>
Patient: ${context.demographics}
Primary Complaint: ${context.primaryComplaint}
Symptoms: ${context.symptoms}
Pain: ${context.painLevel}/10 at ${context.location}
Duration: ${context.duration}
</patient_input>

Provide a concise clinical assessment in plain text covering:
- Most likely diagnosis and differential diagnoses
- Immediate actions recommended
- Any red flags or urgent concerns
- Specialist referral if needed
- Follow-up timeline

Focus: Be concise, accurate, and actionable.
Scope: Orthopedic conditions only.
Safety: Conservative approach, highlight any urgent concerns.
Format: Plain text narrative, NOT JSON.`
    };
  }
  
  /**
   * Learning mode prompt - for background analysis
   */
  getLearningPrompt(agent, caseData) {
    this.stats.learningModeUsage++;
    
    return {
      role: 'system',
      content: `You are ${agent.name}, an evolving ${agent.subspecialty || agent.specialization} AI specialist.

LEARNING MODE - Deep Analysis Required

FULL CASE DATA:
<patient_input>
${JSON.stringify(this.sanitizeCaseData(caseData), null, 2)}
</patient_input>

AGENT EXPERIENCE: ${agent.experience} points
COLLABORATION NETWORK: ${agent.collaboratingAgents ? agent.collaboratingAgents.size : 0} specialists

COMPREHENSIVE ANALYSIS REQUIRED:
1. PATTERN RECOGNITION
   - Identify patterns across similar cases
   - Note any unusual presentations
   - Correlation with past cases

2. DIFFERENTIAL DIAGNOSIS
   - Complete differential with probabilities
   - Rare conditions consideration
   - Subspecialty-specific insights

3. TREATMENT INNOVATION
   - Standard treatment pathways
   - Novel approaches based on recent evidence
   - Combination therapies

4. MULTI-DISCIPLINARY INSIGHTS
   - How would other specialists approach this?
   - Collaboration opportunities
   - Holistic treatment planning

5. PREDICTIVE ANALYSIS
   - Expected recovery timeline
   - Potential complications
   - Success probability

6. LEARNING POINTS
   - What new insights emerged?
   - Knowledge gaps identified
   - Areas for future exploration

Provide comprehensive JSON response with all sections.
Temperature: Higher for exploration.
Goal: Discover novel insights and patterns.`
    };
  }
  
  /**
   * Comprehensive prompt - full analysis when needed
   */
  getComprehensivePrompt(agent, caseData) {
    return {
      role: 'system',
      content: agent.getSystemPrompt() + `

      Full case analysis required for:
<patient_input>
${JSON.stringify(caseData)}
</patient_input>`
    };
  }
  
  /**
   * Extract key context from case data
   */
  extractKeyContext(caseData) {
    return {
      demographics: `${caseData.age || 'Unknown'}yo ${caseData.gender || 'Unknown'}`,
      primaryComplaint: caseData.primaryComplaint || caseData.symptoms?.[0] || 'Unknown',
      symptoms: (caseData.symptoms || []).slice(0, 3).join(', '),
      painLevel: caseData.painLevel || 'Not specified',
      location: caseData.location || caseData.bodyPart || 'Not specified',
      duration: caseData.duration || 'Not specified',
      urgency: caseData.urgency || 'routine'
    };
  }
  
  /**
   * Optimize prompt for specific agent type - Returns STRING content only
   */
  getSpecialistPrompt(agentType, caseData, mode = 'fast') {
    const prompts = {
      triage: this.getTriagePrompt(caseData, mode),
      painWhisperer: this.getPainPrompt(caseData, mode),
      movementDetective: this.getMovementPrompt(caseData, mode),
      strengthSage: this.getStrengthPrompt(caseData, mode),
      mindMender: this.getMindPrompt(caseData, mode)
    };
    
    const prompt = prompts[agentType] || this.getFastPrompt({ name: agentType }, this.extractKeyContext(caseData));
    
    // Always return string content for BaseAgent compatibility
    if (typeof prompt === 'object' && prompt.content) {
      return prompt.content;
    } else if (typeof prompt === 'string') {
      return prompt;
    } else {
      return JSON.stringify(prompt);
    }
  }
  
  /**
   * Specialized prompts for each agent type
   */
  getTriagePrompt(caseData, mode) {
    const context = this.extractKeyContext(caseData);

    if (mode === 'fast') {
      return `Triage Assessment Required

<patient_input>
Patient: ${context.demographics}
Chief Complaint: ${context.primaryComplaint}
Urgency Indicators: ${context.symptoms}
</patient_input>

Provide a brief triage assessment in plain text covering:
- Urgency level (emergent, urgent, semi-urgent, or routine)
- Which specialists should evaluate this case
- Immediate actions to take
- Any red flags or warning signs to watch for

Format: Plain text narrative, NOT JSON.`;
    }

    // Learning mode includes full triage protocol
    return this.getLearningPrompt({ name: 'Triage', subspecialty: 'Emergency Triage' }, caseData);
  }
  
  getPainPrompt(caseData, mode) {
    const context = this.extractKeyContext(caseData);

    if (mode === 'fast') {
      return `Pain Assessment

<patient_input>
Location: ${context.location}
Intensity: ${context.painLevel}/10
Duration: ${context.duration}
</patient_input>

Provide a concise pain assessment in plain text covering:
- Pain type and classification
- Likely pain mechanisms
- Immediate, short-term, and long-term interventions
- Medication recommendations if appropriate

Format: Plain text narrative, NOT JSON.`;
    }

    return this.getLearningPrompt({ name: 'Pain Whisperer', subspecialty: 'Pain Management' }, caseData);
  }
  
  getMovementPrompt(caseData, mode) {
    if (mode === 'fast') {
      return `Movement Analysis

<patient_input>
Symptoms: ${caseData.movementSymptoms || caseData.symptoms}
Functional Limitations: ${caseData.limitations || 'Not specified'}
</patient_input>

Provide a brief movement assessment in plain text covering:
- Movement dysfunction classification
- Key biomechanical factors
- Corrective exercises recommended
- Progression plan overview

Format: Plain text narrative, NOT JSON.`;
    }

    return this.getLearningPrompt({ name: 'Movement Detective', subspecialty: 'Biomechanics' }, caseData);
  }
  
  getStrengthPrompt(caseData, mode) {
    if (mode === 'fast') {
      return `Functional Capacity Assessment

<patient_input>
Current Function: ${caseData.functionalLevel || 'Not assessed'}
Goals: ${caseData.goals || 'Return to activity'}
</patient_input>

Provide a concise functional assessment in plain text covering:
- Functional deficits identified
- Strength program phases (acute, recovery, return-to-activity)
- Progression criteria
- Return to activity timeline

Format: Plain text narrative, NOT JSON.`;
    }

    return this.getLearningPrompt({ name: 'Strength Sage', subspecialty: 'Rehabilitation' }, caseData);
  }
  
  getMindPrompt(caseData, mode) {
    if (mode === 'fast') {
      return `Psychological Assessment

<patient_input>
Pain Impact: ${caseData.painImpact || 'Not assessed'}
Mood: ${caseData.mood || 'Not assessed'}
</patient_input>

Provide a brief psychological assessment in plain text covering:
- Psychological factors affecting recovery
- Recommended coping strategies
- Behavioral interventions
- Whether specialist referral is needed

Format: Plain text narrative, NOT JSON.`;
    }

    return this.getLearningPrompt({ name: 'Mind Mender', subspecialty: 'Psychology' }, caseData);
  }
  
  /**
   * Determine if learning mode should run
   */
  shouldRunLearningMode(caseData, fastResponse, agent) {
    // Run learning mode for valuable cases
    if (caseData.complexity > 7) return true;
    if (fastResponse.confidence < 0.7) return true;
    if (agent.experience < 100) return true;
    if (caseData.novel || caseData.unusual) return true;
    if (Math.random() < 0.1) return true; // 10% random sampling
    
    return false;
  }
  
  /**
   * Remove sensitive data from prompts
   */
  sanitizeCaseData(caseData) {
    const sanitized = { ...caseData };
    delete sanitized.patientId;
    delete sanitized.personalInfo;
    delete sanitized.insurance;
    delete sanitized.ssn;
    return sanitized;
  }
  
  /**
   * Get prompt statistics
   */
  getStats() {
    return {
      ...this.stats,
      fastModePercentage: (this.stats.fastModeUsage / this.stats.totalPrompts * 100).toFixed(2) + '%',
      learningModePercentage: (this.stats.learningModeUsage / this.stats.totalPrompts * 100).toFixed(2) + '%'
    };
  }
}

// Singleton instance
const promptManager = new PromptManager();

export default promptManager;