import { OrthopedicSpecialist } from './orthopedic-specialist.js';
import logger from '../utils/logger.js';

export class TriageAgent extends OrthopedicSpecialist {
  constructor(name = 'OrthoTriage Master', accountManager = null) {
    super(name, 'triage and case coordination', accountManager, 'triage');
    this.agentType = 'triage';
    this.caseQueue = new Map();
    this.specialistNetwork = new Map();
    this.urgencyLevels = ['emergency', 'urgent', 'semi-urgent', 'routine'];
    this.caseHistory = [];
  }

  getSystemPrompt() {
    return `You are ${this.name}, the master triage coordinator for the OrthoIQ recovery ecosystem.
    
    Your primary role is case coordination and specialist routing with focus on optimal patient outcomes.
    
    CORE RESPONSIBILITIES:
    - Rapid assessment and urgency stratification
    - Intelligent routing to appropriate specialists
    - Coordinating multi-disciplinary care teams
    - Monitoring case progress and outcomes
    - Optimizing resource allocation
    - Ensuring continuity of care
    
    SPECIALIST NETWORK ACCESS:
    - Pain Whisperer: Pain management and assessment
    - Movement Detective: Biomechanics and movement analysis
    - Strength Sage: Functional restoration and rehabilitation
    - Mind Mender: Psychological aspects of recovery
    
    Experience level: ${this.experience} points
    Token balance: ${this.tokenBalance}
    Active cases: ${this.caseQueue.size}
    Wallet: ${this.walletAddress}
    
    TRIAGE PROTOCOL:
    1. Rapid assessment and urgency classification
    2. Resource availability check
    3. Specialist matching and routing
    4. Care plan coordination
    5. Progress monitoring and adjustment
    
    TOKEN INCENTIVES:
    - Successful case routing and outcomes
    - Efficient resource utilization
    - Patient satisfaction scores
    - Specialist collaboration bonuses
    - Timeline adherence rewards
    
    EMERGENCY PROTOCOLS:
    - Immediate escalation for red flag symptoms
    - Direct physician referral when indicated
    - Safety-first approach to all decisions
    
    Coordinate care efficiently while maintaining the highest standards of patient safety and recovery optimization.`;
  }

