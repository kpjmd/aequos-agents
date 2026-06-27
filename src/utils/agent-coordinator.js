import logger from './logger.js';
import { agentConfig } from '../config/agent-config.js';
import promptManager from './prompt-manager.js';
import { CoordinationConference } from './coordination-conference.js';
import sql from './db.js';
import { storePanelRun } from './panel-run-storage.js';
import { resolveModelVersionId, createQuery, getSentinelDecisionPointId, resolveDecisionPointIdBySlug } from './equipoise-ingest.js';
import { buildSynthesizerOutput, storeSynthesizerOutput } from './synthesizer.js';
import { classifyDecisionPoint, loadCatalog } from './dp-classifier.js';

// Positions run on Sonnet (mode 'normal'), matching the benchmark probe — the model_versions row
// seeded by seed-equipoise.js. Keep this string identical to scripts/benchmark-probe.js POSITION_MODEL.
const POSITION_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export class AgentCoordinator {
  constructor(tokenManager = null) {
    this.specialists = new Map();
    this.activeConsultations = new Map();
    this.coordinationHistory = [];
    this.performanceMetrics = new Map();
    this.coordinationConference = new CoordinationConference();
    this.tokenManager = tokenManager;
    this.consultationPayments = new Map();
    this.consultationPaymentsInFlight = new Set();
  }

  registerSpecialist(type, agent) {
    this.specialists.set(type, agent);
    
    // Initialize performance tracking
    this.performanceMetrics.set(type, {
      consultations: 0,
      successRate: 0,
      averageResponseTime: 0,
      patientSatisfaction: 0,
      tokenBalance: 0, // populated lazily from TokenManager on read
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

      // Process consultation payments (async, non-blocking)
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
        timeout: mode === 'fast' ? 35000 : 75000, // 35s fast, 75s normal to accommodate Sonnet 4.6 + coordination
        minResponses: mode === 'fast' ? 2 : availableSpecialists.length,
        rawQuery,
        enableDualTrack
      };

      const responses = await this.collectSpecialistResponses(consultation, collectionOptions);

      // Task 1.3: Conduct coordination conference for inter-agent dialogue
      let coordinationMetadata = null;
      if (responses.size >= 2) {
        try {
          logger.info('Running coordination conference (decision points → positions → divergence)');
          coordinationMetadata = await this.coordinationConference.conductConferenceRound(
            responses,
            this.specialists,
            caseData,
            { mode }
          );
          logger.info(`Conference complete: ${coordinationMetadata.decisionPoints?.length || 0} decision point(s), ${coordinationMetadata.divergences?.length || 0} genuine divergence(s), gate ${coordinationMetadata.gateOpen ? 'OPEN' : 'closed'}`);
        } catch (error) {
          logger.error(`Coordination conference error: ${error.message}`);
          // Canonical empty shape so synthesizedRecommendations.coordinationMetadata.divergences
          // is ALWAYS a present array (the documented frontend/API contract), even on error.
          coordinationMetadata = this.coordinationConference.emptyMetadata(
            `conference error: ${error.message}`,
            { error: error.message }
          );
        }
      }

      // Synthesize recommendations with coordination metadata
      const synthesizedRecommendations = await this.synthesizeRecommendations(responses, caseData, coordinationMetadata, mode);

      // Build the equipoise card(s) (pure/synchronous) for every decision point the panel evaluated —
      // converged AND contested — attach to the response, then persist the panel layer in the
      // background (best-effort, non-blocking; no-op without DATABASE_URL). Replaces the legacy
      // coordination_divergences write: the owned panel_runs/specialist_positions/synthesizer_outputs
      // layer is a strict superset.
      const equipoiseCards = this.buildEquipoiseCards(coordinationMetadata, synthesizedRecommendations);
      if (equipoiseCards.length > 0) {
        synthesizedRecommendations.equipoiseCards = equipoiseCards.map(c => c.output.card_json);
        this.persistEquipoisePanels(consultationId, equipoiseCards).catch(error => {
          logger.error(`Equipoise panel persistence failed: ${error.message}`);
        });
      }

      // Update consultation
      consultation.responses = responses;
      consultation.synthesizedRecommendations = synthesizedRecommendations;
      consultation.endTime = new Date().toISOString();
      consultation.status = 'completed';

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

  /**
   * Build the equipoise card + routing decision for every decision point the panel evaluated.
   * Pure/synchronous (no DB) so the card_json can be returned on the consult response immediately.
   * The red-flag routing signal is consult-level (clinicalFlags.requiresImmediateMD), shared by all
   * cards in the consult. Returns [] in fast mode / clear-cut cases (perDecisionPoint is empty).
   * @returns {Array<{perDP, output}>}
   */
  buildEquipoiseCards(coordinationMetadata, synthesizedRecommendations) {
    const perDPs = coordinationMetadata?.perDecisionPoint || [];
    if (perDPs.length === 0) return [];
    const clinicalFlags = synthesizedRecommendations?.clinicalFlags || {};
    const ctx = {
      requiresImmediateMD: clinicalFlags.requiresImmediateMD,
      urgencyLevel: clinicalFlags.urgencyLevel,
      treatmentPlan: synthesizedRecommendations?.treatmentPlan,
    };
    return perDPs.map(perDP => ({ perDP, output: buildSynthesizerOutput(perDP, ctx) }));
  }

  /**
   * Persist real consult panels into the owned equipoise layer (best-effort, non-blocking; no-op
   * without DATABASE_URL). Each decision point → one panel_runs row (run_kind='production') + its
   * specialist_positions + one synthesizer_outputs card.
   *
   * Phase 2c: the slug-classifier maps each ad-hoc consult decision point to its nearest CURATED
   * benchmark slug. An EXACT match anchors the panel_run to that real slug (per-slug production
   * convergence in v_convergence_by_model); anything else falls back to the sentinel
   * 'production-unclassified'. A 'related' near-miss (same condition/region, different fork) is
   * recorded on queries.patient_context for the reversibility audit trail. Production rows are never
   * scored by v_benchmark_accuracy (run_kind='benchmark_probe' only), so the moat headline is untouched.
   *
   * PHI rule: only the triage-framed clinical question is stored (queries.raw_text), and
   * patient_context carries only a curated slug + enum (never identifiers) — consistent with the
   * retired divergence table's PHI-out stance.
   * @param {string} consultationId
   * @param {Array<{perDP, output}>} cards
   */
  async persistEquipoisePanels(consultationId, cards) {
    if (!sql) return;
    const modelVersionId = await resolveModelVersionId(sql, POSITION_MODEL);
    const sentinelId = await getSentinelDecisionPointId(sql);
    if (modelVersionId == null || sentinelId == null) {
      logger.warn('Equipoise persistence skipped: missing model_versions or sentinel decision_point (run seed:equipoise?)');
      return;
    }
    const catalog = await loadCatalog(sql);

    let stored = 0;
    let classified = 0;
    for (const { perDP, output } of cards) {
      const dp = perDP.decisionPoint;
      const [optionALabel = null, optionBLabel = null] = dp?.options || [];

      // Classify the ad-hoc consult DP → curated slug (exact) or sentinel (related/none/unavailable).
      // Best-effort: classifyDecisionPoint never throws; an empty catalog yields 'none'.
      const match = catalog.length > 0
        ? await classifyDecisionPoint(dp, catalog)
        : { slug: null, matchQuality: 'none', nearMissSlug: null };
      let decisionPointId = sentinelId;
      if (match.slug) {
        const matchedId = await resolveDecisionPointIdBySlug(sql, match.slug);
        if (matchedId != null) { decisionPointId = matchedId; classified++; }
      }
      // 'related' near-miss → audit trail on the (sentinel-anchored) query row.
      const patientContext = match.matchQuality === 'related' && match.nearMissSlug
        ? { nearMissSlug: match.nearMissSlug, matchQuality: 'related' }
        : null;

      const queryId = await createQuery(sql, {
        questionText: dp?.question ?? '(unspecified decision)',
        decisionPointId,
        isBenchmark: false,
        detectedBy: 'classifier',
        patientContext,
      });
      if (queryId == null) continue;

      const panelRunId = await storePanelRun(sql, {
        queryId,
        decisionPointId,
        modelVersionId,
        verdict: perDP.verdict,
        optionALabel,
        optionBLabel,
        runKind: 'production',
        sessionId: consultationId,
        splitSummary: perDP.splitSummary,
        positions: perDP.positions,
      });
      if (panelRunId == null) continue;

      await storeSynthesizerOutput(sql, panelRunId, output);
      stored++;
    }

    if (stored > 0) {
      logger.info(`Persisted ${stored} production panel run(s) for ${consultationId} (${classified} slug-classified, ${stored - classified} sentinel)`);
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
      timeout = 75000,  // 75 second default timeout per agent (Sonnet 4.6 needs headroom)
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
          response = await this.getConsultationSpecificResponse(specialist, caseData, consultationId, mode);
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

  async getConsultationSpecificResponse(specialist, caseData, consultationId, mode = 'normal') {
    try {
      const specialistType = specialist.agentType || specialist.name.toLowerCase();
      
      // Create specialist-focused consultation prompt
      let consultationPrompt;
      
      if (specialistType.includes('triage') || specialistType === 'triage') {
        consultationPrompt = `
          TRIAGE COORDINATION CONSULTATION:

          Case:
<patient_input>
${JSON.stringify(caseData)}
</patient_input>

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

          Case:
<patient_input>
${JSON.stringify(caseData)}
</patient_input>

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

          Case:
<patient_input>
${JSON.stringify(caseData)}
</patient_input>

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

          Case:
<patient_input>
${JSON.stringify(caseData)}
</patient_input>

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

          Case:
<patient_input>
${JSON.stringify(caseData)}
</patient_input>

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

          Case:
<patient_input>
${JSON.stringify(caseData)}
</patient_input>

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
        type: 'specialist_consultation',
        mode,
        timeout: mode === 'fast' ? 35000 : 75000,
      });
    } catch (error) {
      logger.error(`Error getting consultation-specific response from ${specialist.name}: ${error.message}`);
      throw error;
    }
  }

  async synthesizeRecommendations(responses, caseData, coordinationMetadata = null, mode = 'normal') {
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

        Case Data:
<patient_input>
${JSON.stringify(caseData)}
</patient_input>

        Specialist Responses:
        ${successfulResponses.map((r, i) => `
        ${i + 1}. ${r.specialist} (Confidence: ${r.confidence}):
        ${JSON.stringify(r.response)}
        `).join('\n')}

        ${this.formatDivergencesForSynthesis(coordinationMetadata)}

        Synthesize these specialist recommendations into a unified, readable care plan using markdown headers (## for sections) and prose paragraphs.

        Write naturally as a lead clinician integrating multiple specialist perspectives. Your synthesis should cover:

        - Unified assessment with consensus findings
        - Integrated treatment plan with coordinated interventions
        - Timeline and sequencing of care
        - Patient-centered education and goals
        - Recovery milestones and success metrics
        - If (and ONLY if) the GENUINE SPECIALIST DISAGREEMENTS section above is present: a clearly-labelled "## Where Your Specialists Differ" section that presents each side of the contested decision and the underlying reasoning in plain language, names it as genuine clinical uncertainty (equipoise), and frames it as a trade-off for the patient to discuss with their physician. Do NOT manufacture or imply disagreement if that section is absent — most cases have none.

        Provide a comprehensive, actionable synthesis in clear clinical narrative format that leverages all specialist expertise.
        Use markdown headers (##) and bullet points where appropriate, but write as readable prose, not structured JSON.
      `;

      // Use the triage agent for synthesis if available
      let synthesizer = this.specialists.get('triage') || this.specialists.get('orthopedic_specialist');
      if (!synthesizer) {
        // Fallback: use any specialist that produced a successful response
        for (const [agentType, response] of responses.entries()) {
          if (response.status === 'success') {
            const candidate = this.specialists.get(agentType);
            if (candidate) {
              synthesizer = candidate;
              break;
            }
          }
        }
      }
      if (!synthesizer) {
        synthesizer = { processMessage: async () => 'Synthesis not available', name: 'System' };
      }

      const rawSynthesis = await synthesizer.processMessage(synthesisPrompt, {
        mode,
        timeout: mode === 'fast' ? 35000 : 75000,
      });

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
        // Task 1.3: Coordination metadata — canonical empty shape when no conference ran (e.g.
        // <2 specialist responses) so coordinationMetadata.divergences is always a present array.
        coordinationMetadata: coordinationMetadata || this.coordinationConference.emptyMetadata(
          'no conference (insufficient specialist responses)'
        ),

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

  /**
   * Render genuine divergences (content, not counts) for the synthesis prompt so the care
   * plan can present disagreements honestly. Uses post-dialogue final positions when available.
   * Returns '' when there is no real divergence (so synthesis never manufactures one).
   */
  formatDivergencesForSynthesis(coordinationMetadata) {
    const divergences = coordinationMetadata?.divergences || [];
    if (!coordinationMetadata?.gateOpen || divergences.length === 0) return '';

    let block = '\n        GENUINE SPECIALIST DISAGREEMENTS — surfaced by structured panel deliberation. Present these honestly; do NOT paper over them:\n';

    for (const d of divergences) {
      block += `\n        Contested decision: ${d.decisionPoint?.question || 'unspecified'}\n`;
      const turns = d.dialogue || [];

      if (turns.length > 0) {
        // Group by post-dialogue (final) stance — the considered positions after deliberation.
        const byStance = {};
        for (const t of turns) {
          (byStance[t.revisedStance] ||= []).push(t);
        }
        for (const [stance, ts] of Object.entries(byStance)) {
          const who = ts.map(t => t.specialist).join(', ');
          const reason = ts[0]?.changeReason || ts[0]?.reasoning || '';
          block += `          • ${who} → "${stance}": ${reason}\n`;
        }
        block += d.postDialogue?.persisted
          ? '          → After discussion the disagreement PERSISTED — genuine clinical equipoise.\n'
          : '          → After discussion the panel converged.\n';
      } else {
        for (const side of (d.sides || [])) {
          const who = side.specialists.map(s => s.specialist).join(', ');
          block += `          • ${who} → "${side.stance}": ${side.specialists[0]?.reasoning || ''}\n`;
        }
      }
    }

    return block;
  }

  isSpecialistAvailable(specialist, metrics) {
    // Simple availability check - could be enhanced
    return metrics.consultations < agentConfig.agent.maxSpecialistsPerCase * 10;
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

  async processConsultationPayments(consultationId, specialistTypes, caseData) {
    if (this.consultationPayments.has(consultationId)) {
      return this.consultationPayments.get(consultationId).payments;
    }
    if (this.consultationPaymentsInFlight.has(consultationId)) {
      logger.warn(`processConsultationPayments called concurrently for ${consultationId} — skipping duplicate`);
      return [];
    }
    this.consultationPaymentsInFlight.add(consultationId);
    try {
      logger.info(`Distributing specialist token rewards for: ${consultationId}`);

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
          consultationId,
          experienceMultiplier: 1.0,
          qualityMultiplier: performanceMultiplier
        });
      }

      this.consultationPayments.set(consultationId, {
        payments,
        totalFees: payments.reduce((sum, p) => sum + p.fee, 0)
      });

      logger.info(`Token rewards distributed: ${payments.length} specialists, total: ${payments.reduce((sum, p) => sum + p.fee, 0)} tokens`);

      return payments;
    } catch (error) {
      logger.error(`Error processing consultation payments: ${error.message}`);
      throw error;
    } finally {
      this.consultationPaymentsInFlight.delete(consultationId);
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

}


export default AgentCoordinator;