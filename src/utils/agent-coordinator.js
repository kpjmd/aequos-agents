import logger from './logger.js';
import { agentConfig } from '../config/agent-config.js';
import promptManager from './prompt-manager.js';
import { CoordinationConference } from './coordination-conference.js';
import { PredictionMarket } from './prediction-market.js';

export class AgentCoordinator {
  constructor(tokenManager = null) {
    this.specialists = new Map();
    this.activeConsultations = new Map();
    this.coordinationHistory = [];
    this.performanceMetrics = new Map();
    this.coordinationConference = new CoordinationConference();
    this.tokenManager = tokenManager;
    this.predictionMarket = tokenManager ? new PredictionMarket(tokenManager) : null;
    this.consultationPayments = new Map(); // Track payment flows
  }

  registerSpecialist(type, agent) {
    this.specialists.set(type, agent);
    
    // Initialize performance tracking
    this.performanceMetrics.set(type, {
      consultations: 0,
      successRate: 0,
      averageResponseTime: 0,
      patientSatisfaction: 0,
      tokenBalance: agent.tokenBalance,
      experience: agent.experience
    });
    
    logger.info(`AgentCoordinator: Registered ${type} specialist - ${agent.name}`);
  }

  async coordinateMultiSpecialistConsultation(caseData, requiredSpecialists = [], options = {}) {
    try {
      const {
        mode = 'normal',
        consultationId: passedConsultationId,
        rawQuery,
        enableDualTrack,
        userId,
        isReturningUser,
        priorConsultations,
        requestResearch,
        uploadedImages,
        athleteProfile,
        platformContext
      } = options; // Extract dual-track fields

      // Use passed consultationId if provided, otherwise generate new one
      const consultationId = passedConsultationId || `consultation_${Date.now()}`;

      logger.info(`Starting multi-specialist consultation: ${consultationId} (${mode} mode, dual-track: ${enableDualTrack})`);

      // Validate required specialists are available
      const availableSpecialists = this.validateSpecialistAvailability(requiredSpecialists);

      if (availableSpecialists.length === 0) {
        throw new Error('No required specialists available for consultation');
      }

      // Create consultation session with dual-track data
      const consultation = {
        id: consultationId,
        caseData,
        rawQuery,
        enableDualTrack,
        userId,
        isReturningUser,
        priorConsultations,
        requestResearch,
        uploadedImages,
        athleteProfile,
        platformContext,
        requiredSpecialists,
        availableSpecialists,
        responses: new Map(),
        startTime: new Date().toISOString(),
        status: 'in_progress',
        mode
      };

      this.activeConsultations.set(consultationId, consultation);

      // PHASE 1: Initiate prediction market (non-blocking for performance)
      let predictionData = null;
      if (this.predictionMarket) {
        const participatingAgents = availableSpecialists
          .map(type => this.specialists.get(type))
          .filter(agent => agent);

        // Async initiation without await - predictions happen in parallel
        this.predictionMarket.initiatePredictions(
          consultationId,
          caseData,
          participatingAgents
        ).then(predictions => {
          predictionData = predictions;
          logger.info(`Predictions initiated: ${predictions.totalPredictions} predictions, ${predictions.totalStaked} tokens staked`);
        }).catch(error => {
          logger.error(`Prediction initiation failed: ${error.message}`);
        });
      }

      // PHASE 2: Process consultation payments (async, non-blocking)
      if (this.tokenManager) {
        this.processConsultationPayments(
          consultationId,
          availableSpecialists,
          caseData
        ).catch(error => {
          logger.error(`Consultation payment processing failed: ${error.message}`);
        });
      }

      // Collect responses with appropriate mode settings - optimized for reliability
      const collectionOptions = {
        fastMode: mode === 'fast',
        timeout: mode === 'fast' ? 35000 : 50000, // 35s fast, 50s normal to accommodate Claude + coordination
        minResponses: mode === 'fast' ? 2 : availableSpecialists.length,
        rawQuery,
        enableDualTrack
      };

      const responses = await this.collectSpecialistResponses(consultation, collectionOptions);

      // Task 1.3: Conduct coordination conference for inter-agent dialogue
      let coordinationMetadata = null;
      if (responses.size >= 2) {
        try {
          logger.info('Conducting coordination conference round');
          coordinationMetadata = await this.coordinationConference.conductConferenceRound(
            responses,
            this.specialists,
            caseData
          );
          logger.info(`Conference complete: ${coordinationMetadata.interAgentDialogue.length} dialogues, ${coordinationMetadata.disagreements.length} disagreements`);
        } catch (error) {
          logger.error(`Coordination conference error: ${error.message}`);
          coordinationMetadata = {
            interAgentDialogue: [],
            disagreements: [],
            emergentFindings: [],
            error: error.message
          };
        }
      }

      // Synthesize recommendations with coordination metadata
      const synthesizedRecommendations = await this.synthesizeRecommendations(responses, caseData, coordinationMetadata);

      // Update consultation
      consultation.responses = responses;
      consultation.synthesizedRecommendations = synthesizedRecommendations;
      consultation.endTime = new Date().toISOString();
      consultation.status = 'completed';

      // PHASE 3: Resolve inter-agent predictions (guaranteed resolution)
      // This provides baseline prediction accuracy using agent consensus
      if (this.predictionMarket) {
        this.resolveInterAgentPredictions(
          consultationId,
          responses,
          coordinationMetadata
        ).catch(error => {
          logger.error(`Inter-agent prediction resolution failed: ${error.message}`);
        });
      }

      // Update performance metrics
      this.updatePerformanceMetrics(consultation);
      
      // Store in history
      this.coordinationHistory.push({
        consultationId,
        caseType: caseData.type || 'unknown',
        specialistsInvolved: availableSpecialists,
        duration: this.calculateDuration(consultation.startTime, consultation.endTime),
        success: true,
        mode,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Completed multi-specialist consultation: ${consultationId} in ${this.calculateDuration(consultation.startTime, consultation.endTime)}ms`);
      
      return {
        consultationId,
        caseData,
        synthesizedRecommendations,
        participatingSpecialists: availableSpecialists,
        responses: Array.from(responses.values()),
        coordinationSummary: this.generateCoordinationSummary(consultation),
        mode,
        duration: this.calculateDuration(consultation.startTime, consultation.endTime)
      };
    } catch (error) {
      logger.error(`Error in multi-specialist consultation: ${error.message}`);
      throw error;
    }
  }

  async routeCaseToAppropriateSpecialists(caseData) {
    try {
      logger.info('Routing case to appropriate specialists');
      
      // Analyze case to determine required specialists
      const specialistRecommendations = await this.analyzeSpecialistNeeds(caseData);
      
      // Validate specialist availability and capacity
      const routingPlan = this.createRoutingPlan(specialistRecommendations);
      
      // Execute routing
      const routingResults = await this.executeRouting(caseData, routingPlan);
      
      return {
        caseId: caseData.id || `case_${Date.now()}`,
        specialistRecommendations,
        routingPlan,
        routingResults,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error routing case: ${error.message}`);
      throw error;
    }
  }

  async manageSpecialistWorkload() {
    try {
      logger.info('Managing specialist workload distribution');
      
      const workloadAnalysis = new Map();
      
      for (const [type, specialist] of this.specialists) {
        const metrics = this.performanceMetrics.get(type);
        const currentLoad = await this.assessSpecialistLoad(specialist);
        
        workloadAnalysis.set(type, {
          currentLoad,
          capacity: this.calculateCapacity(specialist),
          efficiency: metrics.successRate,
          availability: this.assessAvailability(currentLoad)
        });
      }
      
      // Identify load balancing opportunities
      const recommendations = this.generateLoadBalancingRecommendations(workloadAnalysis);
      
      return {
        workloadAnalysis: Object.fromEntries(workloadAnalysis),
        recommendations,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error managing specialist workload: ${error.message}`);
      throw error;
    }
  }

  validateSpecialistAvailability(requiredSpecialists) {
    const available = [];
    
    for (const specialistType of requiredSpecialists) {
      if (this.specialists.has(specialistType)) {
        const specialist = this.specialists.get(specialistType);
        const metrics = this.performanceMetrics.get(specialistType);
        
        // Check if specialist is available based on current load
        if (this.isSpecialistAvailable(specialist, metrics)) {
          available.push(specialistType);
        }
      }
    }
    
    return available;
  }

  async collectSpecialistResponses(consultation, options = {}) {
    const responses = new Map();
    const { 
      timeout = 50000,  // 50 second default timeout per agent (optimized for reliability)
      fastMode = false, // Fast mode returns when minimum agents respond
      minResponses = 3  // Minimum responses needed in fast mode
    } = options;
    
    // Create promises for all specialists with timeout
    logger.info(`Available specialists for consultation: ${consultation.availableSpecialists.join(', ')}`);
    logger.info(`Registered specialists: ${Array.from(this.specialists.keys()).join(', ')}`);
    
    const responsePromises = consultation.availableSpecialists.map(async (specialistType) => {
      const specialist = this.specialists.get(specialistType);
      
      if (!specialist) {
        logger.error(`Specialist not found: ${specialistType}`);
        return { specialistType, response: { error: 'Specialist not found' }, status: 'failed' };
      }
      
      try {
        // Add timeout to each specialist call
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        );
        
        const responsePromise = this.getSpecialistResponse(
          specialist,
          consultation.caseData,
          consultation.id,
          {
            mode: options.fastMode ? 'fast' : 'normal',
            timeout,
            rawQuery: consultation.rawQuery,
            enableDualTrack: consultation.enableDualTrack
          }
        );
        
        // Race between response and timeout
        const response = await Promise.race([responsePromise, timeoutPromise]);
        
        responses.set(specialistType, response);
        this.recordSpecialistPerformance(specialistType, response);
        
        return { specialistType, response, status: 'success' };
        
      } catch (error) {
        logger.error(`Error getting response from ${specialistType}: ${error.message}`);
        const errorResponse = {
          error: error.message,
          status: 'failed',
          timestamp: new Date().toISOString()
        };
        responses.set(specialistType, errorResponse);
        
        return { specialistType, response: errorResponse, status: 'failed' };
      }
    });
    
    if (fastMode && minResponses < consultation.availableSpecialists.length) {
      // Fast mode: Return as soon as minimum responses are received
      const completed = [];
      const remaining = [...responsePromises];
      
      while (completed.length < minResponses && remaining.length > 0) {
        const result = await Promise.race(remaining);
        completed.push(result);
        
        // Remove completed promise from remaining
        const index = remaining.findIndex(p => p === result);
        if (index > -1) remaining.splice(index, 1);
        
        // Check if we have enough successful responses
        const successCount = completed.filter(r => r.status === 'success').length;
        if (successCount >= minResponses) {
          logger.info(`Fast mode: Returning with ${successCount} successful responses`);
          break;
        }
      }
      
      // Continue collecting remaining responses in background
      Promise.allSettled(remaining).then(results => {
        logger.debug(`Background: Collected ${results.length} additional responses`);
      });
      
    } else {
      // Normal mode: Wait for all responses
      await Promise.allSettled(responsePromises);
    }
    
    logger.info(`Collected ${responses.size} specialist responses (${options.fastMode ? 'fast' : 'normal'} mode)`);
    return responses;
  }

  async getSpecialistResponse(specialist, caseData, consultationId, options = {}) {
    const startTime = Date.now();
    const { mode = 'normal', timeout = 50000, rawQuery, enableDualTrack } = options;

    try {
      let response;
      let dataCompleteness = 1.0; // Default to full completeness

      // Build dual-track context for agent
      const dualTrackContext = {
        mode: mode === 'fast' ? 'fast' : 'normal',
        timeout: timeout,
        consultationId,
        type: 'multi_specialist_consultation',
        rawQuery,
        enableDualTrack
      };

      // Use prompt manager for optimized prompts in fast mode
      if (mode === 'fast') {
        const prompt = promptManager.getSpecialistPrompt(
          specialist.agentType || specialist.name.toLowerCase(),
          caseData,
          'fast'
        );

        response = await specialist.processMessage(prompt, dualTrackContext);
      } else {
        // Enhanced routing logic with graceful data handling - route by specialist type first
        const specialistType = specialist.agentType || specialist.name.toLowerCase();
        
        logger.info(`Routing specialist: ${specialist.name}, agentType: ${specialist.agentType}, specialistType: ${specialistType}`);
        
        // Route to specialist-specific methods based on specialist type (NOT inheritance fallback)
        if (specialist.triageCase && (specialistType.includes('triage') || specialistType === 'triage')) {
          // Create enhanced case data with dual-track info
          const enhancedCaseData = { ...caseData, rawQuery, enableDualTrack };
          response = await specialist.triageCase(enhancedCaseData, dualTrackContext);
          dataCompleteness = 1.0;
        } else if (specialist.assessPain && (specialistType.includes('pain') || specialistType.includes('whisperer') || specialistType === 'painWhisperer')) {
          // Check for pain-specific data
          if (caseData.painData) {
            const enhancedPainData = { ...caseData.painData, rawQuery, enableDualTrack };
            response = await specialist.assessPain(enhancedPainData, dualTrackContext);
            dataCompleteness = 1.0;
          } else if (caseData.painLevel !== undefined || caseData.symptoms?.includes('pain')) {
            // Create adapted pain data from available information
            const adaptedPainData = this.adaptPainData(caseData);
            const enhancedPainData = { ...adaptedPainData, rawQuery, enableDualTrack };
            response = await specialist.assessPain(enhancedPainData, dualTrackContext);
            dataCompleteness = 0.5;
          } else {
            // Use general case data with low confidence
            const enhancedCaseData = { ...caseData, rawQuery, enableDualTrack };
            response = await specialist.assessPain(enhancedCaseData, dualTrackContext);
            dataCompleteness = 0.3;
          }
        } else if (specialist.analyzeMovementPattern && (specialistType.includes('movement') || specialistType.includes('detective') || specialistType === 'movementDetective')) {
          // Check for movement-specific data
          if (caseData.movementData) {
            const enhancedMovementData = { ...caseData.movementData, rawQuery, enableDualTrack };
            response = await specialist.analyzeMovementPattern(enhancedMovementData, dualTrackContext);
            dataCompleteness = 1.0;
          } else if (caseData.movementDysfunction || caseData.gaitProblems ||
                     this.inferMovementIssues(caseData)) {
            // Create adapted movement data
            const adaptedMovementData = this.adaptMovementData(caseData);
            const enhancedMovementData = { ...adaptedMovementData, rawQuery, enableDualTrack };
            response = await specialist.analyzeMovementPattern(enhancedMovementData, dualTrackContext);
            dataCompleteness = 0.5;
          } else {
            // Use general case data
            const enhancedCaseData = { ...caseData, rawQuery, enableDualTrack };
            response = await specialist.analyzeMovementPattern(enhancedCaseData, dualTrackContext);
            dataCompleteness = 0.3;
          }
        } else if (specialist.assessFunctionalCapacity && (specialistType.includes('strength') || specialistType.includes('sage') || specialistType === 'strengthSage')) {
          // Check for functional-specific data
          if (caseData.functionalData) {
            const enhancedFunctionalData = { ...caseData.functionalData, rawQuery, enableDualTrack };
            response = await specialist.assessFunctionalCapacity(enhancedFunctionalData, dualTrackContext);
            dataCompleteness = 1.0;
          } else if (caseData.functionalLimitations || caseData.strengthDeficits) {
            // Create adapted functional data
            const adaptedFunctionalData = this.adaptFunctionalData(caseData);
            const enhancedFunctionalData = { ...adaptedFunctionalData, rawQuery, enableDualTrack };
            response = await specialist.assessFunctionalCapacity(enhancedFunctionalData, dualTrackContext);
            dataCompleteness = 0.6;
          } else {
            // Use general case data
            const enhancedCaseData = { ...caseData, rawQuery, enableDualTrack };
            response = await specialist.assessFunctionalCapacity(enhancedCaseData, dualTrackContext);
            dataCompleteness = 0.3;
          }
        } else if (specialist.assessPsychologicalFactors && (specialistType.includes('mind') || specialistType.includes('mender') || specialistType === 'mindMender')) {
          // Check for psychological-specific data
          if (caseData.psychData) {
            const enhancedPsychData = { ...caseData.psychData, rawQuery, enableDualTrack };
            response = await specialist.assessPsychologicalFactors(enhancedPsychData, dualTrackContext);
            dataCompleteness = 1.0;
          } else if (caseData.anxietyLevel !== undefined || caseData.psychologicalFactors) {
            // Create adapted psychological data
            const adaptedPsychData = this.adaptPsychologicalData(caseData);
            const enhancedPsychData = { ...adaptedPsychData, rawQuery, enableDualTrack };
            response = await specialist.assessPsychologicalFactors(enhancedPsychData, dualTrackContext);
            dataCompleteness = 0.5;
          } else if (this.inferPsychologicalConcerns(caseData)) {
            // Infer psychological aspects from symptoms
            const inferredPsychData = this.inferPsychologicalData(caseData);
            const enhancedPsychData = { ...inferredPsychData, rawQuery, enableDualTrack };
            response = await specialist.assessPsychologicalFactors(enhancedPsychData, dualTrackContext);
            dataCompleteness = 0.3;
          } else {
            // Skip this specialist if no relevant data
            logger.info(`Skipping ${specialist.name} due to insufficient psychological data`);
            return {
              specialist: specialist.name,
              response: 'Insufficient data for psychological assessment',
              responseTime: Date.now() - startTime,
              confidence: 0.1,
              dataCompleteness: 0,
              timestamp: new Date().toISOString(),
              status: 'skipped'
            };
          }
        } else {
          // Fallback - create consultation-specific response based on specialist type
          response = await this.getConsultationSpecificResponse(specialist, caseData, consultationId);
          dataCompleteness = 0.5;
        }
      }
      
      const responseTime = Date.now() - startTime;
      
      // Adjust confidence based on data completeness
      const baseConfidence = specialist.getConfidence('consultation');
      const adjustedConfidence = baseConfidence * (0.5 + (dataCompleteness * 0.5));
      
      return {
        specialist: specialist.name,
        response,
        responseTime,
        confidence: adjustedConfidence,
        dataCompleteness,
        timestamp: new Date().toISOString(),
        status: 'success'
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        specialist: specialist.name,
        error: error.message,
        responseTime,
        timestamp: new Date().toISOString(),
        status: 'failed'
      };
    }
  }

  // Data adaptation methods for missing specialist-specific data
  adaptPainData(caseData) {
    return {
      painLevel: caseData.painLevel || this.inferPainLevel(caseData),
      location: caseData.location || 'unspecified',
      quality: this.inferPainQuality(caseData),
      triggers: this.extractTriggers(caseData),
      duration: caseData.duration || 'unknown',
      ...caseData
    };
  }

  adaptMovementData(caseData) {
    return {
      movementDysfunction: caseData.movementDysfunction || false,
      gaitProblems: caseData.gaitProblems || false,
      restrictions: this.extractMovementRestrictions(caseData),
      patterns: [],
      ...caseData
    };
  }

  adaptFunctionalData(caseData) {
    return {
      functionalLimitations: caseData.functionalLimitations || [],
      goals: caseData.goals || [],
      strengthDeficits: caseData.strengthDeficits || false,
      dailyActivities: this.extractDailyActivities(caseData),
      ...caseData
    };
  }

  adaptPsychologicalData(caseData) {
    return {
      anxietyLevel: caseData.anxietyLevel || 5,
      fearAvoidance: false,
      copingStrategies: [],
      mood: 'unknown',
      ...caseData
    };
  }

  // Inference helper methods
  inferMovementIssues(caseData) {
    const symptoms = (caseData.symptoms || '').toLowerCase();
    const complaint = (caseData.primaryComplaint || '').toLowerCase();
    return symptoms.includes('walk') || symptoms.includes('move') || 
           complaint.includes('stiff') || complaint.includes('mobility');
  }

  inferPsychologicalConcerns(caseData) {
    const symptoms = (caseData.symptoms || '').toLowerCase();
    const highPain = caseData.painLevel > 7;
    const chronicCondition = caseData.duration === 'chronic';
    return symptoms.includes('stress') || symptoms.includes('worry') || 
           symptoms.includes('sleep') || (highPain && chronicCondition);
  }

  inferPsychologicalData(caseData) {
    return {
      anxietyLevel: caseData.painLevel > 7 ? 7 : 5,
      fearAvoidance: caseData.duration === 'chronic',
      mood: caseData.painLevel > 5 ? 'affected' : 'stable',
      inferredFromSymptoms: true,
      ...caseData
    };
  }

  inferPainLevel(caseData) {
    const symptoms = (caseData.symptoms || '').toLowerCase();
    if (symptoms.includes('severe') || symptoms.includes('excruciating')) return 9;
    if (symptoms.includes('moderate')) return 6;
    if (symptoms.includes('mild')) return 3;
    return 5; // Default moderate
  }

  inferPainQuality(caseData) {
    const symptoms = (caseData.symptoms || '').toLowerCase();
    if (symptoms.includes('sharp')) return 'sharp';
    if (symptoms.includes('burn')) return 'burning';
    if (symptoms.includes('throb')) return 'throbbing';
    if (symptoms.includes('ache')) return 'aching';
    return 'unspecified';
  }

  extractTriggers(caseData) {
    const triggers = [];
    const symptoms = (caseData.symptoms || '').toLowerCase();
    if (symptoms.includes('walk')) triggers.push('walking');
    if (symptoms.includes('sit')) triggers.push('sitting');
    if (symptoms.includes('stand')) triggers.push('standing');
    if (symptoms.includes('climb')) triggers.push('stairs');
    return triggers;
  }

  extractMovementRestrictions(caseData) {
    const restrictions = [];
    const symptoms = (caseData.symptoms || '').toLowerCase();
    if (symptoms.includes('bend')) restrictions.push('bending');
    if (symptoms.includes('twist')) restrictions.push('twisting');
    if (symptoms.includes('reach')) restrictions.push('reaching');
    if (symptoms.includes('lift')) restrictions.push('lifting');
    return restrictions;
  }

  extractDailyActivities(caseData) {
    const activities = [];
    const symptoms = (caseData.symptoms || '').toLowerCase();
    if (symptoms.includes('dress')) activities.push('dressing');
    if (symptoms.includes('bath')) activities.push('bathing');
    if (symptoms.includes('work')) activities.push('working');
    if (symptoms.includes('drive')) activities.push('driving');
    return activities;
  }

  async getConsultationSpecificResponse(specialist, caseData, consultationId) {
    try {
      const specialistType = specialist.agentType || specialist.name.toLowerCase();
      
      // Create specialist-focused consultation prompt
      let consultationPrompt;
      
      if (specialistType.includes('triage') || specialistType === 'triage') {
        consultationPrompt = `
          TRIAGE COORDINATION CONSULTATION:
          
          Case: ${JSON.stringify(caseData)}
          
          As the triage coordinator, provide case management guidance focusing on:
          - Urgency assessment and prioritization
          - Specialist coordination recommendations
          - Resource allocation and timeline planning
          - Risk stratification and monitoring
          - Care pathway optimization
          
          **Diagnosis:** primary:[condition], differential:[alternatives], confidence:[0-1]
          **Immediate Actions:** [coordinated care steps]
          **Red Flags:** [escalation triggers]
          **Specialist Recommendation:** [coordination plan]
          **Follow-up:** [timeline and monitoring]
          
          Confidence: [percentage]%
        `;
      } else if (specialistType.includes('pain') || specialistType.includes('whisperer') || specialistType === 'painWhisperer') {
        consultationPrompt = `
          PAIN MANAGEMENT CONSULTATION:
          
          Case: ${JSON.stringify(caseData)}
          
          As the pain management specialist, focus specifically on:
          - Pain assessment and characterization
          - Pain management strategies and interventions
          - Medication recommendations and safety
          - Non-pharmacological pain approaches
          - Pain monitoring and adjustment protocols
          
          **Diagnosis:** primary:[pain condition], differential:[pain types], confidence:[0-1]
          **Immediate Actions:** [pain management steps]
          **Red Flags:** [pain warning signs]
          **Specialist Recommendation:** [pain-focused treatment]
          **Follow-up:** [pain monitoring plan]
          
          Confidence: [percentage]%
        `;
      } else if (specialistType.includes('movement') || specialistType.includes('detective') || specialistType === 'movementDetective') {
        consultationPrompt = `
          MOVEMENT & BIOMECHANICS CONSULTATION:
          
          Case: ${JSON.stringify(caseData)}
          
          As the movement specialist, focus specifically on:
          - Movement pattern analysis and dysfunction
          - Biomechanical assessment and correction
          - Range of motion and mobility planning
          - Movement re-education strategies
          - Gait and locomotion optimization
          
          **Diagnosis:** primary:[movement dysfunction], differential:[biomechanical issues], confidence:[0-1]
          **Immediate Actions:** [movement correction steps]
          **Red Flags:** [movement warning signs]
          **Specialist Recommendation:** [movement-focused interventions]
          **Follow-up:** [movement progression plan]
          
          Confidence: [percentage]%
        `;
      } else if (specialistType.includes('strength') || specialistType.includes('sage') || specialistType === 'strengthSage') {
        consultationPrompt = `
          STRENGTH & FUNCTIONAL RESTORATION CONSULTATION:
          
          Case: ${JSON.stringify(caseData)}
          
          As the strength and functional restoration specialist, focus specifically on:
          - Functional capacity assessment and goals
          - Strength training and exercise progression
          - Return-to-activity protocols
          - Performance optimization strategies
          - Long-term conditioning and maintenance
          
          **Diagnosis:** primary:[functional limitation], differential:[strength deficits], confidence:[0-1]
          **Immediate Actions:** [strength building steps]
          **Red Flags:** [functional warning signs]
          **Specialist Recommendation:** [strength-focused program]
          **Follow-up:** [functional progression timeline]
          
          Confidence: [percentage]%
        `;
      } else if (specialistType.includes('mind') || specialistType.includes('mender') || specialistType === 'mindMender') {
        consultationPrompt = `
          PSYCHOLOGICAL RECOVERY CONSULTATION:
          
          Case: ${JSON.stringify(caseData)}
          
          As the psychological recovery specialist, focus specifically on:
          - Psychological barriers to recovery
          - Fear-avoidance and anxiety management
          - Motivation and adherence strategies
          - Coping skills and stress management
          - Mental health impact and support
          
          **Diagnosis:** primary:[psychological factors], differential:[mental health considerations], confidence:[0-1]
          **Immediate Actions:** [psychological support steps]
          **Red Flags:** [mental health warning signs]
          **Specialist Recommendation:** [psychology-focused interventions]
          **Follow-up:** [psychological support plan]
          
          Confidence: [percentage]%
        `;
      } else {
        // Generic fallback for any other specialist type
        consultationPrompt = `
          SPECIALIST CONSULTATION:
          
          Case: ${JSON.stringify(caseData)}
          
          As a ${specialist.subspecialty} specialist, provide your expert perspective on this case.
          Focus on your area of expertise and provide specific recommendations.
          
          **Diagnosis:** primary:[condition], differential:[alternatives], confidence:[0-1]
          **Immediate Actions:** [specialist-specific steps]
          **Red Flags:** [warning signs in your domain]
          **Specialist Recommendation:** [your expert guidance]
          **Follow-up:** [monitoring and next steps]
          
          Confidence: [percentage]%
        `;
      }
      
      return await specialist.processMessage(consultationPrompt, {
        consultationId,
        type: 'specialist_consultation'
      });
    } catch (error) {
      logger.error(`Error getting consultation-specific response from ${specialist.name}: ${error.message}`);
      throw error;
    }
  }

  async synthesizeRecommendations(responses, caseData, coordinationMetadata = null) {
    try {
      const successfulResponses = Array.from(responses.values())
        .filter(r => r.status === 'success');

      if (successfulResponses.length === 0) {
        throw new Error('No successful specialist responses to synthesize');
      }

      logger.info('Starting enhanced synthesis with Task 1.4 features');

      // Extract all recommendations from specialist responses
      const allRecommendations = this.extractAllRecommendations(successfulResponses);

      // Detect clinical red flags
      const clinicalFlags = this.detectClinicalFlags(successfulResponses, coordinationMetadata);

      // Build 3-phase treatment plan
      const treatmentPlan = this.build3PhaseTreatmentPlan(allRecommendations, successfulResponses);

      // Calculate confidence factors
      const confidenceFactors = this.calculateConfidenceFactors(successfulResponses, coordinationMetadata);

      // Create synthesis prompt
      const synthesisPrompt = `
        MULTI-SPECIALIST CONSULTATION SYNTHESIS:

        Case Data: ${JSON.stringify(caseData)}

        Specialist Responses:
        ${successfulResponses.map((r, i) => `
        ${i + 1}. ${r.specialist} (Confidence: ${r.confidence}):
        ${JSON.stringify(r.response)}
        `).join('\n')}

        ${coordinationMetadata ? `
        Inter-Agent Coordination Results:
        - Dialogues: ${coordinationMetadata.interAgentDialogue.length}
        - Disagreements: ${coordinationMetadata.disagreements.length}
        - Emergent Findings: ${coordinationMetadata.emergentFindings.length}
        ` : ''}

        Synthesize these specialist recommendations into a unified, readable care plan using markdown headers (## for sections) and prose paragraphs.

        Write naturally as a lead clinician integrating multiple specialist perspectives. Your synthesis should cover:

        - Unified assessment with consensus findings
        - Integrated treatment plan with coordinated interventions
        - Timeline and sequencing of care
        - Patient-centered education and goals
        - Recovery milestones and success metrics

        Provide a comprehensive, actionable synthesis in clear clinical narrative format that leverages all specialist expertise.
        Use markdown headers (##) and bullet points where appropriate, but write as readable prose, not structured JSON.
      `;

      // Use the triage agent for synthesis if available
      let synthesizer = this.specialists.get('triage') || this.specialists.get('orthopedic_specialist');
      if (!synthesizer) {
        // Fallback to first successful response
        const firstResponse = responses.values().next().value;
        synthesizer = { processMessage: async () => 'Synthesis not available', name: 'System' };
      }

      const rawSynthesis = await synthesizer.processMessage(synthesisPrompt);

      // Format user-friendly synthesis markdown
      const formattedSynthesis = this.formatSynthesisResponse(
        rawSynthesis,
        clinicalFlags,
        confidenceFactors
      );

      // Build prescription-ready data structure
      const prescriptionData = this.buildPrescriptionData(successfulResponses, treatmentPlan, coordinationMetadata);

      // Build enhanced follow-up questions
      const suggestedFollowUp = this.buildEnhancedFollowUpQuestions(successfulResponses);

      // Build feedback prompts
      const feedbackPrompts = this.buildFeedbackPrompts(treatmentPlan);

      // Task 1.4: Enhanced synthesis structure
      return {
        // Task 1.3: Coordination metadata
        coordinationMetadata: coordinationMetadata || {
          interAgentDialogue: [],
          disagreements: [],
          emergentFindings: []
        },

        // Enhanced synthesizedRecommendations
        rawSynthesis,
        synthesis: formattedSynthesis,
        consensusLevel: this.calculateConsensusLevel(successfulResponses),

        // Task 1.4: 3-phase treatment plan
        treatmentPlan,

        // Task 1.4: Confidence factors
        confidenceFactors,

        participatingSpecialists: successfulResponses.map(r => r.specialist),
        synthesizedBy: synthesizer.name,
        timestamp: new Date().toISOString(),

        // Task 1.4: Clinical flags (red flag detection)
        clinicalFlags,

        // Task 1.4: Prescription-ready data
        prescriptionData,

        // Task 1.4: Enhanced follow-up questions
        suggestedFollowUp,

        // Task 1.4: Feedback prompts
        feedbackPrompts
      };
    } catch (error) {
      logger.error(`Error synthesizing recommendations: ${error.message}`);
      throw error;
    }
  }

  async analyzeSpecialistNeeds(caseData) {
    const needs = [];
    
    // Rule-based specialist assignment
    if (caseData.symptoms || caseData.diagnosis) {
      needs.push('orthopedic_specialist');
    }
    
    if (caseData.painLevel > 6 || caseData.chronicPain) {
      needs.push('pain_whisperer');
    }
    
    if (caseData.movementDysfunction || caseData.gaitProblems) {
      needs.push('movement_detective');
    }
    
    if (caseData.functionalLimitations || caseData.strengthDeficits) {
      needs.push('strength_sage');
    }
    
    if (caseData.psychologicalFactors || caseData.anxietyLevel > 5) {
      needs.push('mind_mender');
    }
    
    // Always include triage for coordination
    if (!needs.includes('triage')) {
      needs.unshift('triage');
    }
    
    return needs;
  }

  createRoutingPlan(specialistRecommendations) {
    const plan = {
      primary: specialistRecommendations[0],
      secondary: specialistRecommendations.slice(1, 3),
      optional: specialistRecommendations.slice(3),
      sequence: this.determineSequence(specialistRecommendations),
      priority: 'urgent'
    };
    
    return plan;
  }

  async executeRouting(caseData, routingPlan) {
    const results = [];
    
    // Route to primary specialist first
    if (routingPlan.primary) {
      const primaryResult = await this.routeToSpecialist(
        routingPlan.primary,
        caseData,
        'primary'
      );
      results.push(primaryResult);
    }
    
    // Route to secondary specialists in parallel
    const secondaryPromises = routingPlan.secondary.map(type =>
      this.routeToSpecialist(type, caseData, 'secondary')
    );
    
    const secondaryResults = await Promise.allSettled(secondaryPromises);
    results.push(...secondaryResults.map(r => r.value || r.reason));
    
    return results;
  }

  async routeToSpecialist(specialistType, caseData, priority) {
    try {
      const specialist = this.specialists.get(specialistType);
      if (!specialist) {
        throw new Error(`Specialist ${specialistType} not available`);
      }
      
      const routing = await specialist.consultWithSpecialist(specialistType, caseData);
      
      return {
        specialistType,
        status: 'routed',
        priority,
        routing,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        specialistType,
        status: 'failed',
        priority,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  isSpecialistAvailable(specialist, metrics) {
    // Simple availability check - could be enhanced
    return metrics.consultations < agentConfig.agent.maxSpecialistsPerCase * 10;
  }

  async assessSpecialistLoad(specialist) {
    // Assess current workload - placeholder implementation
    return {
      activeConsultations: 0,
      queuedCases: 0,
      responseTime: 100,
      utilizationRate: 0.7
    };
  }

  calculateCapacity(specialist) {
    // Calculate specialist capacity based on experience and performance
    const baseCapacity = 10;
    const experienceMultiplier = Math.min(specialist.experience / 100, 2);
    const confidenceMultiplier = specialist.getConfidence('general') || 0.8;
    
    return Math.floor(baseCapacity * experienceMultiplier * confidenceMultiplier);
  }

  assessAvailability(currentLoad) {
    const utilizationRate = currentLoad.utilizationRate || 0;
    
    if (utilizationRate < 0.5) return 'high';
    if (utilizationRate < 0.8) return 'medium';
    return 'low';
  }

  generateLoadBalancingRecommendations(workloadAnalysis) {
    const recommendations = [];
    
    for (const [type, analysis] of workloadAnalysis) {
      if (analysis.availability === 'low') {
        recommendations.push({
          type: 'redistribute_load',
          specialist: type,
          reason: 'High utilization detected',
          action: 'Consider routing some cases to other available specialists'
        });
      }
      
      if (analysis.efficiency < 0.7) {
        recommendations.push({
          type: 'improve_efficiency',
          specialist: type,
          reason: 'Low success rate detected',
          action: 'Review cases and provide additional training or support'
        });
      }
    }
    
    return recommendations;
  }

  recordSpecialistPerformance(specialistType, response) {
    const metrics = this.performanceMetrics.get(specialistType);
    
    if (metrics) {
      metrics.consultations += 1;
      
      if (response.status === 'success') {
        metrics.successRate = (metrics.successRate * (metrics.consultations - 1) + 1) / metrics.consultations;
      } else {
        metrics.successRate = (metrics.successRate * (metrics.consultations - 1)) / metrics.consultations;
      }
      
      // Update average response time
      if (response.responseTime) {
        metrics.averageResponseTime = (
          (metrics.averageResponseTime * (metrics.consultations - 1)) + response.responseTime
        ) / metrics.consultations;
      }
    }
  }

  updatePerformanceMetrics(consultation) {
    for (const specialistType of consultation.availableSpecialists) {
      const response = consultation.responses.get(specialistType);
      if (response) {
        this.recordSpecialistPerformance(specialistType, response);
      }
    }
  }

  calculateDuration(startTime, endTime) {
    return new Date(endTime) - new Date(startTime);
  }

  generateCoordinationSummary(consultation) {
    const successfulResponses = Array.from(consultation.responses.values())
      .filter(r => r.status === 'success').length;
    
    const totalResponses = consultation.responses.size;
    const successRate = totalResponses > 0 ? (successfulResponses / totalResponses) * 100 : 0;
    
    return {
      totalSpecialists: totalResponses,
      successfulResponses,
      successRate: Math.round(successRate),
      duration: this.calculateDuration(consultation.startTime, consultation.endTime),
      qualityScore: this.calculateQualityScore(consultation)
    };
  }

  calculateConsensusLevel(responses) {
    // Simple consensus calculation - could be enhanced with NLP
    const recommendations = responses.map(r => r.response?.recommendations || '').join(' ');
    const commonTerms = this.extractCommonTerms(recommendations);
    
    return commonTerms.length > 3 ? 'high' : commonTerms.length > 1 ? 'medium' : 'low';
  }

  calculateSynthesisConfidence(responses) {
    const confidences = responses
      .filter(r => r.confidence)
      .map(r => r.confidence);
    
    if (confidences.length === 0) return 0.5;
    
    return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
  }

  determineSequence(specialists) {
    // Define optimal sequence for specialist consultations
    const priorityOrder = ['triage', 'orthopedic_specialist', 'pain_whisperer', 'movement_detective', 'strength_sage', 'mind_mender'];
    
    return specialists.sort((a, b) => {
      const aIndex = priorityOrder.indexOf(a);
      const bIndex = priorityOrder.indexOf(b);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
  }

  calculateQualityScore(consultation) {
    // Calculate overall quality score for the consultation
    let score = 0;
    
    const responses = Array.from(consultation.responses.values());
    const successRate = responses.filter(r => r.status === 'success').length / responses.length;
    
    score += successRate * 40; // 40% for success rate
    
    const avgConfidence = responses
      .filter(r => r.confidence)
      .reduce((sum, r) => sum + r.confidence, 0) / responses.length || 0.5;
    
    score += avgConfidence * 30; // 30% for confidence
    
    const avgResponseTime = responses
      .filter(r => r.responseTime)
      .reduce((sum, r) => sum + r.responseTime, 0) / responses.length || 5000;
    
    const timeScore = Math.max(0, (10000 - avgResponseTime) / 10000);
    score += timeScore * 30; // 30% for response time
    
    return Math.round(score);
  }

  extractCommonTerms(text) {
    // Simple term extraction - could be enhanced
    const words = text.toLowerCase().split(/\W+/);
    const frequency = {};
    
    words.forEach(word => {
      if (word.length > 4) {
        frequency[word] = (frequency[word] || 0) + 1;
      }
    });
    
    return Object.keys(frequency).filter(word => frequency[word] > 1);
  }

  getCoordinationStatistics() {
    const totalConsultations = this.coordinationHistory.length;
    const successful = this.coordinationHistory.filter(c => c.success).length;

    const specialistUsage = {};
    this.coordinationHistory.forEach(consultation => {
      consultation.specialistsInvolved.forEach(specialist => {
        specialistUsage[specialist] = (specialistUsage[specialist] || 0) + 1;
      });
    });

    return {
      totalConsultations,
      successRate: totalConsultations > 0 ? (successful / totalConsultations) * 100 : 0,
      averageDuration: this.coordinationHistory.reduce((sum, c) => sum + c.duration, 0) / totalConsultations || 0,
      specialistUsage,
      performanceMetrics: Object.fromEntries(this.performanceMetrics),
      activeConsultations: this.activeConsultations.size
    };
  }

  // Task 1.4 Helper Methods

  extractAllRecommendations(successfulResponses) {
    const allRecs = [];

    for (const response of successfulResponses) {
      if (response.response && response.response.recommendations) {
        for (const rec of response.response.recommendations) {
          allRecs.push({
            ...rec,
            source: response.specialist,
            sourceType: response.response.specialistType
          });
        }
      }
    }

    return allRecs;
  }

  detectClinicalFlags(successfulResponses, coordinationMetadata) {
    const redFlags = [];
    let requiresImmediateMD = false;
    let urgencyLevel = 'routine';

    // Extract red flags from keyFindings that require MD review
    for (const response of successfulResponses) {
      if (response.response && response.response.keyFindings) {
        for (const finding of response.response.keyFindings) {
          if (finding.requiresMDReview) {
            redFlags.push({
              flag: this.cleanFlagText(finding.finding),
              severity: finding.clinicalRelevance === 'high' ? 'urgent' : 'semi-urgent',
              recommendedAction: 'Physician evaluation recommended',
              detectedBy: response.specialist,
              confidence: finding.confidence
            });

            if (finding.clinicalRelevance === 'high') {
              requiresImmediateMD = true;
              urgencyLevel = 'immediate';
            }
          }
        }
      }

      // Check clinical importance
      if (response.response && response.response.assessment) {
        const importance = response.response.assessment.clinicalImportance;
        if (importance === 'critical') {
          requiresImmediateMD = true;
          urgencyLevel = 'immediate';
          redFlags.push({
            flag: `Critical assessment by ${response.specialist}`,
            severity: 'urgent',
            recommendedAction: 'Immediate medical evaluation required',
            detectedBy: response.specialist,
            confidence: response.response.assessment.confidence
          });
        }
      }
    }

    // Check for emergent findings from coordination
    if (coordinationMetadata && coordinationMetadata.emergentFindings) {
      for (const finding of coordinationMetadata.emergentFindings) {
        if (finding.clinicalSignificance.toLowerCase().includes('high') ||
            finding.novelty === 'novel') {
          redFlags.push({
            flag: this.cleanFlagText(finding.finding),
            severity: 'semi-urgent',
            recommendedAction: 'Consider specialist evaluation',
            detectedBy: finding.discoveredBy.join(', '),
            confidence: finding.confidence
          });

          if (urgencyLevel === 'routine') {
            urgencyLevel = '24-48hrs';
          }
        }
      }
    }

    return {
      redFlags,
      requiresImmediateMD,
      urgencyLevel
    };
  }

  build3PhaseTreatmentPlan(allRecommendations, successfulResponses) {
    // Sort recommendations by priority
    const sortedRecs = [...allRecommendations].sort((a, b) => (a.priority || 5) - (b.priority || 5));

    // Phase 1: Acute (0-2 weeks) - Immediate priorities
    const phase1Recs = sortedRecs.filter(r =>
      r.priority <= 2 ||
      r.timeline?.toLowerCase().includes('immediate') ||
      r.timeline?.toLowerCase().includes('24') ||
      r.timeline?.toLowerCase().includes('48')
    );

    // Phase 2: Recovery (2-6 weeks) - Medium-term priorities
    const phase2Recs = sortedRecs.filter(r =>
      r.priority === 3 || r.priority === 4 ||
      r.timeline?.toLowerCase().includes('week')
    );

    // Phase 3: Return (6+ weeks) - Long-term priorities
    const phase3Recs = sortedRecs.filter(r =>
      r.priority >= 5 ||
      r.timeline?.toLowerCase().includes('month') ||
      r.timeline?.toLowerCase().includes('long-term')
    );

    return {
      phase1: {
        name: 'Acute Phase',
        timeframe: '0-2 weeks',
        goals: [
          'Pain control and symptom management',
          'Protect healing tissues',
          'Prevent complications',
          'Patient education and engagement'
        ],
        interventions: phase1Recs.map(r => ({
          name: r.intervention,
          frequency: this.inferFrequency(r.timeline, 'phase1'),
          specialist: r.source,
          evidenceGrade: r.evidenceGrade || 'C',
          priority: r.priority
        })),
        milestones: [
          'Pain reduction by 30-40%',
          'Return to basic daily activities',
          'Understanding of condition and treatment plan'
        ]
      },
      phase2: {
        name: 'Recovery Phase',
        timeframe: '2-6 weeks',
        goals: [
          'Restore mobility and flexibility',
          'Begin strength building',
          'Improve function',
          'Address movement patterns'
        ],
        interventions: phase2Recs.map(r => ({
          name: r.intervention,
          frequency: this.inferFrequency(r.timeline, 'phase2'),
          specialist: r.source,
          evidenceGrade: r.evidenceGrade || 'C',
          priority: r.priority
        })),
        milestones: [
          'Pain reduction by 50-70%',
          'Normal range of motion restored',
          'Return to work/school activities'
        ]
      },
      phase3: {
        name: 'Return to Activity Phase',
        timeframe: '6+ weeks',
        goals: [
          'Full functional restoration',
          'Return to sports/recreation',
          'Prevent recurrence',
          'Long-term maintenance'
        ],
        interventions: phase3Recs.map(r => ({
          name: r.intervention,
          frequency: this.inferFrequency(r.timeline, 'phase3'),
          specialist: r.source,
          evidenceGrade: r.evidenceGrade || 'C',
          priority: r.priority
        })),
        milestones: [
          'Pain-free or minimal pain',
          'Full strength and endurance',
          'Return to all activities without limitations'
        ]
      }
    };
  }

  inferFrequency(timeline, phase) {
    if (!timeline) {
      return phase === 'phase1' ? 'Daily' : phase === 'phase2' ? '3-4x/week' : '2-3x/week';
    }

    const timelineLower = timeline.toLowerCase();
    if (timelineLower.includes('daily') || timelineLower.includes('immediate')) return 'Daily';
    if (timelineLower.includes('twice')) return '2x/day';
    if (timelineLower.includes('three') || timelineLower.includes('3x')) return '3x/week';

    return phase === 'phase1' ? 'Daily' : phase === 'phase2' ? '3-4x/week' : 'As needed';
  }

  calculateConfidenceFactors(successfulResponses, coordinationMetadata) {
    // Data completeness - average across all agents
    const dataQualities = successfulResponses
      .filter(r => r.response && r.response.assessment)
      .map(r => r.response.assessment.dataQuality);
    const dataCompleteness = dataQualities.length > 0
      ? dataQualities.reduce((sum, q) => sum + q, 0) / dataQualities.length
      : 0.5;

    // Inter-agent agreement
    let interAgentAgreement = 0.8; // Default high agreement
    if (coordinationMetadata && coordinationMetadata.disagreements) {
      const disagreementCount = coordinationMetadata.disagreements.length;
      const totalAgents = successfulResponses.length;
      // Reduce agreement by 0.1 for each disagreement
      interAgentAgreement = Math.max(0.3, 1.0 - (disagreementCount * 0.15));
    }

    // Evidence quality - average of evidence grades
    const evidenceGrades = { 'A': 1.0, 'B': 0.8, 'C': 0.6, 'D': 0.4 };
    const allEvidence = [];
    for (const response of successfulResponses) {
      if (response.response && response.response.recommendations) {
        for (const rec of response.response.recommendations) {
          if (rec.evidenceGrade) {
            allEvidence.push(evidenceGrades[rec.evidenceGrade] || 0.5);
          }
        }
      }
    }
    const evidenceQuality = allEvidence.length > 0
      ? allEvidence.reduce((sum, e) => sum + e, 0) / allEvidence.length
      : 0.6;

    // Overall confidence
    const overallConfidence = (dataCompleteness * 0.3) + (interAgentAgreement * 0.4) + (evidenceQuality * 0.3);

    return {
      dataCompleteness: Math.round(dataCompleteness * 100) / 100,
      interAgentAgreement: Math.round(interAgentAgreement * 100) / 100,
      evidenceQuality: Math.round(evidenceQuality * 100) / 100,
      overallConfidence: Math.round(overallConfidence * 100) / 100
    };
  }

  buildPrescriptionData(successfulResponses, treatmentPlan, coordinationMetadata) {
    // Extract primary diagnosis from triage or first specialist
    let primaryDiagnosis = 'Orthopedic condition requiring assessment';
    let differentialDiagnoses = [];
    let diagnosisConfidence = 0.7;

    // Try to extract from triage response
    const triageResponse = successfulResponses.find(r =>
      r.response && r.response.specialistType === 'triage'
    );

    if (triageResponse && triageResponse.response.keyFindings) {
      const primaryFinding = triageResponse.response.keyFindings[0];
      if (primaryFinding) {
        primaryDiagnosis = primaryFinding.finding;
        diagnosisConfidence = primaryFinding.confidence;
      }
    }

    // Build specialist insights
    const specialistInsights = successfulResponses.map(response => {
      const specialist = response.response;
      return {
        specialist: specialist.specialist,
        badge: specialist.specialistType,
        keyInsight: specialist.assessment?.primaryFindings?.[0] || 'Assessment completed',
        recommendations: specialist.recommendations?.slice(0, 3).map(r => r.intervention) || [],
        confidence: specialist.confidence
      };
    });

    // Evidence base
    const allEvidenceGrades = [];
    successfulResponses.forEach(r => {
      if (r.response && r.response.recommendations) {
        r.response.recommendations.forEach(rec => {
          if (rec.evidenceGrade) allEvidenceGrades.push(rec.evidenceGrade);
        });
      }
    });

    const evidenceGradeCount = {};
    allEvidenceGrades.forEach(grade => {
      evidenceGradeCount[grade] = (evidenceGradeCount[grade] || 0) + 1;
    });

    const primaryEvidence = Object.keys(evidenceGradeCount).sort((a, b) =>
      evidenceGradeCount[b] - evidenceGradeCount[a]
    )[0] || 'B';

    // Recovery timeline from treatment plan
    const recoveryTimeline = {
      phases: [
        {
          name: treatmentPlan.phase1.name,
          duration: treatmentPlan.phase1.timeframe,
          goals: treatmentPlan.phase1.goals,
          milestones: treatmentPlan.phase1.milestones
        },
        {
          name: treatmentPlan.phase2.name,
          duration: treatmentPlan.phase2.timeframe,
          goals: treatmentPlan.phase2.goals,
          milestones: treatmentPlan.phase2.milestones
        },
        {
          name: treatmentPlan.phase3.name,
          duration: treatmentPlan.phase3.timeframe,
          goals: treatmentPlan.phase3.goals,
          milestones: treatmentPlan.phase3.milestones
        }
      ]
    };

    // Tracking metrics
    const trackingMetrics = [
      {
        metric: 'Pain Level (0-10 scale)',
        currentValue: 'Baseline',
        targetValue: '< 3/10',
        checkDay: 7
      },
      {
        metric: 'Functional Activities',
        currentValue: 'Limited',
        targetValue: 'Normal daily activities',
        checkDay: 14
      },
      {
        metric: 'Range of Motion',
        currentValue: 'Restricted',
        targetValue: '80% of normal',
        checkDay: 21
      },
      {
        metric: 'Strength',
        currentValue: 'Reduced',
        targetValue: '90% of baseline',
        checkDay: 42
      }
    ];

    return {
      diagnosisHypothesis: {
        primary: primaryDiagnosis,
        differential: differentialDiagnoses,
        confidence: diagnosisConfidence,
        agentConsensus: this.calculateAgentConsensus(successfulResponses)
      },
      specialistInsights,
      evidenceBase: {
        studiesReviewed: allEvidenceGrades.length,
        primaryReferences: ['Evidence-based orthopedic guidelines'],
        evidenceGrade: primaryEvidence
      },
      recoveryTimeline,
      trackingMetrics
    };
  }

  calculateAgentConsensus(successfulResponses) {
    const agreements = successfulResponses.filter(r =>
      r.response && (r.response.agreementWithTriage === 'full' || r.response.agreementWithTriage === 'self')
    ).length;

    return successfulResponses.length > 0 ? agreements / successfulResponses.length : 0.8;
  }

  buildEnhancedFollowUpQuestions(successfulResponses) {
    const questions = [];

    // Collect all follow-up questions from agents
    for (const response of successfulResponses) {
      if (response.response && response.response.followUpQuestions) {
        for (const question of response.response.followUpQuestions) {
          questions.push({
            question,
            purpose: 'Gather additional clinical information',
            expectedImpact: 'medium',
            targetSpecialist: response.response.specialistType
          });
        }
      }
    }

    // Prioritize by specialist type
    const priorityOrder = ['triage', 'painWhisperer', 'movementDetective', 'strengthSage', 'mindMender'];
    questions.sort((a, b) => {
      const aIndex = priorityOrder.indexOf(a.targetSpecialist);
      const bIndex = priorityOrder.indexOf(b.targetSpecialist);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });

    // Limit to top 5 most important questions
    return questions.slice(0, 5);
  }

  buildFeedbackPrompts(treatmentPlan) {
    return {
      immediate: {
        question: 'How well does this treatment plan align with your goals and preferences?',
        options: ['Perfectly aligned', 'Mostly aligned', 'Somewhat aligned', 'Needs adjustment'],
        purpose: 'Ensure patient-centered care approach'
      },
      milestones: [
        {
          day: 7,
          prompt: 'How is your pain level compared to when you started?',
          expectedResponse: ['Much better', 'Somewhat better', 'About the same', 'Worse']
        },
        {
          day: 14,
          prompt: 'Are you able to perform your daily activities with less difficulty?',
          expectedResponse: ['Yes, significantly easier', 'Yes, somewhat easier', 'No change', 'More difficult']
        },
        {
          day: 21,
          prompt: 'How confident do you feel in your recovery progress?',
          expectedResponse: ['Very confident', 'Confident', 'Somewhat confident', 'Not confident']
        },
        {
          day: 42,
          prompt: 'Have you returned to your desired activities?',
          expectedResponse: ['Yes, fully', 'Yes, partially', 'Not yet', 'Unable to']
        }
      ]
    };
  }

  formatSynthesisResponse(rawSynthesis, clinicalFlags, confidenceFactors) {
    let markdown = `# Multi-Specialist Care Plan\n\n`;

    // Clinical Flags first (safety critical!)
    if (clinicalFlags && clinicalFlags.redFlags && clinicalFlags.redFlags.length > 0) {
      clinicalFlags.redFlags.forEach(flag => {
        const emoji = flag.severity === 'urgent' ? '🚨' : '⚠️';
        const cleanedFlag = this.cleanFlagText(flag.flag);
        markdown += `${emoji} **${cleanedFlag}** - ${flag.recommendedAction}\n\n`;
      });

      if (clinicalFlags.requiresImmediateMD) {
        markdown += `**Please consult with a physician as soon as possible.**\n\n`;
      }
      markdown += `---\n\n`;
    }

    // Primary content - the LLM's unified synthesis
    if (rawSynthesis) {
      // Handle both string and object responses
      let synthesisText = typeof rawSynthesis === 'string'
        ? rawSynthesis
        : JSON.stringify(rawSynthesis, null, 2);

      // Clean up JSON formatting if present
      if (synthesisText.startsWith('{') || synthesisText.startsWith('[')) {
        try {
          const parsed = JSON.parse(synthesisText);
          // Format structured synthesis (similar to base-agent formatStructuredResponse)
          synthesisText = this.formatStructuredSynthesis(parsed);
        } catch (e) {
          // If parsing fails, use as-is
        }
      }

      markdown += synthesisText + '\n\n';
    }

    // Minimal footer with confidence
    if (confidenceFactors && confidenceFactors.overallConfidence) {
      markdown += `---\n\n`;
      markdown += `*Confidence: ${Math.round(confidenceFactors.overallConfidence * 100)}%*\n`;
    }

    return markdown;
  }

  // Helper to format structured JSON synthesis into readable text
  formatStructuredSynthesis(data) {
    let text = '';

    // Handle common synthesis response patterns
    if (data.unifiedAssessment || data.unified_assessment) {
      text += `## Unified Assessment\n\n`;
      const assessment = data.unifiedAssessment || data.unified_assessment;
      text += typeof assessment === 'string' ? assessment : JSON.stringify(assessment, null, 2);
      text += '\n\n';
    }

    if (data.integratedTreatmentPlan || data.integrated_treatment_plan) {
      text += `## Integrated Treatment Plan\n\n`;
      const plan = data.integratedTreatmentPlan || data.integrated_treatment_plan;
      text += typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2);
      text += '\n\n';
    }

    if (data.careCoordination || data.care_coordination) {
      text += `## Care Coordination\n\n`;
      const coord = data.careCoordination || data.care_coordination;
      text += typeof coord === 'string' ? coord : JSON.stringify(coord, null, 2);
      text += '\n\n';
    }

    // If nothing formatted, just stringify
    if (!text) {
      text = JSON.stringify(data, null, 2);
    }

    return text;
  }

  // Text formatting utilities
  humanizeText(text) {
    if (!text || text === 'null' || text === 'undefined') return 'Unknown';

    // Convert snake_case to Title Case
    text = text.replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());

    // Replace "null%" or "undefined%" with "unknown"
    text = text.replace(/\bnull%/g, 'unknown')
      .replace(/\bundefined%/g, 'unknown');

    // Clean up JSON-like patterns
    text = text.replace(/\{[^}]*\}/g, '');
    text = text.replace(/\[[^\]]*\]/g, '');

    // Remove multiple spaces
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  cleanFlagText(flagText) {
    // Handle null/undefined
    if (!flagText) return 'Clinical concern identified';

    // Humanize the text
    let cleaned = this.humanizeText(flagText);

    // Remove phrases with null/0 values that don't make sense
    cleaned = cleaned.replace(/at null%/gi, '');
    cleaned = cleaned.replace(/with 0 \w+ deficits/gi, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned || 'Clinical concern identified';
  }

  // ============================================================================
  // INTER-AGENT TOKEN ECONOMY METHODS
  // ============================================================================

  /**
   * PHASE 2: Process consultation payments
   * Agents pay tokens for specialist consultations based on expertise and performance
   */
  async processConsultationPayments(consultationId, specialistTypes, caseData) {
    try {
      logger.info(`Processing consultation payments for: ${consultationId}`);

      const payments = [];
      const complexity = this.assessCaseComplexity(caseData);

      for (const specialistType of specialistTypes) {
        const specialist = this.specialists.get(specialistType);
        if (!specialist) continue;

        // Calculate consultation fee based on specialist performance and complexity
        const baseFee = 3; // Base consultation fee
        const complexityMultiplier = complexity === 'high' ? 1.5 : complexity === 'medium' ? 1.2 : 1.0;

        // Performance-based pricing
        const performance = this.performanceMetrics.get(specialistType);
        const performanceMultiplier = performance
          ? 1.0 + (performance.successRate * 0.5) // Up to 50% bonus for high performers
          : 1.0;

        const consultationFee = Math.round(baseFee * complexityMultiplier * performanceMultiplier);

        // Record payment (in real system, this would transfer from requesting agent)
        const payment = {
          consultationId,
          specialist: specialistType,
          fee: consultationFee,
          complexity,
          performanceMultiplier,
          timestamp: new Date().toISOString()
        };

        payments.push(payment);

        // Distribute fee to specialist agent
        await this.tokenManager.distributeTokenReward(specialist.agentId, {
          success: true,
          consultationPayment: true
        }, {
          experienceMultiplier: 1.0,
          qualityMultiplier: performanceMultiplier
        });
      }

      this.consultationPayments.set(consultationId, {
        payments,
        totalFees: payments.reduce((sum, p) => sum + p.fee, 0)
      });

      logger.info(`Consultation payments processed: ${payments.length} specialists, total: ${payments.reduce((sum, p) => sum + p.fee, 0)} tokens`);

      return payments;
    } catch (error) {
      logger.error(`Error processing consultation payments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Assess case complexity for pricing
   */
  assessCaseComplexity(caseData) {
    let complexityScore = 0;

    // Pain level
    if (caseData.painLevel > 7) complexityScore += 2;
    else if (caseData.painLevel > 4) complexityScore += 1;

    // Duration
    if (caseData.duration === 'chronic') complexityScore += 2;
    else if (caseData.duration === 'subacute') complexityScore += 1;

    // Multiple symptoms
    if (caseData.symptoms && caseData.symptoms.split(',').length > 3) complexityScore += 1;

    // Comorbidities
    if (caseData.comorbidities) complexityScore += 1;

    if (complexityScore >= 4) return 'high';
    if (complexityScore >= 2) return 'medium';
    return 'low';
  }

  /**
   * PHASE 3: Resolve inter-agent predictions
   * Uses agent consensus as baseline resolution (guaranteed to occur)
   */
  async resolveInterAgentPredictions(consultationId, responses, coordinationMetadata) {
    try {
      logger.info(`Resolving inter-agent predictions for: ${consultationId}`);

      // Extract consensus outcomes from agent responses
      const consensusOutcomes = this.extractConsensusOutcomes(responses, coordinationMetadata);

      // Resolve predictions with inter-agent data
      const resolution = await this.predictionMarket.resolvePredictions(consultationId, {
        interAgent: {
          ...consensusOutcomes,
          timestamp: new Date().toISOString()
        }
      });

      logger.info(`Inter-agent predictions resolved for ${consultationId}`);
      return resolution;
    } catch (error) {
      logger.error(`Error resolving inter-agent predictions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract consensus outcomes from agent responses
   */
  extractConsensusOutcomes(responses, coordinationMetadata) {
    const outcomes = {};

    // User satisfaction - based on quality score
    const successfulResponses = Array.from(responses.values()).filter(r => r.status === 'success');
    const avgConfidence = successfulResponses.reduce((sum, r) => sum + (r.confidence || 0.7), 0) / successfulResponses.length;
    outcomes.user_satisfaction = avgConfidence > 0.75;

    // MD approval - based on overall confidence and coordination
    const highConfidenceResponses = successfulResponses.filter(r => r.confidence > 0.8).length;
    outcomes.md_approval = highConfidenceResponses >= successfulResponses.length * 0.5;

    // Agreement level
    if (coordinationMetadata) {
      outcomes.inter_agent_agreement = coordinationMetadata.disagreements.length === 0 ? 1.0 :
        Math.max(0.3, 1.0 - (coordinationMetadata.disagreements.length * 0.2));
    } else {
      outcomes.inter_agent_agreement = 0.8;
    }

    return outcomes;
  }

  /**
   * Resolve predictions with MD review feedback
   * Called when MD provides review/approval
   */
  async resolveMDReviewPredictions(consultationId, mdReviewData) {
    try {
      logger.info(`Resolving MD review predictions for: ${consultationId}`);

      if (!this.predictionMarket) {
        logger.warn('Prediction market not initialized');
        return null;
      }

      // MD review data structure expected:
      // {
      //   approved: boolean,
      //   clinicalAccuracy: number (0-1),
      //   recommendations: string,
      //   timestamp: string
      // }

      const resolution = await this.predictionMarket.resolvePredictions(consultationId, {
        mdReview: {
          md_approval: mdReviewData.approved,
          clinical_accuracy: mdReviewData.clinicalAccuracy,
          timestamp: mdReviewData.timestamp || new Date().toISOString()
        }
      });

      logger.info(`MD review predictions resolved for ${consultationId}`);
      return resolution;
    } catch (error) {
      logger.error(`Error resolving MD review predictions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resolve predictions with user modal feedback
   * Called when user submits feedback modal (before prescription access)
   * Implements cascading resolution: resolves ALL participating agents, not just triage
   */
  async resolveUserModalPredictions(consultationId, userFeedback) {
    try {
      logger.info(`Resolving user modal predictions for: ${consultationId}`);

      if (!this.predictionMarket) {
        logger.warn('Prediction market not initialized');
        return null;
      }

      // Get consultation metadata before resolution (for cascading info)
      const metadata = this.predictionMarket.getConsultationMetadata(consultationId);
      const shouldFlagMDReview = metadata?.recommendMDReview || false;

      // User modal feedback structure expected:
      // {
      //   satisfied: boolean,
      //   painLevel: number (0-10),
      //   confidence: number (1-5),
      //   timestamp: string
      // }

      const resolution = await this.predictionMarket.resolvePredictions(consultationId, {
        userModal: {
          user_satisfaction: userFeedback.satisfied,
          pain_reduction_day7: userFeedback.painLevel,
          user_confidence: userFeedback.confidence / 5, // Normalize to 0-1
          timestamp: userFeedback.timestamp || new Date().toISOString()
        }
      });

      // Enhance resolution with cascading metadata
      if (resolution) {
        resolution.cascadingResolution = {
          totalAgentsResolved: resolution.agentResults?.length || 0,
          agentsSummary: resolution.agentResults?.map(r => ({
            agentId: r.agentId,
            agentName: r.agentName,
            accuracy: r.accuracy,
            netChange: r.netChange
          })) || [],
          recommendMDReview: shouldFlagMDReview,
          resolutionSource: 'user_modal'
        };
      }

      logger.info(`User modal predictions resolved for ${consultationId}: ${resolution?.agentResults?.length || 0} agents resolved (cascading)`);
      return resolution;
    } catch (error) {
      logger.error(`Error resolving user modal predictions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resolve predictions with user follow-up data
   * Called when user returns for milestone check-ins
   */
  async resolveFollowUpPredictions(consultationId, followUpData) {
    try {
      logger.info(`Resolving follow-up predictions for: ${consultationId}`);

      if (!this.predictionMarket) {
        logger.warn('Prediction market not initialized');
        return null;
      }

      // Follow-up data structure expected:
      // {
      //   painLevel: number (0-10),
      //   functionalImprovement: number (0-100),
      //   returnedToActivity: boolean,
      //   adherenceRate: number (0-100),
      //   daysSinceConsultation: number,
      //   timestamp: string
      // }

      const resolution = await this.predictionMarket.resolvePredictions(consultationId, {
        followUp: {
          pain_reduction_percentage: followUpData.painLevel ?
            ((10 - followUpData.painLevel) / 10) * 100 : null,
          functional_restoration: followUpData.functionalImprovement,
          return_to_activity_timeline: followUpData.daysSinceConsultation,
          adherence_rate: followUpData.adherenceRate,
          returned_to_activity: followUpData.returnedToActivity,
          timestamp: followUpData.timestamp || new Date().toISOString()
        }
      });

      logger.info(`Follow-up predictions resolved for ${consultationId}`);
      return resolution;
    } catch (error) {
      logger.error(`Error resolving follow-up predictions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get prediction market performance for admin dashboard
   */
  getPredictionMarketStats() {
    if (!this.predictionMarket) {
      return null;
    }

    return this.predictionMarket.getMarketStatistics();
  }

  /**
   * Get agent prediction performance
   */
  getAgentPredictionPerformance(agentId) {
    if (!this.predictionMarket) {
      return null;
    }

    return this.predictionMarket.getAgentPerformance(agentId);
  }
}

export default AgentCoordinator;