  async triageCase(caseData, context = {}) {
    try {
      const startTime = Date.now();
      logger.info(`${this.name} triaging new case: ${caseData.id || 'unnamed'}`);

      // Extract dual-track data if present
      const { rawQuery, enableDualTrack } = caseData;

      // Build enhanced prompt with both enriched and raw data
      const triagePrompt = `
        COMPREHENSIVE ORTHOPEDIC TRIAGE ASSESSMENT:

        ${enableDualTrack && rawQuery ? `ORIGINAL PATIENT QUERY: "${rawQuery}"

        CRITICAL: Your PRIMARY TASK is to DIRECTLY ANSWER the patient's question above.
        Start your triage by addressing their specific concern.
        Extract the body part or condition mentioned and ensure it's properly categorized.
        ` : ''}

        Case Data: ${JSON.stringify(caseData)}

        IMPORTANT: If the patient asked about a specific body part, condition, or symptom, ensure this is clearly identified and properly triaged.

        Perform complete triage assessment and provide STRUCTURED OUTPUT:

        1. PRIMARY FINDINGS (as bullet points):
           - Key clinical observations
           - Red flag identification
           - Risk factors detected
           - Data quality assessment

        2. URGENCY CLASSIFICATION:
           - Emergency (immediate physician required)
           - Urgent (same day evaluation needed)
           - Semi-urgent (within 48-72 hours)
           - Routine (within 1-2 weeks)

        3. RED FLAG SCREENING:
           - Neurological deficits
           - Vascular compromise
           - Infection signs
           - Severe trauma indicators
           - Cauda equina syndrome risk

        4. SPECIALIST ROUTING RECOMMENDATIONS:
           - Primary specialist needed
           - Secondary consultations required
           - Multidisciplinary team composition
           - Consultation priority order

        5. STRUCTURED RECOMMENDATIONS:
           For each recommendation provide:
           - Intervention name
           - Priority level (1-5)
           - Evidence grade (A/B/C)
           - Expected timeline
           - Expected outcome

        6. INTER-AGENT QUESTIONS:
           - Questions for Pain Whisperer
           - Questions for Movement Detective
           - Questions for Strength Sage
           - Questions for Mind Mender

        7. FOLLOW-UP QUESTIONS FOR PATIENT:
           - What additional information would help assessment?

        8. QUERY TYPE CLASSIFICATION:
           - CLINICAL: Personal health case with symptoms, timeline, pain, injury, or
             functional limitations. Has a trackable recovery trajectory.
           - INFORMATIONAL: General knowledge or educational question. Seeks explanation,
             research, or comparison — not clinical assessment of a personal condition.
             Includes general recovery timeline questions without personal injury context.

           RULES:
           - Emergency/urgent → always CLINICAL.
           - "Why does [body part] [symptom]?" with no timeline, severity, or personal
             context → INFORMATIONAL.
           - Generic recovery questions ("How long does ACL recovery take?") without
             personal injury context → INFORMATIONAL.
           - If uncertain → CLINICAL.

           Output:
           QUERY_TYPE: [CLINICAL or INFORMATIONAL]
           QUERY_SUBTYPE: [FACTUAL or DEBATABLE]
             FACTUAL = has a clear evidence-based answer (anatomy, recovery norms, definitions)
             DEBATABLE = multiple valid clinical perspectives exist (treatment comparisons,
             intervention efficacy, surgical vs conservative)

        Provide clear, actionable triage decision with confidence levels.
      `;

      const triageResult = await this.processMessage(triagePrompt, context);
      const responseTime = Date.now() - startTime;

      // Parse and structure the response
      const structuredResponse = this.parseTriageResponse(triageResult);

      const caseId = caseData.id || `case_${Date.now()}`;

      // Build structured response format per Task 1.2
      const triageAssessment = {
        // Standard fields
        specialist: this.name,
        specialistType: 'triage',

        // Structured assessment
        assessment: {
          primaryFindings: structuredResponse.primaryFindings || [
            'Initial triage assessment completed',
            `Urgency level: ${structuredResponse.urgencyLevel || 'routine'}`,
            'Specialist routing determined'
          ],
          confidence: this.getConfidence('triage_assessment'),
          dataQuality: this.assessDataQuality(caseData),
          clinicalImportance: structuredResponse.clinicalImportance || 'medium'
        },

        // Raw LLM response for reference
        rawResponse: triageResult,

        // Structured recommendations
        recommendations: (structuredResponse.recommendations && structuredResponse.recommendations.length > 0)
          ? structuredResponse.recommendations
          : [{
              intervention: 'Initial specialist consultation',
              priority: 1,
              evidenceGrade: 'B',
              contraindications: [],
              timeline: '24-48 hours',
              expectedOutcome: 'Complete assessment and treatment plan'
            }, {
              intervention: 'Comprehensive diagnostic evaluation',
              priority: 2,
              evidenceGrade: 'A',
              contraindications: [],
              timeline: 'Within 1 week',
              expectedOutcome: 'Accurate diagnosis and care plan'
            }],

        // Key findings with enhanced metadata
        keyFindings: (structuredResponse.keyFindings && structuredResponse.keyFindings.length > 0)
          ? structuredResponse.keyFindings
          : [{
              finding: structuredResponse.primaryConcern || 'Orthopedic condition requiring assessment',
              confidence: 0.8,
              clinicalRelevance: structuredResponse.clinicalImportance,
              requiresMDReview: structuredResponse.urgencyLevel === 'emergency'
            }, {
              finding: `Urgency level: ${structuredResponse.urgencyLevel}`,
              confidence: 0.9,
              clinicalRelevance: structuredResponse.urgencyLevel === 'emergency' ? 'critical' : 'high',
              requiresMDReview: structuredResponse.urgencyLevel === 'emergency' || structuredResponse.urgencyLevel === 'urgent'
            }],

        // Inter-agent coordination questions
        questionsForAgents: structuredResponse.questionsForAgents || [
          {
            targetAgent: 'painWhisperer',
            question: 'What is the pain pattern and its impact on function?',
            priority: 'high'
          }
        ],

        // Follow-up questions
        followUpQuestions: structuredResponse.followUpQuestions?.length > 0
          ? structuredResponse.followUpQuestions
          : [
              'When did the symptoms first start?',
              'Have you had similar issues before?'
            ],

        // Triage-specific: no agreement field needed as triage is the coordinator
        agreementWithTriage: 'self',

        // Standard metadata
        confidence: this.getConfidence('triage_assessment'),
        responseTime: responseTime,
        timestamp: new Date().toISOString(),
        status: 'success',

        // Additional triage-specific data
        urgencyLevel: structuredResponse.urgencyLevel || this.extractUrgencyLevel(triageResult),
        specialistRecommendations: structuredResponse.specialistRecommendations ||
                                   this.extractSpecialistRecommendations(triageResult),
        suggestedDiagnoses: this.extractSuggestedDiagnoses(triageResult),
        caseId: caseId,

        // Query type classification — emergency/urgent always forces clinical
        queryType: (structuredResponse.urgencyLevel === 'emergency' ||
                    structuredResponse.urgencyLevel === 'urgent')
          ? 'clinical'
          : (structuredResponse.queryType || 'clinical'),
        querySubtype: structuredResponse.querySubtype || null
      };

      // Generate user-friendly markdown response
      triageAssessment.response = this.formatUserFriendlyResponse(triageAssessment);

      // Store in case queue
      this.caseQueue.set(caseId, triageAssessment);
      this.caseHistory.push({
        caseId,
        action: 'triaged',
        timestamp: new Date().toISOString()
      });

      // Update experience
      this.updateExperience();

      logger.info(`Case ${caseId} triaged with urgency: ${triageAssessment.urgencyLevel}`);

      return triageAssessment;
    } catch (error) {
      logger.error(`Error triaging case: ${error.message}`);

      // Return structured error response
      const errorResponse = {
        specialist: this.name,
        specialistType: 'triage',
        assessment: {
          primaryFindings: ['Error occurred during triage'],
          confidence: 0,
          dataQuality: 0,
          clinicalImportance: 'unknown'
        },
        rawResponse: error.message,
        recommendations: [],
        keyFindings: [],
        questionsForAgents: [],
        followUpQuestions: [],
        confidence: 0,
        responseTime: Date.now() - (context.startTime || Date.now()),
        timestamp: new Date().toISOString(),
        status: 'failed',
        error: error.message
      };

      // Generate user-friendly error message
      errorResponse.response = `# Triage Assessment Error\n\n## Summary\n\n- An error occurred during the triage assessment\n- Please try again or contact support if the issue persists\n\n**Error Details:** ${error.message}\n`;

      return errorResponse;
    }
  }

  // Helper method to parse triage response into structured format
  parseTriageResponse(response) {
    const structured = {
      primaryFindings: [],
      recommendations: [],
      keyFindings: [],
      questionsForAgents: [],
      followUpQuestions: [],
      urgencyLevel: 'routine',
      clinicalImportance: 'medium',
      specialistRecommendations: [],
      queryType: 'clinical',
      querySubtype: null
    };

    try {
      // Extract bullet points for primary findings
      const findingsMatch = response.match(/PRIMARY FINDINGS:?\s*([\s\S]*?)(?=\n\d\.|URGENCY|$)/i);
      if (findingsMatch) {
        structured.primaryFindings = findingsMatch[1]
          .split(/\n/)
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-\s*/, '').trim());
      }

