#!/usr/bin/env node

/**
 * OrthoIQ Agents - Main Entry Point
 * 
 * Multi-agent recovery ecosystem with token economics and blockchain integration
 */

import dotenv from 'dotenv';
import express from 'express';
import logger from './utils/logger.js';
import AgentCoordinator from './utils/agent-coordinator.js';
import TokenManager from './utils/token-manager.js';
import RecoveryMetrics from './utils/recovery-metrics.js';
import BlockchainUtils from './utils/blockchain-utils.js';
import CdpAccountManager from './utils/cdp-account-manager.js';
import cacheManager from './utils/cache-manager.js';
import promptManager from './utils/prompt-manager.js';
import { validateScope } from './utils/scope-validator.js';
import { agentConfig } from './config/agent-config.js';
import { storeResearchPending, storeResearchResult, storeResearchError, getResearchResult } from './utils/research-storage.js';

// Import all specialist agents
import { TriageAgent } from './agents/triage-agent.js';
import { PainWhispererAgent } from './agents/pain-whisperer-agent.js';
import { MovementDetectiveAgent } from './agents/movement-detective-agent.js';
import { StrengthSageAgent } from './agents/strength-sage-agent.js';
import { MindMenderAgent } from './agents/mind-mender-agent.js';
import { ResearchAgent } from './agents/research-agent.js';

// Load environment variables
dotenv.config();

// Helper function to check if consultation meets quality thresholds for MD review
function shouldFlagForMDReview(result) {
  // Check specialist count (3+, excluding triage)
  const specialistCount = result.participatingSpecialists
    ?.filter(specialist => specialist !== 'triage')
    .length || 0;
  if (specialistCount < 3) return { flag: false };

  // Calculate average confidence from responses
  const confidences = result.responses
    ?.filter(r => r.confidence != null)
    ?.map(r => r.confidence) || [];
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  // Check thresholds: confidence > 0.7 OR predicted accuracy > 0.85
  const meetsConfidenceThreshold = avgConfidence > 0.7;
  const predictedAccuracy = result.synthesizedRecommendations?.coordinationMetadata?.predictedAccuracy;
  const meetsPredictedAccuracy = predictedAccuracy > 0.85;

  // Debug logging
  logger.info(`MD Review check: specialists=${specialistCount}, avgConfidence=${avgConfidence.toFixed(2)}, predictedAccuracy=${predictedAccuracy?.toFixed(2) || 'N/A'}`);

  if (meetsConfidenceThreshold || meetsPredictedAccuracy) {
    return {
      flag: true,
      qualityScore: avgConfidence,
      specialistCount,
      reason: meetsConfidenceThreshold ? 'high_confidence' : 'high_predicted_accuracy'
    };
  }

  return { flag: false };
}

