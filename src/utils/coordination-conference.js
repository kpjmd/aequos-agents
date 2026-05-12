import logger from './logger.js';

/**
 * CoordinationConference - Manages inter-agent dialogue and collaboration
 * Implements Task 1.3: Agent Coordination Conference
 */
export class CoordinationConference {
  constructor() {
    this.dialogueHistory = [];
  }

  /**
   * Conduct a full coordination conference round
   * @param {Map} initialResponses - Initial agent responses with questionsForAgents
   * @param {Map} specialists - Map of available specialist agents
   * @param {Object} caseData - Original case data for context
   * @returns {Object} Coordination metadata with dialogue, disagreements, emergent findings
   */
  async conductConferenceRound(initialResponses, specialists, caseData) {
    try {
      logger.info('Running cross-specialist synthesis round');
      const startTime = Date.now();

      // Step 1: Collect all inter-agent questions
      const interAgentQuestions = this.collectInterAgentQuestions(initialResponses);
      logger.info(`Extracted ${interAgentQuestions.length} cross-specialist synthesis prompts`);

      // Step 2: Route questions to target agents and collect responses
      const dialogue = await this.routeQuestionsToAgents(
        interAgentQuestions,
        specialists,
        initialResponses,
        caseData
      );
      logger.info(`Completed ${dialogue.length} specialist follow-up responses`);

      // Step 3: Detect disagreements between agents
      const disagreements = this.detectDisagreements(initialResponses, dialogue);
      logger.info(`Found ${disagreements.length} recommendation divergences`);

      // Step 4: Track emergent findings from coordination
      const emergentFindings = this.trackEmergentFindings(dialogue, initialResponses, disagreements);
      logger.info(`Flagged ${emergentFindings.length} high-priority cross-specialist findings`);

      const coordinationMetadata = {
        interAgentDialogue: dialogue,
        disagreements: disagreements,
        emergentFindings: emergentFindings,
        coordinationDuration: Date.now() - startTime,
        participatingAgents: Array.from(initialResponses.keys()),
        timestamp: new Date().toISOString()
      };

      // Store in history
      this.dialogueHistory.push(coordinationMetadata);

      return coordinationMetadata;
    } catch (error) {
      logger.error(`Error in coordination conference: ${error.message}`);
      return {
        interAgentDialogue: [],
        disagreements: [],
        emergentFindings: [],
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Collect all inter-agent questions from initial responses
   * @param {Map} responses - Agent responses
   * @returns {Array} Array of questions with routing info
   */
  collectInterAgentQuestions(responses) {
    const questions = [];

    for (const [agentType, response] of responses.entries()) {
      if (response.status !== 'success' || !response.response) {
        continue;
      }

      const agentResponse = response.response;

      // Extract questionsForAgents array
      if (agentResponse.questionsForAgents && Array.isArray(agentResponse.questionsForAgents)) {
        for (const questionObj of agentResponse.questionsForAgents) {
          questions.push({
            fromAgent: agentType,
            toAgent: questionObj.targetAgent,
            question: questionObj.question,
            priority: questionObj.priority || 'medium',
            context: {
              fromSpecialist: agentResponse.specialist,
              confidence: agentResponse.confidence,
              clinicalImportance: agentResponse.assessment?.clinicalImportance
            }
          });
        }
      }
    }

    // Sort by priority (high -> medium -> low)
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    questions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return questions;
  }

  /**
   * Route questions to target agents and collect responses
   * @param {Array} questions - Questions to route
   * @param {Map} specialists - Available specialists
   * @param {Map} initialResponses - Initial agent responses for context
   * @param {Object} caseData - Case data
   * @returns {Array} Dialogue exchanges
   */
  async routeQuestionsToAgents(questions, specialists, initialResponses, caseData) {
    const dialogue = [];
    const questionsRouted = new Map(); // Track questions by target agent

    // Group questions by target agent
    for (const question of questions) {
      const targetKey = this.normalizeAgentType(question.toAgent);
      if (!questionsRouted.has(targetKey)) {
        questionsRouted.set(targetKey, []);
      }
      questionsRouted.get(targetKey).push(question);
    }

    // Route to each target agent IN PARALLEL (Option 1 optimization)
    const routingPromises = Array.from(questionsRouted.entries()).map(async ([targetAgentType, agentQuestions]) => {
      const specialist = specialists.get(targetAgentType);

      if (!specialist) {
        logger.warn(`Target specialist ${targetAgentType} not available for questions`);

        // Record failed routing
        return agentQuestions.map(q => ({
          fromAgent: q.fromAgent,
          toAgent: targetAgentType,
          question: q.question,
          response: 'Specialist not available',
          impactOnDiagnosis: false,
          status: 'failed'
        }));
      }

      // Get the initial response from this agent for context
      const initialResponse = initialResponses.get(targetAgentType);

      // Create coordination prompt with all questions
      const coordinationPrompt = this.buildCoordinationPrompt(
        specialist,
        agentQuestions,
        initialResponse,
        caseData
      );

      try {
        // Get specialist's response to the questions
        const coordinationResponse = await specialist.processMessage(
          coordinationPrompt,
          { type: 'coordination_conference', consultationId: 'conference' }
        );

        // Parse response and create dialogue entries
        const parsedResponses = this.parseCoordinationResponse(
          coordinationResponse,
          agentQuestions
        );

        return agentQuestions.map((q, i) => {
          const answer = parsedResponses[i] || coordinationResponse;
          return {
            fromAgent: q.fromAgent,
            toAgent: targetAgentType,
            question: q.question,
            response: answer,
            impactOnDiagnosis: this.assessDiagnosticImpact(answer, q.priority),
            refinedInsight: this.extractRefinedInsight(answer),
            priority: q.priority,
            timestamp: new Date().toISOString()
          };
        });

      } catch (error) {
        logger.error(`Error routing to ${targetAgentType}: ${error.message}`);

        return agentQuestions.map(q => ({
          fromAgent: q.fromAgent,
          toAgent: targetAgentType,
          question: q.question,
          response: `Error: ${error.message}`,
          impactOnDiagnosis: false,
          status: 'error'
        }));
      }
    });

    // Execute all routing in parallel and flatten results
    const dialogueResults = await Promise.all(routingPromises);
    dialogue.push(...dialogueResults.flat());

    return dialogue;
  }

  /**
   * Build coordination prompt for specialist
   * @param {Object} specialist - Target specialist
   * @param {Array} questions - Questions for this specialist
   * @param {Object} initialResponse - Initial response from this specialist
   * @param {Object} caseData - Case data
   * @returns {String} Coordination prompt
   */
  buildCoordinationPrompt(specialist, questions, initialResponse, caseData) {
    const questionList = questions.map((q, i) =>
      `${i + 1}. From ${q.fromAgent} (Priority: ${q.priority}): ${q.question}`
    ).join('\n');

    return `INTER-AGENT COORDINATION CONFERENCE

Case Data: ${JSON.stringify(caseData)}

Your Initial Assessment: ${initialResponse ? JSON.stringify(initialResponse.response?.assessment) : 'Not provided'}

QUESTIONS FROM FELLOW SPECIALISTS:
${questionList}

Please provide focused, evidence-based responses to each question from your area of expertise. For each question:

1. **Direct Answer**: Address the specific question asked
2. **Clinical Relevance**: Explain how this impacts the patient's care
3. **Recommendations**: Any specific actions or considerations based on this insight
4. **Confidence Level**: Your confidence in this assessment (0-1)

Format your response clearly for each numbered question.

IMPORTANT: Be specific and actionable. Focus on insights that will improve the coordinated treatment plan.`;
  }

  /**
   * Parse coordination response into individual answers
   * @param {String} response - Full response text
   * @param {Array} questions - Questions that were asked
   * @returns {Array} Individual parsed answers
   */
  parseCoordinationResponse(response, questions) {
    const answers = [];

    // Try to split by numbered responses
    const numberPattern = /(\d+)\.\s*(.*?)(?=\d+\.\s*|$)/gs;
    const matches = [...response.matchAll(numberPattern)];

    if (matches.length > 0) {
      for (const match of matches) {
        answers.push(match[2].trim());
      }
    } else {
      // If no numbered format, return whole response for each question
      for (let i = 0; i < questions.length; i++) {
        answers.push(response);
      }
    }

    return answers;
  }

  /**
   * Assess if response has diagnostic impact
   * @param {String} response - Response text
   * @param {String} priority - Question priority
   * @returns {Boolean} Whether it impacts diagnosis
   */
  assessDiagnosticImpact(response, priority) {
    const impactKeywords = [
      'diagnosis', 'critical', 'significant', 'important', 'concern',
      'contraindication', 'warning', 'risk', 'requires', 'must'
    ];

    const responseLower = response.toLowerCase();
    const hasImpactKeyword = impactKeywords.some(keyword =>
      responseLower.includes(keyword)
    );

    return priority === 'high' || hasImpactKeyword;
  }

  /**
   * Extract refined insight from response
   * @param {String} response - Response text
   * @returns {String} Key insight
   */
  extractRefinedInsight(response) {
    // Extract first sentence or first 150 characters as key insight
    const sentences = response.split(/[.!?]\s+/);
    const firstSentence = sentences[0];

    if (firstSentence.length > 150) {
      return firstSentence.substring(0, 147) + '...';
    }

    return firstSentence;
  }

  /**
   * Detect disagreements between agents
   * @param {Map} initialResponses - Initial agent responses
   * @param {Array} dialogue - Inter-agent dialogue
   * @returns {Array} Detected disagreements
   */
  detectDisagreements(initialResponses, dialogue) {
    const disagreements = [];

    // Check for explicit disagreements in agreementWithTriage field
    for (const [agentType, response] of initialResponses.entries()) {
      if (response.status !== 'success' || !response.response) {
        continue;
      }

      const agentResponse = response.response;

      if (agentResponse.agreementWithTriage === 'disagree' ||
          agentResponse.agreementWithTriage === 'partial') {

        disagreements.push({
          agents: ['triage', agentType],
          topic: 'Initial assessment',
          disagreementType: agentResponse.agreementWithTriage,
          reason: agentResponse.disagreementReason || 'Not specified',
          resolution: this.proposeResolution(agentResponse, agentType),
          confidence: this.calculateDisagreementConfidence(agentResponse),
          severity: agentResponse.agreementWithTriage === 'disagree' ? 'high' : 'medium'
        });
      }
    }

    // Check for conflicting recommendations
    const recommendationConflicts = this.detectRecommendationConflicts(initialResponses);
    disagreements.push(...recommendationConflicts);

    // Check for conflicting clinical importance assessments
    const importanceConflicts = this.detectImportanceConflicts(initialResponses);
    disagreements.push(...importanceConflicts);

    return disagreements;
  }

  /**
   * Detect conflicts in recommendations across agents
   * @param {Map} responses - Agent responses
   * @returns {Array} Recommendation conflicts
   */
  detectRecommendationConflicts(responses) {
    const conflicts = [];
    const recommendations = new Map();

    // Collect all recommendations
    for (const [agentType, response] of responses.entries()) {
      if (response.status === 'success' && response.response?.recommendations) {
        for (const rec of response.response.recommendations) {
          const key = this.normalizeIntervention(rec.intervention);

          if (!recommendations.has(key)) {
            recommendations.set(key, []);
          }

          recommendations.get(key).push({
            agent: agentType,
            recommendation: rec,
            specialist: response.response.specialist
          });
        }
      }
    }

    // Check for conflicts in same intervention
    for (const [intervention, agents] of recommendations.entries()) {
      if (agents.length > 1) {
        // Check for priority conflicts
        const priorities = agents.map(a => a.recommendation.priority);
        const maxPriority = Math.max(...priorities);
        const minPriority = Math.min(...priorities);

        if (maxPriority - minPriority >= 3) {
          conflicts.push({
            agents: agents.map(a => a.agent),
            topic: intervention,
            disagreementType: 'priority_conflict',
            reason: `Priority mismatch: ${minPriority} to ${maxPriority}`,
            resolution: `Recommended priority: ${Math.round((maxPriority + minPriority) / 2)}`,
            confidence: 0.7,
            severity: 'medium'
          });
        }

        // Check for timeline conflicts
        const timelines = agents.map(a => a.recommendation.timeline).filter(t => t);
        if (timelines.length > 1 && new Set(timelines).size > 1) {
          conflicts.push({
            agents: agents.map(a => a.agent),
            topic: intervention,
            disagreementType: 'timeline_conflict',
            reason: `Different timelines suggested: ${timelines.join(', ')}`,
            resolution: `Use earliest conservative timeline: ${timelines[0]}`,
            confidence: 0.6,
            severity: 'low'
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Detect conflicts in clinical importance ratings
   * @param {Map} responses - Agent responses
   * @returns {Array} Importance conflicts
   */
  detectImportanceConflicts(responses) {
    const conflicts = [];
    const importanceRatings = [];

    for (const [agentType, response] of responses.entries()) {
      if (response.status === 'success' && response.response?.assessment?.clinicalImportance) {
        importanceRatings.push({
          agent: agentType,
          importance: response.response.assessment.clinicalImportance,
          specialist: response.response.specialist
        });
      }
    }

    // Check for significant variance in importance ratings
    const importanceLevels = { low: 1, medium: 2, high: 3, critical: 4 };
    const ratings = importanceRatings.map(r => importanceLevels[r.importance] || 2);

    if (ratings.length >= 2) {
      const maxRating = Math.max(...ratings);
      const minRating = Math.min(...ratings);

      if (maxRating - minRating >= 2) {
        conflicts.push({
          agents: importanceRatings.map(r => r.agent),
          topic: 'Clinical importance assessment',
          disagreementType: 'importance_conflict',
          reason: `Ratings vary from ${Object.keys(importanceLevels)[minRating - 1]} to ${Object.keys(importanceLevels)[maxRating - 1]}`,
          resolution: `Consensus importance: ${Object.keys(importanceLevels)[Math.round((maxRating + minRating) / 2) - 1]}`,
          confidence: 0.65,
          severity: maxRating === 4 ? 'high' : 'medium'
        });
      }
    }

    return conflicts;
  }

  /**
   * Propose resolution for disagreement
   * @param {Object} agentResponse - Agent response with disagreement
   * @param {String} agentType - Agent type
   * @returns {String} Proposed resolution
   */
  proposeResolution(agentResponse, agentType) {
    if (agentResponse.disagreementReason) {
      return `Consider ${agentType} perspective: ${agentResponse.disagreementReason}. Recommend multi-specialist review.`;
    }
    return `Recommend consultation between triage and ${agentType} to align on assessment approach.`;
  }

  /**
   * Calculate confidence in disagreement detection
   * @param {Object} agentResponse - Agent response
   * @returns {Number} Confidence level
   */
  calculateDisagreementConfidence(agentResponse) {
    const baseConfidence = agentResponse.confidence || 0.5;
    const hasReason = agentResponse.disagreementReason ? 0.2 : 0;
    return Math.min(baseConfidence + hasReason, 1.0);
  }

  /**
   * Track emergent findings from coordination
   * @param {Array} dialogue - Inter-agent dialogue
   * @param {Map} initialResponses - Initial responses
   * @returns {Array} Emergent findings
   */
  trackEmergentFindings(dialogue, initialResponses, disagreements = []) {
    const findings = [];

    // Findings from high-impact dialogue
    const highImpactDialogue = dialogue.filter(d => d.impactOnDiagnosis === true);

    for (const exchange of highImpactDialogue) {
      const novelty = this.assessNovelty(exchange, initialResponses);

      if (novelty !== 'routine') {
        findings.push({
          finding: exchange.refinedInsight || exchange.response.substring(0, 200),
          discoveredBy: [exchange.fromAgent, exchange.toAgent],
          clinicalSignificance: this.assessClinicalSignificance(exchange),
          novelty: novelty,
          confidence: 0.75,
          source: 'inter_agent_dialogue',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Findings from resolved disagreements in this consultation
    const resolvedDisagreements = disagreements.filter(d => d.resolution);
    for (const disagreement of resolvedDisagreements) {
      if (disagreement.severity === 'high') {
        findings.push({
          finding: `Resolved disagreement: ${disagreement.topic}`,
          discoveredBy: disagreement.agents,
          clinicalSignificance: 'May impact treatment approach',
          novelty: 'unusual',
          confidence: disagreement.confidence,
          source: 'disagreement_resolution',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Cross-specialty insights (when 3+ specialists contribute to same topic)
    const crossSpecialtyInsights = this.identifyCrossSpecialtyInsights(dialogue);
    findings.push(...crossSpecialtyInsights);

    return findings;
  }

  /**
   * Assess novelty of finding
   * @param {Object} exchange - Dialogue exchange
   * @param {Map} initialResponses - Initial responses
   * @returns {String} Novelty level
   */
  assessNovelty(exchange, initialResponses) {
    const responseLower = exchange.response.toLowerCase();

    // Novel indicators
    if (responseLower.includes('unexpected') ||
        responseLower.includes('unusual') ||
        responseLower.includes('atypical') ||
        responseLower.includes('rare')) {
      return 'novel';
    }

    // Unusual indicators
    if (responseLower.includes('uncommon') ||
        responseLower.includes('noteworthy') ||
        responseLower.includes('significant concern')) {
      return 'unusual';
    }

    return 'routine';
  }

  /**
   * Assess clinical significance of exchange
   * @param {Object} exchange - Dialogue exchange
   * @returns {String} Clinical significance
   */
  assessClinicalSignificance(exchange) {
    const responseLower = exchange.response.toLowerCase();

    if (responseLower.includes('critical') ||
        responseLower.includes('urgent') ||
        responseLower.includes('immediate')) {
      return 'High - impacts immediate care decisions';
    }

    if (responseLower.includes('important') ||
        responseLower.includes('significant')) {
      return 'Moderate - influences treatment approach';
    }

    return 'Low - provides additional context';
  }

  /**
   * Identify cross-specialty insights
   * @param {Array} dialogue - Dialogue exchanges
   * @returns {Array} Cross-specialty findings
   */
  identifyCrossSpecialtyInsights(dialogue) {
    const insights = [];
    const topicMap = new Map();

    // Group by topic keywords
    for (const exchange of dialogue) {
      const keywords = this.extractKeywords(exchange.question + ' ' + exchange.response);

      for (const keyword of keywords) {
        if (!topicMap.has(keyword)) {
          topicMap.set(keyword, []);
        }
        topicMap.get(keyword).push(exchange);
      }
    }

    // Find topics with 3+ specialist contributions
    for (const [topic, exchanges] of topicMap.entries()) {
      const uniqueAgents = new Set(exchanges.flatMap(e => [e.fromAgent, e.toAgent]));

      if (uniqueAgents.size >= 3) {
        insights.push({
          finding: `Cross-specialty consensus on ${topic}`,
          discoveredBy: Array.from(uniqueAgents),
          clinicalSignificance: 'Multiple specialists identify this as key concern',
          novelty: 'unusual',
          confidence: 0.85,
          source: 'cross_specialty_collaboration',
          timestamp: new Date().toISOString()
        });
      }
    }

    return insights;
  }

  /**
   * Extract keywords from text
   * @param {String} text - Text to analyze
   * @returns {Array} Keywords
   */
  extractKeywords(text) {
    const keywords = [];
    const medicalTerms = [
      'pain', 'movement', 'strength', 'function', 'anxiety', 'stress',
      'range of motion', 'mobility', 'stability', 'biomechanics',
      'inflammation', 'rehabilitation', 'recovery', 'compensation'
    ];

    const lowerText = text.toLowerCase();

    for (const term of medicalTerms) {
      if (lowerText.includes(term)) {
        keywords.push(term);
      }
    }

    return keywords;
  }

  /**
   * Normalize agent type for consistent matching
   * @param {String} agentType - Agent type string
   * @returns {String} Normalized type
   */
  normalizeAgentType(agentType) {
    const normalized = agentType.toLowerCase().replace(/[_-]/g, '');

    const typeMap = {
      'painwhisperer': 'painWhisperer',
      'pain': 'painWhisperer',
      'movementdetective': 'movementDetective',
      'movement': 'movementDetective',
      'strengthsage': 'strengthSage',
      'strength': 'strengthSage',
      'mindmender': 'mindMender',
      'mind': 'mindMender',
      'triage': 'triage'
    };

    return typeMap[normalized] || agentType;
  }

  /**
   * Normalize intervention name for comparison
   * @param {String} intervention - Intervention name
   * @returns {String} Normalized name
   */
  normalizeIntervention(intervention) {
    return intervention.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);
  }

  /**
   * Get coordination statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    return {
      totalConferences: this.dialogueHistory.length,
      averageDialogueCount: this.dialogueHistory.length > 0
        ? this.dialogueHistory.reduce((sum, h) => sum + h.interAgentDialogue.length, 0) / this.dialogueHistory.length
        : 0,
      averageEmergentFindings: this.dialogueHistory.length > 0
        ? this.dialogueHistory.reduce((sum, h) => sum + h.emergentFindings.length, 0) / this.dialogueHistory.length
        : 0
    };
  }
}

export default CoordinationConference;