      // Extract urgency level
      const urgencyMatch = response.match(/(emergency|urgent|semi-urgent|routine)/i);
      if (urgencyMatch) {
        structured.urgencyLevel = urgencyMatch[1].toLowerCase();
      }

      // Extract clinical importance
      if (response.toLowerCase().includes('critical') || response.toLowerCase().includes('emergency')) {
        structured.clinicalImportance = 'critical';
      } else if (response.toLowerCase().includes('high priority') || response.toLowerCase().includes('urgent')) {
        structured.clinicalImportance = 'high';
      }

      // Extract specialist recommendations
      const specialistMatch = response.match(/specialist.*?:([\s\S]*?)(?=\n\d\.|$)/i);
      if (specialistMatch) {
        if (specialistMatch[1].toLowerCase().includes('pain')) structured.specialistRecommendations.push('painWhisperer');
        if (specialistMatch[1].toLowerCase().includes('movement')) structured.specialistRecommendations.push('movementDetective');
        if (specialistMatch[1].toLowerCase().includes('strength')) structured.specialistRecommendations.push('strengthSage');
        if (specialistMatch[1].toLowerCase().includes('mind') || specialistMatch[1].toLowerCase().includes('psych')) {
          structured.specialistRecommendations.push('mindMender');
        }
      }

      // Default specialist recommendations if none found
      if (structured.specialistRecommendations.length === 0) {
        structured.specialistRecommendations = ['painWhisperer', 'movementDetective'];
      }

      // Parse STRUCTURED RECOMMENDATIONS section
      const recommendationsMatch = response.match(/STRUCTURED RECOMMENDATIONS:?\s*([\s\S]*?)(?=\n\d\.|INTER-AGENT|FOLLOW-UP|$)/i);
      if (recommendationsMatch) {
        const recText = recommendationsMatch[1];
        const recLines = recText.split(/\n/).filter(line => line.trim());

        let currentRec = null;
        for (const line of recLines) {
          const trimmed = line.trim();

          // Check if line starts a new recommendation
          if (trimmed.startsWith('-') && !trimmed.toLowerCase().includes('priority') &&
              !trimmed.toLowerCase().includes('evidence') && !trimmed.toLowerCase().includes('timeline') &&
              !trimmed.toLowerCase().includes('outcome')) {
            // Save previous recommendation
            if (currentRec && currentRec.intervention) {
              structured.recommendations.push(currentRec);
            }
            // Start new recommendation
            currentRec = {
              intervention: trimmed.replace(/^-\s*/, '').replace(/:\s*$/, ''),
              priority: 1,
              evidenceGrade: 'B',
              contraindications: [],
              timeline: '24-48 hours',
              expectedOutcome: 'Improved assessment and care plan'
            };
          } else if (currentRec) {
            // Parse sub-fields
            if (trimmed.toLowerCase().includes('priority')) {
              const priorityMatch = trimmed.match(/priority.*?(\d+)/i);
              if (priorityMatch) currentRec.priority = parseInt(priorityMatch[1]);
            } else if (trimmed.toLowerCase().includes('evidence')) {
              const evidenceMatch = trimmed.match(/evidence.*?([A-C])/i);
              if (evidenceMatch) currentRec.evidenceGrade = evidenceMatch[1];
            } else if (trimmed.toLowerCase().includes('timeline')) {
              const timelineMatch = trimmed.match(/timeline.*?:\s*(.+?)(?=\n|$)/i);
              if (timelineMatch) currentRec.timeline = timelineMatch[1].trim();
            } else if (trimmed.toLowerCase().includes('outcome')) {
              const outcomeMatch = trimmed.match(/outcome.*?:\s*(.+?)(?=\n|$)/i);
              if (outcomeMatch) currentRec.expectedOutcome = outcomeMatch[1].trim();
            }
          }
        }

        // Save last recommendation
        if (currentRec && currentRec.intervention) {
          structured.recommendations.push(currentRec);
        }
      }