// API call to flag consultation for MD review (fails silently)
async function flagConsultationForMDReview(consultationId, qualityScore) {
  try {
    const response = await fetch(`http://localhost:3001/api/consultations/${consultationId}/flag-for-review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requiresReview: true,
        qualityScore
      })
    });

    if (!response.ok) {
      logger.warn(`Failed to flag consultation ${consultationId} for MD review: ${response.status}`);
    } else {
      logger.info(`Consultation ${consultationId} flagged for MD review (quality: ${qualityScore.toFixed(2)})`);
    }
  } catch (error) {
    logger.error(`Error flagging consultation for MD review: ${error.message}`);
  }
}

function extractBodyPart(symptoms) {
  if (!symptoms) return null;
  const text = Array.isArray(symptoms) ? symptoms.join(' ') : String(symptoms);
  const bodyParts = [
    // Multi-word terms first so they match before their single-word substrings
    'lower back', 'humeral head', 'greater tuberosity', 'lesser tuberosity',
    'proximal humerus', 'acromioclavicular', 'radial head', 'lateral epicondyle',
    'medial epicondyle', 'distal radius', 'femoral neck', 'femoral head',
    'intertrochanteric', 'subtrochanteric', 'greater trochanter', 'lesser trochanter',
    'tibial plateau', 'femoral condyle', 'lateral condyle', 'medial condyle',
    'proximal tibia', 'distal femur', 'lateral plateau', 'medial plateau',
    'lateral malleolus', 'medial malleolus', 'distal fibula', 'distal tibia',
    // Joint names
    'knee', 'shoulder', 'hip', 'ankle', 'wrist', 'elbow', 'back', 'neck', 'spine', 'foot', 'hand',
    // Long bones
    'clavicle', 'collarbone', 'clavicular', 'scapula', 'humerus',
    'tibia', 'fibula', 'femur', 'patella', 'radius', 'ulna',
    'sternum', 'rib', 'pelvis', 'sacrum', 'forearm', 'thumb', 'finger', 'toe', 'heel',
    // Shoulder sub-structures
    'glenohumeral', 'glenoid', 'acromion', 'coracoid',
    // Elbow sub-structures
    'olecranon', 'capitellum', 'coronoid',
    // Wrist/hand sub-structures
    'scaphoid', 'lunate', 'hamate', 'capitate', 'carpal', 'metacarpal', 'phalanx', 'phalanges',
    // Hip sub-structures
    'acetabulum',
    // Ankle/foot sub-structures
    'talus', 'calcaneus', 'navicular', 'cuboid', 'metatarsal', 'malleolus',
    // Spine sub-structures
    'lumbar', 'cervical', 'thoracic', 'vertebra', 'vertebrae', 'sacral', 'coccyx',
  ];
  const lower = text.toLowerCase();
  return bodyParts.find(part => lower.includes(part)) || null;
}

function summarizeAgentResponses(responses) {
  if (!responses || !Array.isArray(responses)) return '';
  return responses
    .map(r => `${r.specialist || r.agent}: ${r.summary || r.recommendation || ''}`)
    .filter(Boolean)
    .join('; ');
}

class OrthoIQAgentSystem {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;

    // Core system components
    this.tokenManager = new TokenManager();
    this.coordinator = new AgentCoordinator(this.tokenManager); // Pass token manager for prediction market
    this.recoveryMetrics = new RecoveryMetrics();
    this.blockchainUtils = new BlockchainUtils();
    this.accountManager = new CdpAccountManager();

    // Agent registry
    this.agents = {};
    this.researchAgent = null;
    this.researchResults = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      logger.info('🚀 Initializing OrthoIQ Agent System');
      
      // Setup Express middleware
      this.setupMiddleware();
      
      // Initialize blockchain utilities
      await this.initializeBlockchain();
      
      // Initialize CDP account manager
      await this.initializeAccountManager();

      // Run database migrations
      await this.runMigrations();

      // Create and register agents
      await this.createAgents();
      
      // Initialize token economics
      await this.initializeTokenEconomics();
      
      // Setup API routes
      this.setupRoutes();
      
      // Setup error handling
      this.setupErrorHandling();
      
      this.isInitialized = true;
      logger.info('✅ OrthoIQ Agent System initialized successfully');
      
      return true;
    } catch (error) {
      logger.error(`❌ System initialization failed: ${error.message}`);
      return false;
    }
  }

  setupMiddleware() {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // CORS middleware
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Request logging middleware
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  async initializeBlockchain() {
    try {
      logger.info('🔗 Initializing blockchain utilities');
      await this.blockchainUtils.initialize();
      logger.info('✅ Blockchain connection established');
    } catch (error) {
      logger.warn(`⚠️  Blockchain initialization failed, running in offline mode: ${error.message}`);
    }
  }

  async initializeAccountManager() {
    try {
      if (process.env.ENABLE_BLOCKCHAIN === 'true') {
        logger.info('🏦 Initializing CDP Account Manager');
        await this.accountManager.initialize();
        logger.info('✅ CDP Account Manager initialized');
      } else {
        logger.info('ℹ️  CDP Account Manager disabled (blockchain disabled)');
      }
    } catch (error) {
      logger.warn(`⚠️  CDP Account Manager initialization failed: ${error.message}`);
      // Set account manager to null so agents know not to use it
      this.accountManager = null;
    }
  }

  async runMigrations() {
    const sql = (await import('./utils/db.js')).default;
    if (!sql) {
      logger.warn('⚠️  DATABASE_URL not set — skipping migrations');
      return;
    }
    try {
      await sql`CREATE TABLE IF NOT EXISTS research_results (
        id SERIAL PRIMARY KEY,
        consultation_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'failed')),
        intro TEXT,
        citations JSONB,
        search_query TEXT,
        studies_reviewed INTEGER,
        tier TEXT CHECK (tier IN ('basic', 'premium')),
        error TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_research_consultation_id ON research_results(consultation_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_research_status ON research_results(status)`;
      logger.info('✅ Database migrations complete');
    } catch (error) {
      logger.error(`⚠️  Database migration failed: ${error.message}`);
      // Non-fatal: system can still run without research persistence
    }
  }

  async createAgents() {
    try {
      logger.info('👥 Creating specialist agents');
      
      // Create all specialist agents - but wait for their initialization
      const triageAgent = new TriageAgent('OrthoTriage Master', this.accountManager);
      await this.waitForAgentInitialization(triageAgent);
      
      const painWhispererAgent = new PainWhispererAgent('Pain Whisperer', this.accountManager);
      await this.waitForAgentInitialization(painWhispererAgent);
      
      const movementDetectiveAgent = new MovementDetectiveAgent('Movement Detective', this.accountManager);
      await this.waitForAgentInitialization(movementDetectiveAgent);
      
      const strengthSageAgent = new StrengthSageAgent('Strength Sage', this.accountManager);
      await this.waitForAgentInitialization(strengthSageAgent);
      
      const mindMenderAgent = new MindMenderAgent('Mind Mender', this.accountManager);
      await this.waitForAgentInitialization(mindMenderAgent);
      
      this.agents = {
        triage: triageAgent,
        painWhisperer: painWhispererAgent,
        movementDetective: movementDetectiveAgent,
        strengthSage: strengthSageAgent,
        mindMender: mindMenderAgent
      };
      
      // Create research agent (not a clinical specialist, kept separate from this.agents)
      if (agentConfig.research.enabled) {
        const researchAgent = new ResearchAgent('Research Pioneer', this.accountManager);
        await this.waitForAgentInitialization(researchAgent);
        this.researchAgent = researchAgent;
        logger.info(`✓ ${researchAgent.name} - medical literature research`);
      } else {
        logger.info('ℹ️  Research agent disabled (ENABLE_RESEARCH_AGENT=false)');
      }

      // Register agents with coordinator
      Object.entries(this.agents).forEach(([type, agent]) => {
        this.coordinator.registerSpecialist(type, agent);
        
        // Register with triage agent's specialist network
        if (type !== 'triage') {
          this.agents.triage.registerSpecialist(type, agent);
        }
        
        logger.info(`✓ ${agent.name} - ${agent.subspecialty}`);
      });
      
      logger.info('✅ All agents created and registered');
    } catch (error) {
      logger.error(`❌ Agent creation failed: ${error.message}`);
      throw error;
    }
  }
  
  async waitForAgentInitialization(agent, timeout = 30000) {
    const start = Date.now();
    
    while (!agent.walletAddress && (Date.now() - start) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!agent.walletAddress) {
      logger.warn(`Agent ${agent.name} wallet initialization timed out after ${timeout}ms`);
    } else {
      logger.info(`Agent ${agent.name} wallet initialization completed: ${agent.walletAddress}`);
    }
  }

  async initializeTokenEconomics() {
    try {
      logger.info('💰 Initializing token economics');
      
      // Initialize wallets for all agents
      for (const [type, agent] of Object.entries(this.agents)) {
        await this.tokenManager.initializeAgentWallet(agent);
        logger.info(`✓ Wallet initialized for ${agent.name}`);
      }
      
      // Initialize wallet for research agent
      if (this.researchAgent) {
        await this.tokenManager.initializeAgentWallet(this.researchAgent);
        logger.info(`✓ Wallet initialized for ${this.researchAgent.name}`);
      }

      // Initialize token contract with first available wallet provider
      const firstAgent = Object.values(this.agents)[0];
      if (firstAgent && firstAgent.walletProvider) {
        const tokenContract = await this.tokenManager.initializeTokenContract(firstAgent.walletProvider);
        if (tokenContract) {
          logger.info(`✓ Token contract: ${tokenContract.tokenAddress}`);
        }
      }
      
      logger.info('✅ Token economics initialized');
    } catch (error) {
      logger.error(`❌ Token initialization failed: ${error.message}`);
      throw error;
    }
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        system: 'OrthoIQ Agents',
        agents: Object.keys(this.agents).length,
        blockchain: this.blockchainUtils ? 'connected' : 'offline',
        researchAgent: {
          enabled: !!this.researchAgent,
          pubmedConfigured: !!agentConfig.pubmed?.apiKey,
          walletAddress: this.researchAgent?.walletAddress || null,
        },
      });
    });

    // System status endpoint with performance metrics
    this.app.get('/status', async (req, res) => {
      try {
        const coordinationStats = this.coordinator.getCoordinationStatistics();
        const networkStats = this.tokenManager.getNetworkStatistics();
        const recoveryStats = this.recoveryMetrics.getRecoveryStatistics();
        const blockchainStats = await this.blockchainUtils.getNetworkStatistics();
        const cacheStats = cacheManager.getStats();
        const promptStats = promptManager.getStats();

        res.json({
          system: {
            initialized: this.isInitialized,
            uptime: process.uptime(),
            version: '2.0.0', // Updated version with optimizations
            optimizationsEnabled: true
          },
          performance: {
            cache: cacheStats,
            prompts: promptStats,
            averageResponseTime: coordinationStats.averageDuration,
            mode: 'optimized'
          },
          agents: Object.fromEntries(
            Object.entries(this.agents).map(([type, agent]) => [
              type,
              {
                name: agent.name,
                experience: agent.experience,
                tokenBalance: agent.tokenBalance,
                specialization: agent.subspecialty
              }
            ])
          ),
          researchAgent: this.researchAgent ? {
            name: this.researchAgent.name,
            experience: this.researchAgent.experience,
            tokenBalance: this.researchAgent.tokenBalance,
            statistics: this.researchAgent.getResearchStatistics(),
          } : null,
          coordination: coordinationStats,
          tokenEconomics: networkStats,
          recovery: recoveryStats,
          blockchain: blockchainStats
        });
      } catch (error) {
        logger.error(`Error getting system status: ${error.message}`);
        res.status(500).json({ error: 'Failed to get system status' });
      }
    });

    // Triage endpoint
    this.app.post('/triage', async (req, res) => {
      try {
        // Scope validation - early return if out of scope
        const scopeCheck = this.validateQueryScope(req, res);
        if (scopeCheck) return;

        const caseData = req.body;
        const triageResult = await this.agents.triage.triageCase(caseData);
        
        // Award tokens for successful triage
        await this.tokenManager.distributeTokenReward(this.agents.triage.agentId, {
          success: true,
          reason: 'api_triage'
        }, {
          walletProvider: this.agents.triage.walletProvider
        });

        res.json({
          success: true,
          triage: triageResult,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Triage API error: ${error.message}`);
        res.status(500).json({ error: 'Triage failed', message: error.message });
      }
    });

    // Multi-specialist consultation endpoint with caching and modes
    this.app.post('/consultation', async (req, res) => {
      try {
        // Scope validation - early return if out of scope
        const scopeCheck = this.validateQueryScope(req, res);
        if (scopeCheck) return;

        const {
          caseData,
          requiredSpecialists,
          mode = 'fast',
          platformContext
        } = req.body;
        const startTime = Date.now();

        // Extract new dual-track fields from caseData
        const {
          rawQuery,
          enableDualTrack,
          userId,
          isReturningUser,
          priorConsultations,
          requestResearch,
          uploadedImages,
          athleteProfile,
          userTier,
          ...traditionalCaseData
        } = caseData;

        // Check for noCache flag (query param or body param)
        const noCache = req.query.noCache === 'true' || req.body.noCache === true;
        const enableSimilarityCache = process.env.ENABLE_SIMILARITY_CACHE === 'true';

        // Check cache first (unless noCache is specified)
        if (!noCache && process.env.ENABLE_CACHE === 'true') {
          const cached = await cacheManager.get(caseData);
          if (cached) {
            logger.info(`Cache hit - returning cached consultation`);
            return res.json({
              success: true,
              consultation: cached.response,
              fromCache: true,
              responseTime: Date.now() - startTime,
              timestamp: new Date().toISOString()
            });
          }

          // Check for similar cases if similarity cache is enabled
          if (enableSimilarityCache) {
            const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.8;
            const similar = await cacheManager.findSimilar(caseData, similarityThreshold);
            if (similar) {
              logger.info(`Similar case found - returning adapted consultation`);
              return res.json({
                success: true,
                consultation: similar,
                fromCache: true,
                similarityMatch: true,
                responseTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            logger.debug('Similarity cache disabled - skipping similar case lookup');
          }
        } else if (noCache) {
          logger.info('Cache bypass requested via noCache flag');
        }
        
        // NEW: Triage-based smart routing
        const triageAssessment = await this.agents.triage.assessDataCompleteness(caseData);
        logger.info(`Data completeness: ${Math.round(triageAssessment.completeness * 100)}%, Confidence: ${Math.round(triageAssessment.confidence * 100)}%`);
        
        // Determine which specialists to involve based on data completeness
        let smartSpecialists;
        if (requiredSpecialists && requiredSpecialists.length > 0) {
          // If specific specialists requested, use them (honor explicit requests for testing/specific consultations)
          smartSpecialists = requiredSpecialists;
          logger.info(`Using explicitly requested specialists: ${smartSpecialists.join(', ')}`);
        } else if (triageAssessment.confidence > 0.7) {
          // High confidence - use triage recommendations
          smartSpecialists = triageAssessment.recommendedSpecialists;
        } else if (triageAssessment.minimumDataMet) {
          // Medium confidence - use limited specialists
          smartSpecialists = triageAssessment.recommendedSpecialists.slice(0, 3);
        } else {
          // Low confidence - triage only response
          logger.info('Data insufficient for multi-specialist consultation, using triage-only response');
          smartSpecialists = ['triage'];
        }
        
        logger.info(`Smart routing to specialists: ${smartSpecialists.join(', ')}`);

        // Heuristic pre-classification for query type
        const heuristicClassification = this.agents.triage.classifyQueryType(caseData);
        logger.info(`Heuristic classification: ${heuristicClassification.queryType} ` +
          `(confidence: ${heuristicClassification.confidence}, ` +
          `signals: ${JSON.stringify(heuristicClassification.signals)})`);

        // Fast mode: Return immediate triage response, continue full coordination in background
        if (mode === 'fast') {
          logger.info('Fast mode: Returning immediate triage, continuing coordination in background');

          // Get immediate triage-only response
          const triageAgent = this.agents.triage;
          const triageResponse = await triageAgent.triageCase(caseData, {
            rawQuery,
            enableDualTrack,
            userId,
            isReturningUser,
            platformContext
          });

          // Check if informational — either classifier saying informational is a confident signal
          // (both default to clinical when uncertain, so informational from either is trustworthy)
          const effectiveQueryType =
            (triageResponse.queryType === 'informational' || heuristicClassification.queryType === 'informational')
              ? 'informational'
              : 'clinical';
          logger.info(`Effective query type: ${effectiveQueryType} ` +
            `(triage: ${triageResponse.queryType}, heuristic: ${heuristicClassification.queryType})`);
          if (effectiveQueryType === 'informational') {
            logger.info('Fast mode: Informational query detected, skipping specialist pipeline');
            return this.handleInformationalQuery(res, {
              triageResponse,
              caseData,
              startTime,
              userTier,
              rawQuery
            });
          }

          const consultationId = `consultation_${Date.now()}`;

          // Auto-trigger research in background if not explicitly disabled
          let researchPollEndpoint = null;
          if (requestResearch !== false && this.researchAgent) {
            this.researchResults.set(consultationId, {
              status: 'processing',
              startedAt: new Date().toISOString(),
            });
            researchPollEndpoint = `/research/${consultationId}`;

            // Include triage output so research agent can build more specific queries
            const researchCaseData = { ...caseData, triageContext: triageResponse };
            this.researchAgent.curateRelevantStudies(researchCaseData, 'basic')
              .then(async (result) => {
                this.researchResults.set(consultationId, {
                  status: 'completed',
                  result,
                  completedAt: new Date().toISOString(),
                });
                try {
                  await this.tokenManager.distributeTokenReward(
                    this.researchAgent.agentId,
                    {
                      success: result.success,
                      literatureSearchCompleted: true,
                      relevantStudiesFound: result.citations?.length > 0,
                    },
                    { walletProvider: this.researchAgent.walletProvider }
                  );
                } catch (tokenErr) {
                  logger.warn(`Research token reward failed: ${tokenErr.message}`);
                }
              })
              .catch((err) => {
                this.researchResults.set(consultationId, {
                  status: 'failed',
                  error: err.message,
                  failedAt: new Date().toISOString(),
                });
                logger.error(`Auto-research failed for ${consultationId}: ${err.message}`);
              });
          }

          // Return immediately to user (target: <5s)
          res.json({
            success: true,
            mode: 'fast',
            triage: triageResponse,
            status: 'processing',
            message: 'Immediate triage assessment complete. Full multi-specialist consultation in progress.',
            consultationId,
            researchPollEndpoint,
            responseTime: Date.now() - startTime,
            timestamp: new Date().toISOString()
          });

          // Continue full coordination in background (fire-and-forget, no await)
          const backgroundPromise = this.coordinator.coordinateMultiSpecialistConsultation(
            caseData,
            smartSpecialists,
            {
              mode: 'normal', // Use normal mode for full coordination
              consultationId, // Pass the same ID to ensure consistency
              rawQuery,
              enableDualTrack,
              userId,
              isReturningUser,
              priorConsultations,
              requestResearch,
              uploadedImages,
              athleteProfile,
              platformContext
            }
          );

          // Handle background completion (no await - fire and forget)
          backgroundPromise
            .then(async result => {
              // Cache for training and future use
              await cacheManager.set(caseData, result);

              // Check if consultation meets quality thresholds for MD review
              const mdReviewCheck = shouldFlagForMDReview(result);
              if (mdReviewCheck.flag) {
                await flagConsultationForMDReview(consultationId, mdReviewCheck.qualityScore);
              }

              logger.info(`Background coordination complete for ${consultationId}, cached successfully`);
            })
            .catch(err => {
              logger.error(`Background coordination failed for ${consultationId}:`, err.message);
            });

          // Exit early - response already sent
          return;
        }

        // Normal mode: Run triage for query type classification
        const triageForClassification = await this.agents.triage.triageCase(caseData, {
          rawQuery, enableDualTrack
        });

        const effectiveQueryTypeNormal =
          (triageForClassification.queryType === 'informational' || heuristicClassification.queryType === 'informational')
            ? 'informational'
            : 'clinical';
        logger.info(`Effective query type: ${effectiveQueryTypeNormal} ` +
          `(triage: ${triageForClassification.queryType}, heuristic: ${heuristicClassification.queryType})`);
        if (effectiveQueryTypeNormal === 'informational') {
          logger.info('Normal mode: Informational query detected, skipping specialist pipeline');
          return this.handleInformationalQuery(res, {
            triageResponse: triageForClassification,
            caseData,
            startTime,
            userTier,
            rawQuery
          });
        }

        // Normal mode: Complete multi-specialist consultation before responding
        // Set timeout for normal mode - 90s to accommodate parallel coordination + synthesis
        const timeout = 120000;
        const consultationPromise = this.coordinator.coordinateMultiSpecialistConsultation(
          caseData,
          smartSpecialists,
          {
            mode,
            rawQuery,
            enableDualTrack,
            userId,
            isReturningUser,
            priorConsultations,
            requestResearch,
            uploadedImages,
            athleteProfile,
            platformContext
          }
        );

        // Race against timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Consultation timeout')), timeout)
        );

        const consultationResult = await Promise.race([
          consultationPromise,
          timeoutPromise
        ]);
        
        // Enhance result with triage metadata
        consultationResult.dataCompleteness = triageAssessment.completeness;
        consultationResult.suggestedFollowUp = triageAssessment.suggestedFollowUp;
        consultationResult.triageConfidence = triageAssessment.confidence;
        consultationResult.specialistCoverage = this.agents.triage.getSpecialistCoverage(
          caseData, 
          consultationResult.participatingSpecialists
        );
        
        // Cache successful result
        await cacheManager.set(caseData, consultationResult);

        // Trigger research asynchronously (non-blocking)
        let researchPollEndpoint = null;
        if (requestResearch !== false && this.researchAgent) {
          researchPollEndpoint = `/research/${consultationResult.consultationId}`;
          this.triggerResearchAgent(
            consultationResult.consultationId,
            caseData,
            consultationResult,
            userTier || 'basic'
          ).catch(err => {
            logger.error(`Research agent background error: ${err.message}`);
          });
        }

        // Trigger learning mode in background if needed
        if (mode === 'fast' && promptManager.shouldRunLearningMode(caseData, consultationResult, this.agents.triage)) {
          setImmediate(() => {
            this.runLearningMode(caseData, consultationResult);
          });
        }

        res.json({
          success: true,
          consultation: consultationResult,
          research: researchPollEndpoint ? {
            status: 'pending',
            estimatedSeconds: 15,
            pollEndpoint: researchPollEndpoint,
          } : undefined,
          fromCache: false,
          mode,
          responseTime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Consultation API error: ${error.message}`);
        
        // Return timeout error with appropriate status
        if (error.message.includes('timeout')) {
          res.status(504).json({ 
            error: 'Consultation timeout', 
            message: 'Request exceeded time limit, please try again',
            mode: req.body.mode
          });
        } else {
          res.status(500).json({ error: 'Consultation failed', message: error.message });
        }
      }
    });

    // Recovery tracking endpoints
    this.app.post('/recovery/start', async (req, res) => {
      try {
        const { patientId, initialAssessment } = req.body;
        
        const trackingResult = await this.recoveryMetrics.trackPatientRecovery(
          patientId,
          initialAssessment
        );

        res.json({
          success: true,
          tracking: trackingResult,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Recovery start API error: ${error.message}`);
        res.status(500).json({ error: 'Recovery tracking start failed', message: error.message });
      }
    });

    this.app.post('/recovery/update', async (req, res) => {
      try {
        const { patientId, progressData } = req.body;
        
        const updateResult = await this.recoveryMetrics.updateRecoveryProgress(
          patientId,
          progressData
        );

        // Award tokens for significant progress
        const metrics = updateResult.progressUpdate.metrics;
        if (metrics.painReduction >= 50 || metrics.functionalImprovement >= 70) {
          for (const agent of Object.values(this.agents)) {
            await this.tokenManager.distributeTokenReward(agent.agentId, {
              success: true,
              reason: 'progress_milestone',
              painReduction: metrics.painReduction || 0,
              functionalImprovement: metrics.functionalImprovement >= 70
            }, {
              walletProvider: agent.walletProvider
            });
          }
        }

        res.json({
          success: true,
          update: updateResult,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Recovery update API error: ${error.message}`);
        res.status(500).json({ error: 'Recovery update failed', message: error.message });
      }
    });

    this.app.post('/recovery/complete', async (req, res) => {
      try {
        const { patientId, finalOutcome } = req.body;
        
        const completionResult = await this.recoveryMetrics.completeRecoveryTracking(
          patientId,
          finalOutcome
        );

        // Record outcome on blockchain
        let blockchainRecord = null;
        if (await this.blockchainUtils.isConnected()) {
          blockchainRecord = await this.blockchainUtils.recordMedicalOutcome(
            patientId,
            finalOutcome,
            'recovery_team'
          );
        }

        // Distribute final rewards
        const outcome = {
          success: completionResult.success,
          mdApproval: true,
          userSatisfaction: finalOutcome.patientSatisfaction || 0,
          functionalImprovement: completionResult.finalMetrics.totalFunctionalImprovement >= 80,
          returnToActivity: finalOutcome.returnToActivity || false
        };

        const rewards = [];
        for (const agent of Object.values(this.agents)) {
          const reward = await this.tokenManager.distributeTokenReward(agent.agentId, outcome, {
            walletProvider: agent.walletProvider
          });
          rewards.push({ agent: agent.name, tokens: reward.amount });
        }

        res.json({
          success: true,
          completion: completionResult,
          blockchainRecord,
          rewards,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Recovery completion API error: ${error.message}`);
        res.status(500).json({ error: 'Recovery completion failed', message: error.message });
      }
    });

    // Agent-specific endpoints
    this.app.post('/agents/:agentType/assess', async (req, res) => {
      try {
        // Scope validation - early return if out of scope
        const scopeCheck = this.validateQueryScope(req, res);
        if (scopeCheck) return;

        const { agentType } = req.params;
        const assessmentData = req.body;

        const agent = this.agents[agentType];
        if (!agent) {
          return res.status(404).json({ error: 'Agent not found' });
        }

        let result;
        switch (agentType) {
          case 'painWhisperer':
            result = await agent.assessPain(assessmentData);
            break;
          case 'movementDetective':
            result = await agent.analyzeMovementPattern(assessmentData);
            break;
          case 'strengthSage':
            result = await agent.assessFunctionalCapacity(assessmentData);
            break;
          case 'mindMender':
            result = await agent.assessPsychologicalFactors(assessmentData);
            break;
          default:
            result = await agent.processMessage(JSON.stringify(assessmentData));
        }

        // Process outcome for token rewards if outcome data is provided
        if (assessmentData.outcome && assessmentData.outcome.success) {
          try {
            await agent.updateExperienceWithTokens(assessmentData.outcome);
            logger.info(`Token rewards processed for ${agent.name} based on successful outcome`);
          } catch (tokenError) {
            logger.warn(`Token reward processing failed for ${agent.name}: ${tokenError.message}`);
          }
        }

        res.json({
          success: true,
          agent: agent.name,
          assessment: result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Agent assessment API error: ${error.message}`);
        res.status(500).json({ error: 'Agent assessment failed', message: error.message });
      }
    });

    // Cache management endpoints
    this.app.post('/cache/clear', (req, res) => {
      try {
        cacheManager.clear();
        logger.info('Cache cleared via API endpoint');

        res.json({
          success: true,
          message: 'Cache cleared successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Cache clear API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to clear cache', message: error.message });
      }
    });

    this.app.get('/cache/stats', (req, res) => {
      try {
        const stats = cacheManager.getStats();

        res.json({
          success: true,
          stats,
          similarityCacheEnabled: process.env.ENABLE_SIMILARITY_CACHE === 'true',
          similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.8,
          cacheEnabled: process.env.ENABLE_CACHE === 'true',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Cache stats API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to get cache stats', message: error.message });
      }
    });

    // Token management endpoints
    this.app.get('/tokens/balance/:agentId', (req, res) => {
      try {
        const { agentId } = req.params;
        const balance = this.tokenManager.getAgentBalance(agentId);
        
        if (!balance) {
          return res.status(404).json({ error: 'Agent not found' });
        }

        res.json({
          success: true,
          balance,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Token balance API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to get token balance', message: error.message });
      }
    });

    this.app.get('/tokens/statistics', (req, res) => {
      try {
        const stats = this.tokenManager.getNetworkStatistics();
        res.json({
          success: true,
          statistics: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Token statistics API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to get token statistics', message: error.message });
      }
    });

    // Prediction market endpoints
    this.app.get('/predictions/market/statistics', (req, res) => {
      try {
        const marketStats = this.coordinator.getPredictionMarketStats();

        if (!marketStats) {
          return res.json({
            success: true,
            message: 'Prediction market not initialized',
            statistics: null
          });
        }

        res.json({
          success: true,
          statistics: marketStats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Prediction market stats API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to get prediction market statistics', message: error.message });
      }
    });

    this.app.get('/predictions/agent/:agentId', (req, res) => {
      try {
        const { agentId } = req.params;
        const performance = this.coordinator.getAgentPredictionPerformance(agentId);

        if (!performance) {
          return res.status(404).json({ error: 'Agent prediction performance not found' });
        }

        res.json({
          success: true,
          agentId,
          performance,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Agent prediction performance API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to get agent prediction performance', message: error.message });
      }
    });

    this.app.post('/predictions/resolve/md-review', async (req, res) => {
      try {
        const { consultationId, mdReviewData } = req.body;

        if (!consultationId || !mdReviewData) {
          return res.status(400).json({ error: 'consultationId and mdReviewData are required' });
        }

        const resolution = await this.coordinator.resolveMDReviewPredictions(consultationId, mdReviewData);

        res.json({
          success: true,
          consultationId,
          resolution,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`MD review resolution API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to resolve MD review predictions', message: error.message });
      }
    });

    this.app.post('/predictions/resolve/user-modal', async (req, res) => {
      try {
        const { consultationId, userFeedback } = req.body;

        if (!consultationId || !userFeedback) {
          return res.status(400).json({ error: 'consultationId and userFeedback are required' });
        }

        const resolution = await this.coordinator.resolveUserModalPredictions(consultationId, userFeedback);

        res.json({
          success: true,
          consultationId,
          resolution,
          // Cascading resolution metadata (for frontend to display)
          cascadingResolution: resolution?.cascadingResolution || null,
          recommendMDReview: resolution?.cascadingResolution?.recommendMDReview || false,
          totalAgentsResolved: resolution?.cascadingResolution?.totalAgentsResolved || 0,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`User modal resolution API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to resolve user modal predictions', message: error.message });
      }
    });

    this.app.post('/predictions/resolve/follow-up', async (req, res) => {
      try {
        const { consultationId, followUpData } = req.body;

        if (!consultationId || !followUpData) {
          return res.status(400).json({ error: 'consultationId and followUpData are required' });
        }

        const resolution = await this.coordinator.resolveFollowUpPredictions(consultationId, followUpData);

        res.json({
          success: true,
          consultationId,
          resolution,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Follow-up resolution API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to resolve follow-up predictions', message: error.message });
      }
    });

    // Research endpoints
    this.app.post('/research/trigger', async (req, res) => {
      try {
        const { consultationId, caseData, consultationResult, userTier = 'basic' } = req.body;

        if (!consultationId || !caseData || !consultationResult) {
          return res.status(400).json({ error: 'consultationId, caseData, and consultationResult are required' });
        }

        if (!this.researchAgent) {
          return res.status(503).json({ error: 'Research agent not available' });
        }

        // Idempotency check: skip if research already running or complete
        try {
          const existing = await getResearchResult(consultationId);
          if (existing) {
            if (existing.status === 'complete') {
              logger.info(`Research already complete for ${consultationId}, skipping duplicate trigger`);
              return res.json({ success: true, consultationId, status: 'complete' });
            }
            if (existing.status === 'pending') {
              logger.info(`Research already in progress for ${consultationId}, skipping duplicate trigger`);
              return res.json({ success: true, consultationId, status: 'pending', estimatedSeconds: 15 });
            }
            // status === 'failed': allow re-triggering
          }
        } catch (dbErr) {
          logger.warn(`DB idempotency check failed, proceeding with trigger: ${dbErr.message}`);
        }

        // Also check in-memory (handles case where DB check fails)
        const inMem = this.researchResults.get(consultationId);
        if (inMem && (inMem.status === 'processing' || inMem.status === 'completed')) {
          logger.info(`Research in-memory for ${consultationId}, skipping duplicate trigger`);
          return res.json({ success: true, consultationId, status: 'pending', estimatedSeconds: 15 });
        }

        // Store in-memory immediately (DB is optional)
        this.researchResults.set(consultationId, {
          status: 'processing',
          startedAt: new Date().toISOString(),
        });

        // Try DB, non-fatal
        try {
          await storeResearchPending(consultationId);
        } catch (dbErr) {
          logger.warn(`DB unavailable — using in-memory for ${consultationId}: ${dbErr.message}`);
        }

        // Return immediately before background processing
        res.json({
          success: true,
          consultationId,
          status: 'pending',
          estimatedSeconds: 15
        });

        // Build enriched query — fall back to consultationResult.caseData when frontend
        // sends minimal caseData (only primaryComplaint)
        const fallbackCase = consultationResult?.caseData || {};
        const enrichedQuery = {
          primaryComplaint: caseData.primaryComplaint || fallbackCase.primaryComplaint || '',
          symptoms: caseData.symptoms || fallbackCase.symptoms,
          duration: caseData.duration || fallbackCase.duration,
          location: caseData.location || fallbackCase.location,
          bodyPart: extractBodyPart(caseData.symptoms || fallbackCase.symptoms || caseData.primaryComplaint || fallbackCase.primaryComplaint),
          triageContext: consultationResult?.triage ||
            consultationResult?.responses?.find(r => r.response?.specialistType === 'triage')?.response,
          agentRecommendations: summarizeAgentResponses(consultationResult?.responses),
          rawQuery: caseData.rawQuery || fallbackCase.rawQuery,
        };

        // Fire-and-forget: curate studies in background with 15s timeout
        const RESEARCH_TIMEOUT_MS = 15000;
        Promise.race([
          this.researchAgent.curateRelevantStudies(enrichedQuery, userTier),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Research timed out after 15 seconds')), RESEARCH_TIMEOUT_MS)
          )
        ])
          .then(async (result) => {
            // Always update in-memory first
            this.researchResults.set(consultationId, {
              status: 'completed',
              result,
              completedAt: new Date().toISOString(),
            });

            // Try DB, non-fatal
            try {
              await storeResearchResult(consultationId, {
                intro: result.intro,
                citations: result.citations,
                searchQuery: result.searchQuery,
                studiesReviewed: result.totalFound,
                tier: userTier
              });
            } catch (dbErr) {
              logger.warn(`DB persist failed: ${dbErr.message}`);
            }

            // Award tokens for successful research
            try {
              const outcome = {
                success: result.success,
                literatureSearchCompleted: true,
                relevantStudiesFound: result.citations?.length > 0,
                highImpactJournal: result.citations?.some(c => c.qualityScore >= 15),
                recentEvidence: result.citations?.some(c => parseInt(c.year) >= new Date().getFullYear() - 2),
                multipleStudyTypes: new Set(result.citations?.map(c => c.studyType)).size > 1,
              };
              await this.tokenManager.distributeTokenReward(
                this.researchAgent.agentId,
                outcome,
                { walletProvider: this.researchAgent.walletProvider }
              );
            } catch (tokenErr) {
              logger.warn(`Research token reward failed: ${tokenErr.message}`);
            }

            logger.info(`Research completed for ${consultationId}: ${result.citations?.length || 0} citations`);
          })
          .catch(async (err) => {
            // Persist error to DB
            try {
              await storeResearchError(consultationId, err.message);
            } catch (dbErr) {
              logger.error(`Failed to persist research error to DB: ${dbErr.message}`);
            }

            // Backward compat: update in-memory map
            this.researchResults.set(consultationId, {
              status: 'failed',
              error: err.message,
              failedAt: new Date().toISOString(),
            });
            logger.error(`Research failed for ${consultationId}: ${err.message}`);
          });
      } catch (error) {
        logger.error(`Research trigger API error: ${error.message}`);
        res.status(500).json({ error: 'Research trigger failed', message: error.message });
      }
    });

    this.app.get('/research/:consultationId', async (req, res) => {
      try {
        const { consultationId } = req.params;

        let row = null;
        try {
          row = await getResearchResult(consultationId);
        } catch (dbErr) {
          logger.info(`DB unavailable for poll, checking in-memory: ${dbErr.message}`);
        }

        // In-memory fallback when DB unavailable or record not yet persisted
        if (!row) {
          const mem = this.researchResults.get(consultationId);
          if (mem) {
            if (mem.status === 'processing') {
              row = { status: 'pending', created_at: mem.startedAt };
            } else if (mem.status === 'completed') {
              row = {
                status: 'complete',
                intro: mem.result?.intro,
                citations: JSON.stringify(mem.result?.citations || []),
                search_query: mem.result?.searchQuery,
                studies_reviewed: mem.result?.studiesReviewed,
                tier: mem.result?.tier,
              };
            } else if (mem.status === 'failed') {
              row = { status: 'failed', error: mem.error };
            }
          }
        }

        if (!row) {
          return res.status(404).json({ status: 'not_found', error: 'No research request found for this consultation' });
        }

        if (row.status === 'pending') {
          const elapsedSeconds = (Date.now() - new Date(row.created_at).getTime()) / 1000;
          const estimatedSeconds = Math.max(0, 15 - Math.round(elapsedSeconds));
          return res.json({ status: 'pending', estimatedSeconds });
        }

        if (row.status === 'complete') {
          let citations = [];
          try {
            // citations column is JSONB — postgres.js auto-deserializes on SELECT,
            // so row.citations arrives as a JS Array, not a JSON string.
            citations = Array.isArray(row.citations) ? row.citations : JSON.parse(row.citations);
          } catch (_) { /* default to [] */ }

          return res.json({
            status: 'complete',
            research: {
              intro: row.intro,
              citations,
              searchQuery: row.search_query,
              studiesReviewed: row.studies_reviewed,
              tier: row.tier,
            },
          });
        }

        if (row.status === 'failed') {
          return res.json({
            status: 'failed',
            error: row.error,
            fallback: 'Research unavailable - recommendations based on clinical guidelines',
          });
        }

        res.json({ status: row.status });
      } catch (error) {
        logger.error(`Research poll API error: ${error.message}`);
        res.status(500).json({ error: 'Failed to get research status', message: error.message });
      }
    });

    // API documentation endpoint
    this.app.get('/docs', (req, res) => {
      res.json({
        name: 'OrthoIQ Agents API',
        version: '1.0.1',
        description: 'Multi-agent recovery ecosystem with token economics',
        endpoints: {
          health: 'GET /health - System health check',
          status: 'GET /status - Detailed system status',
          triage: 'POST /triage - Triage a patient case',
          consultation: 'POST /consultation - Multi-specialist consultation (supports ?noCache=true query param)',
          recovery: {
            start: 'POST /recovery/start - Start recovery tracking',
            update: 'POST /recovery/update - Update recovery progress',
            complete: 'POST /recovery/complete - Complete recovery tracking'
          },
          agents: 'POST /agents/:agentType/assess - Agent-specific assessment',
          cache: {
            clear: 'POST /cache/clear - Clear consultation cache',
            stats: 'GET /cache/stats - Get cache statistics and configuration'
          },
          tokens: {
            balance: 'GET /tokens/balance/:agentId - Get agent token balance',
            statistics: 'GET /tokens/statistics - Get network token statistics'
          },
          predictions: {
            marketStatistics: 'GET /predictions/market/statistics - Get prediction market statistics',
            agentPerformance: 'GET /predictions/agent/:agentId - Get agent prediction performance',
            resolveMDReview: 'POST /predictions/resolve/md-review - Resolve predictions with MD review data',
            resolveUserModal: 'POST /predictions/resolve/user-modal - Resolve predictions with user feedback modal',
            resolveFollowUp: 'POST /predictions/resolve/follow-up - Resolve predictions with user follow-up data'
          },
          research: {
            trigger: 'POST /research/trigger - Trigger async research literature curation',
            poll: 'GET /research/:consultationId - Poll research status and results'
          }
        },
        agents: Object.fromEntries(
          Object.entries(this.agents).map(([type, agent]) => [
            type,
            { name: agent.name, specialization: agent.subspecialty }
          ])
        )
      });
    });
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
        availableEndpoints: '/docs'
      });
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      logger.error(`API Error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });
  }

  /**
   * Validate query scope before processing
   * Returns response object if out of scope, null if should continue
   */
  validateQueryScope(req, res) {
    const caseData = req.body.caseData || req.body;
    const query = caseData.rawQuery || caseData.primaryComplaint || caseData.symptoms || '';

    logger.info({
      event: 'scope_validation_start',
      hasCaseData: !!req.body.caseData,
      extractedQuery: query?.substring(0, 100),
      validationEnabled: process.env.ENABLE_SCOPE_VALIDATION
    });

    const validation = validateScope(query, caseData);

    logger.info({
      event: 'scope_validation_result',
      passToAgent: validation.passToAgent,
      category: validation.category,
      detectedCategory: validation.detectedCategory,
      matchedTerms: validation.matchedTerms,
      confidence: validation.confidence
    });

    if (!validation.passToAgent) {
      logger.info({
        event: 'scope_validation_rejected',
        reason: validation.detectedCategory,
        redirecting: true
      });
      return res.status(200).json({
        success: false,
        scopeValidation: {
          category: 'out_of_scope',
          message: validation.redirectMessage,
          detectedCondition: validation.detectedCategory,
          confidence: validation.confidence
        },
        recommendation: 'CONSULT_APPROPRIATE_PROVIDER',
        timestamp: new Date().toISOString()
      });
    }
    return null; // Continue normal processing
  }

  async start() {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('System initialization failed');
      }

      return new Promise((resolve, reject) => {
        this.server = this.app.listen(this.port, (error) => {
          if (error) {
            reject(error);
          } else {
            logger.info(`🌐 OrthoIQ Agents API server listening on port ${this.port}`);
            logger.info(`📚 API Documentation: http://localhost:${this.port}/docs`);
            logger.info(`💚 Health Check: http://localhost:${this.port}/health`);
            resolve(this.server);
          }
        });
      });
    } catch (error) {
      logger.error(`❌ Failed to start server: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info('🛑 OrthoIQ Agents API server stopped');
          resolve();
        });
      });
    }
  }
  
  /**
   * Trigger research agent asynchronously - persists to DB, awards tokens.
   * Call fire-and-forget (.catch() errors in the caller).
   */
  async triggerResearchAgent(consultationId, caseData, consultationResult, userTier) {
    // Non-fatal: DB may not be configured on agents side — in-memory fallback handles polling
    try {
      await storeResearchPending(consultationId);
    } catch (dbErr) {
      logger.warn(`DB unavailable for research pending (${consultationId}): ${dbErr.message}`);
    }

    try {
      const RESEARCH_TIMEOUT_MS = 15000;
      const fallbackCase = consultationResult?.caseData || {};
      const enrichedQuery = {
        primaryComplaint: caseData.primaryComplaint || fallbackCase.primaryComplaint || '',
        symptoms: caseData.symptoms || fallbackCase.symptoms,
        duration: caseData.duration || fallbackCase.duration,
        location: caseData.location || fallbackCase.location,
        bodyPart: extractBodyPart(caseData.symptoms || fallbackCase.symptoms || caseData.primaryComplaint || fallbackCase.primaryComplaint),
        triageContext: consultationResult?.triage ||
          consultationResult?.responses?.find(r => r.response?.specialistType === 'triage')?.response,
        agentRecommendations: summarizeAgentResponses(consultationResult?.responses),
        rawQuery: caseData.rawQuery || fallbackCase.rawQuery,
      };

      const result = await Promise.race([
        this.researchAgent.curateRelevantStudies(enrichedQuery, userTier),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Research timed out after 15 seconds')), RESEARCH_TIMEOUT_MS)
        ),
      ]);

      // Non-fatal: persist to DB if available
      try {
        await storeResearchResult(consultationId, {
          intro: result.intro,
          citations: result.citations,
          searchQuery: result.searchQuery,
          studiesReviewed: result.totalFound,
          tier: userTier,
        });
      } catch (dbErr) {
        logger.warn(`DB unavailable for research result (${consultationId}): ${dbErr.message}`);
      }

      try {
        const outcome = {
          success: result.success,
          literatureSearchCompleted: true,
          relevantStudiesFound: result.citations?.length > 0,
          highImpactJournal: result.citations?.some(c => c.qualityScore >= 15),
          recentEvidence: result.citations?.some(c => parseInt(c.year) >= new Date().getFullYear() - 2),
          multipleStudyTypes: new Set(result.citations?.map(c => c.studyType)).size > 1,
        };
        await this.tokenManager.distributeTokenReward(
          this.researchAgent.agentId,
          outcome,
          { walletProvider: this.researchAgent.walletProvider }
        );
      } catch (tokenErr) {
        logger.warn(`Research token reward failed: ${tokenErr.message}`);
      }

      logger.info(`Research completed for ${consultationId}: ${result.citations?.length || 0} citations`);
    } catch (error) {
      try {
        await storeResearchError(consultationId, error.message);
      } catch (dbErr) {
        logger.error(`Failed to persist research error to DB: ${dbErr.message}`);
      }
      logger.error(`Research failed for ${consultationId}: ${error.message}`);
    }
  }

  /**
   * Handle informational queries — triage + research only, no specialists/prediction market.
   * Shared by both fast and normal mode.
   */
  handleInformationalQuery(res, { triageResponse, caseData, startTime, userTier, rawQuery }) {
    const consultationId = `info_${Date.now()}`;

    // Trigger research agent async (fire-and-forget)
    let researchPollEndpoint = null;
    if (this.researchAgent) {
      researchPollEndpoint = `/research/${consultationId}`;
      this.researchResults.set(consultationId, {
        status: 'processing',
        startedAt: new Date().toISOString(),
      });

      const researchCaseData = { ...caseData, triageContext: triageResponse };
      this.researchAgent.curateRelevantStudies(researchCaseData, userTier || 'basic')
        .then(async (result) => {
          this.researchResults.set(consultationId, {
            status: 'completed',
            result,
            completedAt: new Date().toISOString(),
          });
          try {
            const hasCitations = (result.citations?.length ?? 0) > 0;
            await this.tokenManager.distributeTokenReward(
              this.researchAgent.agentId,
              {
                success: hasCitations,
                literatureSearchCompleted: hasCitations,
                relevantStudiesFound: hasCitations && result.citations.length >= 3,
                highImpactJournal: hasCitations && result.citations.some(c => c.qualityScore >= 15),
                recentEvidence: hasCitations && result.citations.some(c => parseInt(c.year) >= new Date().getFullYear() - 2),
                multipleStudyTypes: hasCitations && new Set(result.citations.map(c => c.studyType)).size > 1,
              },
              { walletProvider: this.researchAgent.walletProvider, track: 'informational' }
            );
          } catch (tokenErr) {
            logger.warn(`Informational research token reward failed: ${tokenErr.message}`);
          }
        })
        .catch((err) => {
          this.researchResults.set(consultationId, {
            status: 'failed',
            error: err.message,
            failedAt: new Date().toISOString(),
          });
          logger.error(`Informational research failed for ${consultationId}: ${err.message}`);
        });
    }

    // Award flat triage token for classification
    this.tokenManager.distributeTokenReward(this.agents.triage.agentId, {
      reason: 'informational_triage'
    }, {
      walletProvider: this.agents.triage.walletProvider,
      track: 'informational'
    }).catch(err => {
      logger.warn(`Informational triage token reward failed: ${err.message}`);
    });

    return res.json({
      success: true,
      mode: 'informational',
      queryType: 'informational',
      querySubtype: triageResponse.querySubtype || null,
      triage: triageResponse,
      consultationId,
      researchPollEndpoint,
      message: 'Informational query — triage assessment with research literature.',
      responseTime: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Run learning mode analysis in background
   */
  async runLearningMode(caseData, fastResponse) {
    try {
      logger.info('Running learning mode analysis in background');
      
      // Use comprehensive prompts for deep analysis
      const learningPromises = Object.entries(this.agents).map(async ([type, agent]) => {
        const prompt = promptManager.getPrompt(agent, caseData, 'learning');
        return agent.processMessage(prompt.content, {
          mode: 'learning',
          fastResponse,
          caseData
        });
      });
      
      const learningResults = await Promise.allSettled(learningPromises);
      
      // Extract insights and patterns
      const insights = this.extractLearningInsights(learningResults);
      
      // Store for future training
      logger.info(`Learning mode completed: ${insights.patterns} patterns found`);
      
      return insights;
    } catch (error) {
      logger.error(`Learning mode error: ${error.message}`);
    }
  }
  
  extractLearningInsights(results) {
    // Process learning results for patterns
    return {
      patterns: results.filter(r => r.status === 'fulfilled').length,
      insights: results.map(r => r.value).filter(Boolean)
    };
  }
  
  async getStoredConsultation(consultationId) {
    // In production, this would query a database
    // For now, check in-memory cache
    try {
      // Check if consultation was cached
      if (this.consultationCache && this.consultationCache.has(consultationId)) {
        return this.consultationCache.get(consultationId);
      }

      logger.warn(`Consultation ${consultationId} not found in cache`);
      return null;
    } catch (error) {
      logger.error(`Error retrieving consultation: ${error.message}`);
      return null;
    }
  }
}

// Start the system if this file is run directly
async function main() {
  const system = new OrthoIQAgentSystem();
  
  try {
    await system.start();
    
    // Graceful shutdown handling
    process.on('SIGINT', async () => {
      logger.info('📴 Received SIGINT, shutting down gracefully');
      await system.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('📴 Received SIGTERM, shutting down gracefully');
      await system.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error(`❌ Failed to start OrthoIQ Agent System: ${error.message}`);
    process.exit(1);
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default OrthoIQAgentSystem;