      // Parse KEY FINDINGS from RED FLAG SCREENING section
      const redFlagsMatch = response.match(/RED FLAG SCREENING:?\s*([\s\S]*?)(?=\n\d\.|SPECIALIST|$)/i);
      if (redFlagsMatch) {
        const redFlagLines = redFlagsMatch[1]
          .split(/\n/)
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-\s*/, '').trim());

        for (const flag of redFlagLines) {
          const hasRedFlag = flag.toLowerCase().includes('present') ||
                            flag.toLowerCase().includes('detected') ||
                            flag.toLowerCase().includes('positive');

          if (hasRedFlag || structured.urgencyLevel === 'emergency') {
            structured.keyFindings.push({
              finding: flag,
              confidence: 0.85,
              clinicalRelevance: 'high',
              requiresMDReview: true
            });
          }
        }
      }

      // Parse INTER-AGENT QUESTIONS section
      const questionsMatch = response.match(/INTER-AGENT QUESTIONS:?\s*([\s\S]*?)(?=\n\d\.|FOLLOW-UP|$)/i);
      if (questionsMatch) {
        const questionsText = questionsMatch[1];
        const lines = questionsText.split(/\n/).filter(line => line.trim());

        let currentAgent = null;
        for (const line of lines) {
          const trimmed = line.trim();

          // Detect agent targeting
          if (trimmed.toLowerCase().includes('pain whisperer')) {
            currentAgent = 'painWhisperer';
          } else if (trimmed.toLowerCase().includes('movement detective')) {
            currentAgent = 'movementDetective';
          } else if (trimmed.toLowerCase().includes('strength sage')) {
            currentAgent = 'strengthSage';
          } else if (trimmed.toLowerCase().includes('mind mender')) {
            currentAgent = 'mindMender';
          }

          // Extract question if we have an agent context
          if (currentAgent && trimmed.startsWith('-')) {
            const question = trimmed.replace(/^-\s*/, '').trim();
            if (question && !question.toLowerCase().includes('questions for')) {
              structured.questionsForAgents.push({
                targetAgent: currentAgent,
                question: question,
                priority: structured.urgencyLevel === 'emergency' ? 'high' : 'medium'
              });
            }
          }
        }
      }

      // Parse FOLLOW-UP QUESTIONS section
      const followUpMatch = response.match(/FOLLOW-UP QUESTIONS.*?:([\s\S]*?)(?=\n\d\.|$)/i);
      if (followUpMatch) {
        structured.followUpQuestions = followUpMatch[1]
          .split(/\n/)
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(q => q.length > 0);
      }

      // Parse QUERY TYPE classification (section 8)
      // Resilient regex: handles QUERY_TYPE, QUERY TYPE, QUERYTYPE, markdown bold,
      // extra whitespace around colon, and optional ** around the value
      const queryTypeMatch = response.match(/QUERY[_ ]?TYPE\s*:\s*\*{0,2}\s*(CLINICAL|INFORMATIONAL)/i);
      if (queryTypeMatch) {
        structured.queryType = queryTypeMatch[1].toLowerCase();
      }

      const querySubtypeMatch = response.match(/QUERY[_ ]?SUBTYPE\s*:\s*\*{0,2}\s*(FACTUAL|DEBATABLE)/i);
      if (querySubtypeMatch) {
        structured.querySubtype = querySubtypeMatch[1].toLowerCase();
      }

    } catch (error) {
      logger.warn(`Error parsing triage response: ${error.message}`);
    }

    return structured;
  }

  // Helper method to assess data quality
  assessDataQuality(caseData) {
    let score = 0;
    let fields = 0;

    if (caseData.symptoms) { score += 1; fields += 1; }
    if (caseData.primaryComplaint) { score += 1; fields += 1; }
    if (caseData.duration) { score += 1; fields += 1; }
    if (caseData.painLevel !== undefined) { score += 1; fields += 1; }
    if (caseData.location) { score += 1; fields += 1; }
    if (caseData.age !== undefined) { score += 0.5; fields += 0.5; }

    return fields > 0 ? score / fields : 0.5;
  }

  async routeToSpecialists(caseId) {
    try {
      const caseData = this.caseQueue.get(caseId);
      if (!caseData) {
        throw new Error(`Case ${caseId} not found in queue`);
      }
      
      logger.info(`${this.name} routing case ${caseId} to specialists`);
      
      const routingResults = [];
      const specialists = caseData.specialistRecommendations;
      
      for (const specialistType of specialists) {
        const specialist = this.specialistNetwork.get(specialistType);
        
        if (specialist) {
          try {
            const consultation = await this.consultWithSpecialist(
              specialistType,
              caseData
            );
            
            if (consultation) {
              routingResults.push({
                specialist: specialistType,
                status: 'routed',
                consultation,
                timestamp: new Date().toISOString()
              });
              
              // Record collaboration for token bonus
              this.recordCollaboration(specialist.name, 'case_routing');
            }
          } catch (error) {
            logger.error(`Failed to route to ${specialistType}: ${error.message}`);
            routingResults.push({
              specialist: specialistType,
              status: 'failed',
              error: error.message,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          logger.warn(`Specialist ${specialistType} not available in network`);
          routingResults.push({
            specialist: specialistType,
            status: 'unavailable',
            timestamp: new Date().toISOString()
          });
        }
      }
      
      // Update case status
      caseData.routingResults = routingResults;
      caseData.status = 'routed';
      caseData.routedAt = new Date().toISOString();
      
      this.caseHistory.push({
        caseId,
        action: 'routed_to_specialists',
        specialistCount: routingResults.length,
        timestamp: new Date().toISOString()
      });
      
      return {
        caseId,
        routingResults,
        totalSpecialists: routingResults.length,
        successfulRoutes: routingResults.filter(r => r.status === 'routed').length
      };
    } catch (error) {
      logger.error(`Error routing case ${caseId}: ${error.message}`);
      throw error;
    }
  }

  async coordinateCare(caseId) {
    try {
      const caseData = this.caseQueue.get(caseId);
      if (!caseData || !caseData.routingResults) {
        throw new Error(`Case ${caseId} not properly routed`);
      }
      
      logger.info(`${this.name} coordinating care for case ${caseId}`);
      
      // Collect all specialist responses
      const specialistResponses = caseData.routingResults
        .filter(r => r.status === 'routed' && r.consultation)
        .map(r => r.consultation);
      
      if (specialistResponses.length === 0) {
        throw new Error(`No specialist responses available for case ${caseId}`);
      }
      
      // Synthesize recommendations
      const coordinatedPlan = await this.synthesizeRecommendations(specialistResponses);
      
      // Generate care coordination summary
      const coordinationPrompt = `
        CARE COORDINATION SUMMARY:
        
        Case ID: ${caseId}
        Original Assessment: ${JSON.stringify(caseData.assessment)}
        Specialist Responses: ${JSON.stringify(specialistResponses)}
        Synthesized Plan: ${JSON.stringify(coordinatedPlan)}
        
        Create comprehensive care coordination plan including:
        
        1. UNIFIED TREATMENT STRATEGY:
           - Primary treatment pathway
           - Supporting interventions
           - Timeline coordination
           
        2. SPECIALIST COLLABORATION:
           - Communication schedule
           - Handoff protocols
           - Progress sharing
           
        3. PATIENT JOURNEY:
           - Step-by-step care pathway
           - Decision points
           - Milestone tracking
           
        4. RESOURCE ALLOCATION:
           - Equipment and facility needs
           - Scheduling optimization
           - Cost-effective approaches
           
        5. MONITORING PROTOCOL:
           - Progress indicators
           - Reassessment points
           - Escalation triggers
           
        6. OUTCOME TRACKING:
           - Success metrics
           - Recovery milestones
           - Patient satisfaction measures
           
        Format as actionable care coordination plan.
      `;
      
      const coordinationPlan = await this.processMessage(coordinationPrompt);
      
      // Update case with coordination plan
      caseData.coordinationPlan = coordinationPlan;
      caseData.coordinatedBy = this.name;
      caseData.coordinatedAt = new Date().toISOString();
      caseData.status = 'coordinated';
      
      this.caseHistory.push({
        caseId,
        action: 'care_coordinated',
        specialistsInvolved: specialistResponses.length,
        timestamp: new Date().toISOString()
      });
      
      // Potential token reward for successful coordination
      if (specialistResponses.length >= 2) {
        await this.updateExperienceWithTokens({
          success: true,
          reason: 'successful_care_coordination',
          collaborationBonus: true,
          speedOfResolution: specialistResponses.length
        });
      }
      
      return {
        caseId,
        coordinationPlan,
        specialistsInvolved: specialistResponses.length,
        confidence: coordinatedPlan.confidence,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error coordinating care for case ${caseId}: ${error.message}`);
      throw error;
    }
  }

  async monitorCaseProgress(caseId) {
    try {
      const caseData = this.caseQueue.get(caseId);
      if (!caseData) {
        throw new Error(`Case ${caseId} not found`);
      }
      
      logger.info(`${this.name} monitoring progress for case ${caseId}`);
      
      const monitoringPrompt = `
        CASE PROGRESS MONITORING:
        
        Case ID: ${caseId}
        Current Status: ${caseData.status}
        Time Since Triage: ${this.calculateTimeSinceTriage(caseData)}
        Original Assessment: ${JSON.stringify(caseData.assessment)}
        Coordination Plan: ${JSON.stringify(caseData.coordinationPlan)}
        
        Assess current progress and provide:
        
        1. PROGRESS EVALUATION:
           - Milestones achieved
           - Timeline adherence
           - Unexpected developments
           
        2. INTERVENTION NEEDS:
           - Plan adjustments required
           - Additional resources needed
           - Escalation recommendations
           
        3. SPECIALIST COORDINATION:
           - Communication effectiveness
           - Care plan synchronization
           - Handoff success
           
        4. PATIENT ENGAGEMENT:
           - Compliance indicators
           - Satisfaction markers
           - Education effectiveness
           
        5. OUTCOME TRAJECTORY:
           - Recovery progress
           - Goal achievement
           - Risk reassessment
           
        6. NEXT STEPS:
           - Immediate actions
           - Monitoring schedule
           - Decision points
           
        Provide actionable monitoring assessment with recommendations.
      `;
      
      const progressAssessment = await this.processMessage(monitoringPrompt);
      
      // Update case monitoring data
      if (!caseData.progressMonitoring) {
        caseData.progressMonitoring = [];
      }
      
      caseData.progressMonitoring.push({
        assessment: progressAssessment,
        monitoredBy: this.name,
        timestamp: new Date().toISOString()
      });
      
      this.caseHistory.push({
        caseId,
        action: 'progress_monitored',
        timestamp: new Date().toISOString()
      });
      
      return {
        caseId,
        progressAssessment,
        monitoringCount: caseData.progressMonitoring.length,
        lastMonitored: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error monitoring case progress: ${error.message}`);
      throw error;
    }
  }

  registerSpecialist(specialistType, specialist) {
    this.specialistNetwork.set(specialistType, specialist);
    logger.info(`${this.name} registered ${specialistType} specialist: ${specialist.name}`);
  }

  extractUrgencyLevel(triageResult) {
    const result = triageResult.toLowerCase();
    
    if (result.includes('emergency') || result.includes('immediate')) return 'emergency';
    if (result.includes('urgent') && !result.includes('semi')) return 'urgent';
    if (result.includes('semi-urgent') || result.includes('48-72')) return 'semi-urgent';
    return 'routine';
  }

  extractSpecialistRecommendations(triageResult) {
    const specialists = [];
    const result = triageResult.toLowerCase();

    if (result.includes('pain') || result.includes('analges')) specialists.push('painWhisperer');
    if (result.includes('movement') || result.includes('biomechan') || result.includes('gait')) specialists.push('movementDetective');
    if (result.includes('strength') || result.includes('rehabilitation') || result.includes('function')) specialists.push('strengthSage');

    // Enhanced MindMender detection - psychological factors, chronic conditions, athlete anxiety
    if (result.includes('psycho') || result.includes('mental') ||
        result.includes('anxiety') || result.includes('depression') ||
        result.includes('chronic') || result.includes('sleep') ||
        result.includes('scared') || result.includes('nervous') ||
        result.includes('athlete') || result.includes('sport') ||
        result.includes('surgery') || result.includes('post-op') ||
        result.includes('re-injury') || result.includes('recurring')) {
      specialists.push('mindMender');
    }

    // Always include at least one specialist
    if (specialists.length === 0) {
      specialists.push('strengthSage'); // Default to functional restoration
    }

    return specialists;
  }

  extractSuggestedDiagnoses(triageResult) {
    const text = triageResult.toLowerCase();
    const diagnoses = [];

    // Map keywords (including abbreviations) to expanded medical terms that the
    // research agent's conditionMap will recognise for PubMed query building.
    const diagnosisMap = {
      'anterior cruciate ligament': 'anterior cruciate ligament',
      'acl': 'anterior cruciate ligament',
      'posterior cruciate ligament': 'posterior cruciate ligament',
      'pcl': 'posterior cruciate ligament',
      'medial collateral ligament': 'medial collateral ligament',
      'mcl': 'medial collateral ligament',
      'lateral collateral ligament': 'lateral collateral ligament',
      'lcl': 'lateral collateral ligament',
      'meniscal': 'meniscus',
      'meniscus': 'meniscus',
      'rotator cuff': 'rotator cuff',
      'labral': 'labrum',
      'labrum': 'labrum',
      'fracture': 'fracture',
      'dislocation': 'dislocation',
      'osteoarthritis': 'osteoarthritis',
      'tendinitis': 'tendinitis',
      'tendinopathy': 'tendinopathy',
      'bursitis': 'bursitis',
      'impingement': 'impingement',
      'plantar fasciitis': 'plantar fasciitis',
      'carpal tunnel': 'carpal tunnel syndrome',
      'sciatica': 'sciatica',
      'disc herniation': 'disc herniation',
      'herniated disc': 'disc herniation',
      'frozen shoulder': 'frozen shoulder',
      'adhesive capsulitis': 'adhesive capsulitis',
      'tennis elbow': 'tennis elbow',
      'achilles': 'achilles tendon',
      'femoroacetabular': 'femoroacetabular impingement',
      'sprain': 'sprain',
      'strain': 'strain',
    };

    for (const [keyword, diagnosis] of Object.entries(diagnosisMap)) {
      if (text.includes(keyword) && !diagnoses.includes(diagnosis)) {
        diagnoses.push(diagnosis);
      }
    }

    return diagnoses.slice(0, 3);
  }

  calculateTimeSinceTriage(caseData) {
    const triageTime = new Date(caseData.timestamp);
    const now = new Date();
    const diffMs = now - triageTime;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} days, ${diffHours % 24} hours`;
    return `${diffHours} hours`;
  }

  getConfidence(task) {
    // Override base confidence with triage-specific expertise
    const triageTasks = ['triage_assessment', 'routing', 'coordination', 'case_management', 'consultation'];
    const isTriageTask = triageTasks.some(t => task.toLowerCase().includes(t.toLowerCase()));

    // Base confidence starts higher for triage-related tasks
    let baseConfidence = isTriageTask ? 0.82 : 0.48;

    // Experience bonus (up to 0.2)
    const experienceBonus = Math.min(this.experience * 0.005, 0.2);

    // Historical accuracy bonus based on successful case routing
    const accuracyBonus = this.caseHistory.length > 0
      ? Math.min(this.caseHistory.length * 0.008, 0.05)
      : 0;

    return Math.min(baseConfidence + experienceBonus + accuracyBonus, 0.95);
  }

  getCaseStatistics() {
    const total = this.caseHistory.length;
    const byUrgency = {};
    const byStatus = {};
    
    for (const [caseId, caseData] of this.caseQueue) {
      byUrgency[caseData.urgencyLevel] = (byUrgency[caseData.urgencyLevel] || 0) + 1;
      byStatus[caseData.status] = (byStatus[caseData.status] || 0) + 1;
    }
    
    return {
      totalCases: total,
      activeCases: this.caseQueue.size,
      urgencyDistribution: byUrgency,
      statusDistribution: byStatus,
      specialistNetwork: Array.from(this.specialistNetwork.keys())
    };
  }

  async assessDataCompleteness(caseData) {
    try {
      logger.info(`${this.name} assessing data completeness for consultation`);
      
      // Core data requirements
      const coreDataScore = this.evaluateCoreData(caseData);
      
      // Specialist-specific data availability
      const specialistDataAvailability = this.evaluateSpecialistData(caseData);
      
      // Calculate overall completeness
      const overallCompleteness = this.calculateOverallCompleteness(coreDataScore, specialistDataAvailability);
      
      // Determine which specialists can provide value
      const viableSpecialists = this.determineViableSpecialists(caseData, specialistDataAvailability);
      
      // Generate follow-up questions for missing data
      const suggestedQuestions = this.generateFollowUpQuestions(caseData, specialistDataAvailability);
      
      // Assess if we can infer missing data
      const inferenceCapability = this.assessInferenceCapability(caseData);
      
      return {
        completeness: overallCompleteness,
        coreDataScore,
        specialistDataAvailability,
        recommendedSpecialists: viableSpecialists,
        suggestedFollowUp: suggestedQuestions,
        canInfer: inferenceCapability,
        confidence: this.calculateTriageConfidence(overallCompleteness, viableSpecialists.length),
        minimumDataMet: coreDataScore >= 0.3
      };
    } catch (error) {
      logger.error(`Error assessing data completeness: ${error.message}`);
      return {
        completeness: 0,
        coreDataScore: 0,
        specialistDataAvailability: {},
        recommendedSpecialists: ['triage'],
        suggestedFollowUp: ['Please provide more information about your symptoms'],
        canInfer: false,
        confidence: 0.3,
        minimumDataMet: false
      };
    }
  }

  evaluateCoreData(caseData) {
    let score = 0;
    const weights = {
      symptoms: 0.25,
      primaryComplaint: 0.20,
      painLevel: 0.15,
      duration: 0.10,
      age: 0.10,
      location: 0.10,
      history: 0.10
    };
    
    if (caseData.symptoms || caseData.primaryComplaint) score += weights.symptoms;
    if (caseData.primaryComplaint) score += weights.primaryComplaint;
    if (caseData.painLevel !== undefined) score += weights.painLevel;
    if (caseData.duration) score += weights.duration;
    if (caseData.age !== undefined) score += weights.age;
    if (caseData.location) score += weights.location;
    if (caseData.history) score += weights.history;
    
    return Math.min(score, 1);
  }

  evaluateSpecialistData(caseData) {
    return {
      painWhisperer: {
        available: !!(caseData.painData || caseData.painLevel !== undefined),
        completeness: this.calculatePainDataCompleteness(caseData),
        critical: caseData.painLevel > 6
      },
      movementDetective: {
        available: !!(caseData.movementData || caseData.movementDysfunction || caseData.gaitProblems),
        completeness: this.calculateMovementDataCompleteness(caseData),
        critical: caseData.movementDysfunction === true
      },
      strengthSage: {
        available: !!(caseData.functionalData || caseData.functionalLimitations || caseData.strengthDeficits),
        completeness: this.calculateFunctionalDataCompleteness(caseData),
        critical: caseData.functionalLimitations === true
      },
      mindMender: {
        available: !!(caseData.psychData || caseData.anxietyLevel !== undefined || caseData.psychologicalFactors),
        completeness: this.calculatePsychDataCompleteness(caseData),
        critical: caseData.anxietyLevel > 7 || caseData.psychologicalFactors === true
      }
    };
  }

  calculatePainDataCompleteness(caseData) {
    let score = 0;
    if (caseData.painLevel !== undefined) score += 0.3;
    if (caseData.painData?.location) score += 0.2;
    if (caseData.painData?.quality) score += 0.2;
    if (caseData.painData?.triggers) score += 0.15;
    if (caseData.painData?.relievers) score += 0.15;
    return score;
  }

  calculateMovementDataCompleteness(caseData) {
    let score = 0;
    if (caseData.movementDysfunction !== undefined) score += 0.25;
    if (caseData.gaitProblems !== undefined) score += 0.25;
    if (caseData.movementData?.restrictions) score += 0.25;
    if (caseData.movementData?.patterns) score += 0.25;
    return score;
  }

  calculateFunctionalDataCompleteness(caseData) {
    let score = 0;
    if (caseData.functionalLimitations !== undefined) score += 0.25;
    if (caseData.functionalData?.limitations) score += 0.25;
    if (caseData.functionalData?.goals) score += 0.25;
    if (caseData.strengthDeficits !== undefined) score += 0.25;
    return score;
  }

  calculatePsychDataCompleteness(caseData) {
    let score = 0;
    if (caseData.anxietyLevel !== undefined) score += 0.25;
    if (caseData.psychologicalFactors !== undefined) score += 0.25;
    if (caseData.psychData?.fearAvoidance !== undefined) score += 0.25;
    if (caseData.psychData?.copingStrategies) score += 0.25;
    return score;
  }

  calculateOverallCompleteness(coreScore, specialistData) {
    const specialistScores = Object.values(specialistData).map(s => s.completeness);
    const avgSpecialistScore = specialistScores.reduce((sum, s) => sum + s, 0) / specialistScores.length;
    
    // Core data is 60% of score, specialist data is 40%
    return (coreScore * 0.6) + (avgSpecialistScore * 0.4);
  }

  determineViableSpecialists(caseData, specialistDataAvailability) {
    const specialists = [];
    
    // Always include triage for coordination
    specialists.push('triage');
    
    // Add specialists based on data availability and criticality
    for (const [specialist, data] of Object.entries(specialistDataAvailability)) {
      if (data.critical || (data.available && data.completeness >= 0.3)) {
        specialists.push(specialist);
      } else if (data.completeness >= 0.1 && this.canInferSpecialistNeeds(caseData, specialist)) {
        specialists.push(specialist);
      }
    }
    
    // If very limited data, just use triage and primary specialist
    if (specialists.length === 1 && caseData.primaryComplaint) {
      const primary = this.extractSpecialistRecommendations(caseData.primaryComplaint)[0];
      if (primary) specialists.push(primary);
    }
    
    return [...new Set(specialists)]; // Remove duplicates
  }

  canInferSpecialistNeeds(caseData, specialist) {
    // Check if we can reasonably infer this specialist is needed
    const symptoms = (caseData.symptoms || '').toLowerCase();
    const complaint = (caseData.primaryComplaint || '').toLowerCase();
    const combined = symptoms + ' ' + complaint;

    switch(specialist) {
      case 'painWhisperer':
        return combined.includes('pain') || combined.includes('hurt') || combined.includes('ache');
      case 'movementDetective':
        return combined.includes('walk') || combined.includes('move') || combined.includes('stiff');
      case 'strengthSage':
        return combined.includes('weak') || combined.includes('strength') || combined.includes('function');
      case 'mindMender':
        // Enhanced MindMender inference - psychological factors, chronic conditions, athlete concerns
        return combined.includes('stress') || combined.includes('anxious') || combined.includes('worried') ||
               combined.includes('scared') || combined.includes('nervous') || combined.includes('fear') ||
               combined.includes('chronic') || combined.includes('sleep') ||
               combined.includes('athlete') || combined.includes('sport') ||
               combined.includes('surgery') || combined.includes('post-op') ||
               combined.includes('re-injury') || combined.includes('recurring');
      default:
        return false;
    }
  }

  generateFollowUpQuestions(caseData, specialistDataAvailability) {
    const questions = [];
    
    // Core data questions
    if (!caseData.painLevel && caseData.primaryComplaint?.includes('pain')) {
      questions.push('On a scale of 1-10, how would you rate your pain?');
    }
    
    if (!caseData.duration) {
      questions.push('How long have you been experiencing these symptoms?');
    }
    
    if (!caseData.location && !caseData.painData?.location) {
      questions.push('Where specifically are you experiencing discomfort?');
    }
    
    // Specialist-specific questions based on low completeness
    if (specialistDataAvailability.painWhisperer.completeness < 0.5 &&
        specialistDataAvailability.painWhisperer.critical) {
      questions.push('Can you describe the nature of your pain (sharp, dull, burning, throbbing)?');
      questions.push('What activities or positions make your pain better or worse?');
    }

    if (specialistDataAvailability.movementDetective.completeness < 0.5 &&
        (caseData.movementDysfunction || this.canInferSpecialistNeeds(caseData, 'movementDetective'))) {
      questions.push('Have you noticed any specific movements that are difficult or cause symptoms?');
      questions.push('Are you experiencing any issues with walking, balance, or coordination?');
    }

    if (specialistDataAvailability.strengthSage.completeness < 0.5 &&
        (caseData.functionalLimitations || this.canInferSpecialistNeeds(caseData, 'strengthSage'))) {
      questions.push('What daily activities are you having difficulty performing?');
      questions.push('Have you noticed any muscle weakness or loss of strength?');
    }

    if (specialistDataAvailability.mindMender.completeness < 0.3 &&
        caseData.anxietyLevel > 5) {
      questions.push('How is this condition affecting your mood and mental well-being?');
      questions.push('Are you experiencing any fear or anxiety about movement or activities?');
    }
    
    // Limit to top 3 most relevant questions
    return questions.slice(0, 3);
  }

  assessInferenceCapability(caseData) {
    // Can we make reasonable inferences from available data?
    const hasSymptoms = !!(caseData.symptoms || caseData.primaryComplaint);
    const hasPainInfo = caseData.painLevel !== undefined || caseData.painData;
    const hasContext = !!(caseData.history || caseData.duration || caseData.location);
    
    return hasSymptoms && (hasPainInfo || hasContext);
  }

  /**
   * Heuristic query type classifier — no LLM call.
   * Returns { queryType: 'clinical'|'informational', confidence, signals }
   */
  classifyQueryType(caseData) {
    const query = (caseData.rawQuery || caseData.primaryComplaint || '').toLowerCase();
    const clinicalSignals = [];
    const informationalSignals = [];

    // --- Clinical signal detection ---

    // Personal timeline: "for 3 weeks", "since last Monday", "2 weeks ago"
    if (/\b(for\s+\d+\s+(day|week|month|year)s?|since\s+(last\s+)?\w+day|\d+\s+(day|week|month|year)s?\s+ago)\b/i.test(query)) {
      clinicalSignals.push('personal_timeline');
    }

    // Pain severity: painLevel field or "pain 7/10" in text
    if (caseData.painLevel !== undefined || /\bpain\s+\d+\s*\/\s*10\b/i.test(query) || /\b\d+\s*\/\s*10\s*(pain)?\b/i.test(query)) {
      clinicalSignals.push('pain_severity');
    }

    // Injury mechanism: "I fell", "I twisted", "accident"
    if (/\b(i\s+(fell|twisted|slipped|tripped|landed|hit|crashed|dislocated)|accident|injury|injured)\b/i.test(query)) {
      clinicalSignals.push('injury_mechanism');
    }

    // Functional limitation: "I can't walk", "unable to", "swollen"
    if (/\b(i\s+can'?t|unable\s+to|cannot|swollen|swelling|limping|can'?t\s+(walk|move|lift|bend|sleep))\b/i.test(query)) {
      clinicalSignals.push('functional_limitation');
    }

    // Treatment history: "my doctor", "prescribed", "post-op", "surgery ... ago"
    if (/\b(my\s+(doctor|surgeon|physio|therapist|orthopedist)|prescribed|post-op|post\s*operative|had\s+surgery)\b/i.test(query)) {
      clinicalSignals.push('treatment_history');
    }

    // Structured case data: age, duration, location fields present
    if (caseData.age !== undefined && caseData.duration && caseData.location) {
      clinicalSignals.push('structured_case_data');
    }

    // --- Informational signal detection ---

    // Explanation-seeking prefix
    if (/^(why\s+does|what\s+is|what\s+causes|how\s+does|is\s+it\s+normal)\b/i.test(query)) {
      informationalSignals.push('explanation_seeking_prefix');
    }

    // Research seeking
    if (/\b(latest|research|studies|evidence|guidelines|literature|meta-analysis)\b/i.test(query)) {
      informationalSignals.push('research_seeking');
    }

    // General phenomenon (without first-person)
    if (/\b(people|patients|generally|typically|common|average)\b/i.test(query) && !/\b(i|my|me|i'm|i've)\b/i.test(query)) {
      informationalSignals.push('general_phenomenon');
    }

    // Comparison query
    if (/\b(vs\.?|versus|compared\s+to|difference\s+between)\b/i.test(query)) {
      informationalSignals.push('comparison_query');
    }

    // Recovery timeline general — fires ONLY without personal injury context
    if (/\b(how\s+long\s+(does|until|before|will|for)|when\s+can\s+(i|you)\s+return|recovery\s+time|return\s+to\s+(sport|activity|play|work|running|basketball|football|soccer|tennis))\b/i.test(query)) {
      // Only informational if no clinical signals already detected
      if (clinicalSignals.length === 0) {
        informationalSignals.push('recovery_timeline_general');
      }
    }

    // --- Decision logic ---
    const numClinical = clinicalSignals.length;
    const numInformational = informationalSignals.length;

    let queryType, confidence;

    if (numClinical >= 2) {
      queryType = 'clinical';
      confidence = 0.85;
    } else if (numClinical === 1 && numInformational === 0) {
      queryType = 'clinical';
      confidence = 0.7;
    } else if (numInformational >= 1 && numClinical === 0) {
      queryType = 'informational';
      confidence = 0.8;
    } else if (numClinical > 0 && numInformational > 0) {
      // Mixed signals → clinical (safety default)
      queryType = 'clinical';
      confidence = 0.55;
    } else {
      // No signals → clinical (safety default)
      queryType = 'clinical';
      confidence = 0.5;
    }

    return {
      queryType,
      confidence,
      signals: {
        clinical: clinicalSignals,
        informational: informationalSignals
      }
    };
  }

  calculateTriageConfidence(completeness, specialistCount) {
    // Base confidence on data completeness and specialist availability
    const baseConfidence = completeness;
    const specialistBonus = Math.min(specialistCount * 0.1, 0.3);
    
    return Math.min(baseConfidence + specialistBonus, 0.95);
  }

  getSpecialistCoverage(caseData, consultedSpecialists = []) {
    const allSpecialists = ['triage', 'painWhisperer', 'movementDetective', 'strengthSage', 'mindMender'];
    const coverage = {};

    for (const specialist of allSpecialists) {
      coverage[specialist] = consultedSpecialists.includes(specialist);
    }

    return coverage;
  }
}

export default TriageAgent;