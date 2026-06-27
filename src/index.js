#!/usr/bin/env node

/**
 * OrthoIQ Agents - Main Entry Point
 * 
 * Multi-agent recovery ecosystem with token economics and blockchain integration
 */

import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
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
import { requireApiKey, requireAdmin } from './middleware/auth.js';
import { requireIdentity } from './middleware/identity.js';
import { strictLimiter, mediumLimiter, looseLimiter } from './middleware/rate-limit.js';
import { validateBody } from './schemas/validate.js';
import { triageSchema } from './schemas/triage.js';
import { consultationSchema } from './schemas/consultation.js';

// Import all specialist agents
import { TriageAgent } from './agents/triage-agent.js';
import { PainWhispererAgent } from './agents/pain-whisperer-agent.js';
import { MovementDetectiveAgent } from './agents/movement-detective-agent.js';
import { StrengthSageAgent } from './agents/strength-sage-agent.js';
import { MindMenderAgent } from './agents/mind-mender-agent.js';
import { ResearchAgent } from './agents/research-agent.js';

// Load environment variables
dotenv.config();

// Fail-fast in production if auth env vars are missing
if (process.env.NODE_ENV === 'production') {
  const required = ['FARCASTER_API_KEY', 'WEB_API_KEY', 'ADMIN_API_KEY', 'CORS_ORIGINS', 'FARCASTER_AUTH_DOMAIN'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`FATAL: missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

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

// API call to flag consultation for MD review (skips when MD_REVIEW_API_URL not configured)
async function flagConsultationForMDReview(consultationId, qualityScore) {
  const baseUrl = process.env.MD_REVIEW_API_URL;
  if (!baseUrl) {
    logger.debug(`MD review skipped for ${consultationId} — MD_REVIEW_API_URL not configured`);
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/api/consultations/${consultationId}/flag-for-review`, {
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
    logger.warn(`MD review service unavailable for ${consultationId}: ${error.message}`);
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
    this.consultationResults = new Map(); // consultationId → { status, result, error, startTime, completedAt }
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
    this.app.use(helmet());

    // Assign a unique request ID used by logging and error responses
    this.app.use((req, res, next) => {
      req.id = crypto.randomUUID();
      res.setHeader('X-Request-Id', req.id);
      next();
    });

    // CORS — production reads CORS_ORIGINS (comma-list); dev auto-allows localhost
    this.app.use((req, res, next) => {
      const origin = req.headers['origin'];
      if (!origin) return next();

      const allowed = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const isDev = process.env.NODE_ENV === 'development';
      const localhostRe = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
      const originAllowed = allowed.includes(origin) || (isDev && localhostRe.test(origin));

      if (!originAllowed) {
        return res.status(403).json({ error: 'cors_origin_not_allowed' });
      }

      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization, X-API-Key, X-User-Id');
      res.header('Access-Control-Allow-Credentials', 'true');

      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Structured request logger — no IP correlation with PHI
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        logger.info({
          event: 'request',
          requestId: req.id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
          keyName: req.auth?.keyName ?? 'none',
        });
      });
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

      // Token ledger tables (Phase 2)
      await sql`CREATE TABLE IF NOT EXISTS agent_wallets (
        agent_id TEXT PRIMARY KEY,
        agent_name TEXT UNIQUE NOT NULL,
        address TEXT NOT NULL,
        network TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS agent_balances (
        agent_id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        wallet_address TEXT,
        token_balance INTEGER NOT NULL DEFAULT 0,
        total_earned INTEGER NOT NULL DEFAULT 0,
        transaction_count INTEGER NOT NULL DEFAULT 0,
        last_updated TIMESTAMP DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS token_transactions (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        outcome JSONB,
        additional_data JSONB,
        track TEXT,
        blockchain_tx TEXT,
        status TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT,
        reason TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_token_tx_agent_id ON token_transactions(agent_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_token_tx_timestamp ON token_transactions(timestamp DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS consultation_feedback (
        id SERIAL PRIMARY KEY,
        consultation_id TEXT NOT NULL,
        feedback_type TEXT NOT NULL CHECK (feedback_type IN ('user_modal', 'md_review', 'follow_up')),
        payload JSONB NOT NULL,
        submitted_by TEXT,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      // Legacy-table backfills: each ADD COLUMN IF NOT EXISTS is a no-op on fresh installs.
      await sql`ALTER TABLE consultation_feedback ADD COLUMN IF NOT EXISTS feedback_type TEXT DEFAULT 'user_modal'`;
      await sql`ALTER TABLE consultation_feedback ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE consultation_feedback ADD COLUMN IF NOT EXISTS submitted_by TEXT`;
      await sql`ALTER TABLE consultation_feedback ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NOW()`;
      await sql`ALTER TABLE consultation_feedback ADD COLUMN IF NOT EXISTS patient_id TEXT`;
      await sql`ALTER TABLE consultation_feedback ALTER COLUMN patient_id DROP NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS idx_feedback_consultation_id ON consultation_feedback(consultation_id, feedback_type)`;

      // Inter-agent divergences are now persisted in the owned equipoise layer (panel_runs +
      // specialist_positions + synthesizer_outputs, run_kind='production'), a strict superset of the
      // retired coordination_divergences table — see runEquipoiseMigrations + agent-coordinator
      // persistEquipoisePanels(). Legacy coordination_divergences rows (if any) remain historical.

      // Equipoise benchmark & proprietary core (Phase 1) — additive, idempotent.
      const { runEquipoiseMigrations } = await import('./utils/equipoise-schema.js');
      await runEquipoiseMigrations(sql);

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
      
      // Replay persisted state from DB (T0-9)
      await this.tokenManager.loadFromDb();

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
    this.app.get('/status', requireApiKey, looseLimiter, async (req, res) => {
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
            version: '2.0.0',
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
                specialization: agent.subspecialty
              }
            ])
          ),
          researchAgent: this.researchAgent ? {
            name: this.researchAgent.name,
            experience: this.researchAgent.experience,
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
    this.app.post('/triage', requireApiKey, strictLimiter, validateBody(triageSchema), async (req, res, next) => {
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
        return next(error);
      }
    });

    // Multi-specialist consultation endpoint with caching and modes
    this.app.post('/consultation', requireApiKey, strictLimiter, validateBody(consultationSchema), async (req, res, next) => {
      try {
        // Scope validation - early return if out of scope
        const scopeCheck = this.validateQueryScope(req, res);
        if (scopeCheck) return;

        const {
          caseData,
          requiredSpecialists,
          mode = 'fast',
          platformContext: topPlatformContext,
          queryType       // optional user override: 'informational' | 'clinical'
        } = req.body;
        // Frontend nests platformContext inside caseData; fall back to that if absent at top level
        const platformContext = topPlatformContext ?? caseData?.platformContext;
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

        // User-supplied query type override takes precedence over classifiers (both fast and normal mode)
        const userOverride = (queryType === 'informational' || queryType === 'clinical') ? queryType : null;
        if (userOverride) logger.info(`Query type override by user: ${userOverride}`);

        // Fast mode: Return immediate triage response, continue full coordination in background
        if (mode === 'fast') {
          logger.info('Fast mode: Returning immediate triage, continuing coordination in background');

          // Get immediate triage-only response
          const triageAgent = this.agents.triage;
          const triageResponse = await triageAgent.triageCase(caseData, {
            mode: 'normal',  // Use Sonnet for complete triage — user-facing primary output
            timeout: 75000,  // Match coordinator normal-mode timeout for Sonnet
            rawQuery,
            enableDualTrack,
            userId,
            isReturningUser,
            platformContext
          });
          triageResponse.triageClassificationConfidence = heuristicClassification.confidence;

          // Check if informational — user override takes precedence; otherwise either classifier
          // saying informational is a confident signal (both default to clinical when uncertain)
          const effectiveQueryType = userOverride
            || ((triageResponse.queryType === 'informational' || heuristicClassification.queryType === 'informational')
              ? 'informational'
              : 'clinical');
          logger.info(`Effective query type: ${effectiveQueryType} ` +
            `(triage: ${triageResponse.queryType}, heuristic: ${heuristicClassification.queryType}${userOverride ? ', user override: ' + userOverride : ''})`);
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

          // Register in consultationResults so status endpoint can serve it
          this.consultationResults.set(consultationId, { status: 'processing', startTime });

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
              // Inject metadata (same fields normal mode adds)
              result.consultationId = consultationId;
              result.dataCompleteness = triageAssessment.completeness;
              result.suggestedFollowUp = triageResponse.followUpQuestions || [];
              result.triageConfidence = triageResponse.confidence;
              result.specialistCoverage = this.agents.triage.getSpecialistCoverage(
                caseData, result.participatingSpecialists
              );

              // Cache for training and future use
              await cacheManager.set(caseData, result);

              // Check if consultation meets quality thresholds for MD review
              const mdReviewCheck = shouldFlagForMDReview(result);
              if (mdReviewCheck.flag) {
                await flagConsultationForMDReview(consultationId, mdReviewCheck.qualityScore);
              }

              // Write to consultationResults for status polling
              this.consultationResults.set(consultationId, {
                status: 'completed', result, startTime, completedAt: Date.now()
              });
              setTimeout(() => this.consultationResults.delete(consultationId), 30 * 60 * 1000);
              logger.info(`Background coordination complete for ${consultationId}, cached and stored`);
            })
            .catch(err => {
              logger.error(`Background coordination failed for ${consultationId}:`, err.message);
              this.consultationResults.set(consultationId, {
                status: 'error', error: err.message, completedAt: Date.now()
              });
              setTimeout(() => this.consultationResults.delete(consultationId), 5 * 60 * 1000);
            });

          // Exit early - response already sent
          return;
        }

        // Normal mode: Run triage for query type classification
        const triageForClassification = await this.agents.triage.triageCase(caseData, {
          mode: 'normal',  // Use Sonnet for complete triage with all 8 sections
          timeout: 75000,  // Match coordinator normal-mode timeout for Sonnet
          rawQuery, enableDualTrack
        });
        triageForClassification.triageClassificationConfidence = heuristicClassification.confidence;

        const effectiveQueryTypeNormal = userOverride
          || ((triageForClassification.queryType === 'informational' || heuristicClassification.queryType === 'informational')
            ? 'informational'
            : 'clinical');
        logger.info(`Effective query type: ${effectiveQueryTypeNormal} ` +
          `(triage: ${triageForClassification.queryType}, heuristic: ${heuristicClassification.queryType}${userOverride ? ', user override: ' + userOverride : ''})`);
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

        // Normal mode: Fire background consultation, return consultationId immediately for polling.
        // This avoids Farcaster WebView's ~90s hard timeout on the frontend→Next.js leg.
        const consultationId = `consultation_${Date.now()}`;
        this.consultationResults.set(consultationId, { status: 'processing', startTime });

        // Fire-and-forget — do NOT await
        this.coordinator.coordinateMultiSpecialistConsultation(
          caseData,
          smartSpecialists,
          {
            mode,
            consultationId,
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
        ).then(async (consultationResult) => {
          // Inject ID and triage metadata
          consultationResult.consultationId = consultationId;
          consultationResult.dataCompleteness = triageAssessment.completeness;
          consultationResult.suggestedFollowUp = triageAssessment.suggestedFollowUp;
          consultationResult.triageConfidence = triageAssessment.confidence;
          consultationResult.specialistCoverage = this.agents.triage.getSpecialistCoverage(
            caseData,
            consultationResult.participatingSpecialists
          );

          // Cache for future requests
          await cacheManager.set(caseData, consultationResult);

          // Check quality thresholds for MD review
          const mdReviewCheck = shouldFlagForMDReview(consultationResult);
          if (mdReviewCheck.flag) {
            await flagConsultationForMDReview(consultationId, mdReviewCheck.qualityScore);
          }

          this.consultationResults.set(consultationId, {
            status: 'completed',
            result: consultationResult,
            startTime,
            completedAt: Date.now()
          });

          // Trigger research asynchronously
          if (requestResearch !== false && this.researchAgent) {
            this.triggerResearchAgent(consultationId, caseData, consultationResult, userTier || 'basic')
              .catch(err => logger.error(`Research background error [${consultationId}]: ${err.message}`));
          }

          // Cleanup after 30 minutes
          setTimeout(() => this.consultationResults.delete(consultationId), 30 * 60 * 1000);
          logger.info(`Background consultation complete for ${consultationId}`);

        }).catch(error => {
          logger.error(`Background consultation error [${consultationId}]: ${error.message}`);
          this.consultationResults.set(consultationId, {
            status: 'error',
            error: error.message,
            completedAt: Date.now()
          });
          // Cleanup after 5 minutes on error
          setTimeout(() => this.consultationResults.delete(consultationId), 5 * 60 * 1000);
        });

        // Return immediately — frontend polls /consultation/:id/status
        return res.json({
          success: true,
          consultationId,
          status: 'processing',
          mode,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Consultation API error: ${error.message}`);
        if (error.message.includes('timeout')) {
          const timeoutErr = new Error('Request exceeded time limit, please try again');
          timeoutErr.status = 504;
          return next(timeoutErr);
        }
        return next(error);
      }
    });

    // Async consultation status endpoint — polls result of normal-mode background consultations
    this.app.get('/consultation/:consultationId/status', requireApiKey, mediumLimiter, async (req, res) => {
      const { consultationId } = req.params;
      const entry = this.consultationResults.get(consultationId);

      if (!entry) {
        return res.status(404).json({ status: 'not_found', consultationId });
      }
      if (entry.status === 'processing') {
        return res.json({ status: 'processing', consultationId });
      }
      if (entry.status === 'error') {
        return res.status(500).json({ status: 'error', error: entry.error, consultationId });
      }

      // Completed — return same response shape as the old synchronous POST
      const consultationResult = entry.result;
      const researchPollEndpoint = this.researchAgent ? `/research/${consultationId}` : null;

      return res.json({
        success: true,
        status: 'completed',
        consultation: consultationResult,
        research: researchPollEndpoint ? {
          status: 'pending',
          estimatedSeconds: agentConfig.research?.timeoutSeconds || 25,
          pollEndpoint: researchPollEndpoint,
        } : undefined,
        fromCache: false,
        mode: consultationResult.mode || 'normal',
        responseTime: entry.completedAt - (entry.startTime || entry.completedAt),
        timestamp: new Date().toISOString()
      });
    });

    // Recovery tracking endpoints
    this.app.post('/recovery/start', requireApiKey, mediumLimiter, requireIdentity, async (req, res, next) => {
      try {
        const patientId = req.user.identity;
        const { initialAssessment } = req.body;
        
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
        return next(error);
      }
    });

    this.app.post('/recovery/update', requireApiKey, mediumLimiter, requireIdentity, async (req, res, next) => {
      try {
        const patientId = req.user.identity;
        const { progressData } = req.body;
        
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
        return next(error);
      }
    });

    this.app.post('/recovery/complete', requireApiKey, mediumLimiter, requireIdentity, async (req, res, next) => {
      try {
        const patientId = req.user.identity;
        const { finalOutcome } = req.body;
        
        const completionResult = await this.recoveryMetrics.completeRecoveryTracking(
          patientId,
          finalOutcome
        );

        // Distribute final rewards
        const outcome = {
          success: completionResult.success,
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
          rewards,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Recovery completion API error: ${error.message}`);
        return next(error);
      }
    });

    // Agent-specific endpoints
    this.app.post('/agents/:agentType/assess', requireApiKey, strictLimiter, async (req, res, next) => {
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
            await this.tokenManager.distributeTokenReward(agent.agentId, assessmentData.outcome);
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
        return next(error);
      }
    });

    // Cache management endpoints
    this.app.post('/cache/clear', requireApiKey, mediumLimiter, requireAdmin, (req, res, next) => {
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
        return next(error);
      }
    });

    this.app.get('/cache/stats', requireApiKey, looseLimiter, (req, res, next) => {
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
        return next(error);
      }
    });

    // Token management endpoints
    this.app.get('/tokens/balance/:agentId', requireApiKey, looseLimiter, (req, res, next) => {
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
        return next(error);
      }
    });

    this.app.get('/tokens/statistics', requireApiKey, looseLimiter, (req, res, next) => {
      try {
        const stats = this.tokenManager.getNetworkStatistics();
        res.json({
          success: true,
          statistics: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Token statistics API error: ${error.message}`);
        return next(error);
      }
    });

    // Feedback ingest endpoints — persist for V2 prediction market substrate
    // URLs kept stable so frontend / admin dashboard / Farcaster integrations continue working.
    this.app.post('/predictions/resolve/md-review', requireApiKey, mediumLimiter, requireAdmin, async (req, res, next) => {
      try {
        const { consultationId, mdReviewData } = req.body;
        if (!consultationId || !mdReviewData) {
          return res.status(400).json({ error: 'consultationId and mdReviewData are required' });
        }
        const sql = (await import('./utils/db.js')).default;
        if (sql) {
          await sql`INSERT INTO consultation_feedback (consultation_id, feedback_type, payload, submitted_by) VALUES (${consultationId}, 'md_review', ${JSON.stringify(mdReviewData)}, ${req.user?.identity || null})`;
          logger.info(`Feedback recorded: md_review for consultation ${consultationId}`);
        }
        res.json({ success: true, consultationId, recorded: true, timestamp: new Date().toISOString() });
      } catch (error) {
        logger.error(`MD review feedback API error: ${error.message}`);
        return next(error);
      }
    });

    this.app.post('/predictions/resolve/user-modal', requireApiKey, mediumLimiter, async (req, res, next) => {
      try {
        const { consultationId, userFeedback } = req.body;
        if (!consultationId || !userFeedback) {
          return res.status(400).json({ error: 'consultationId and userFeedback are required' });
        }
        const sql = (await import('./utils/db.js')).default;
        if (sql) {
          await sql`INSERT INTO consultation_feedback (consultation_id, feedback_type, payload, submitted_by) VALUES (${consultationId}, 'user_modal', ${JSON.stringify(userFeedback)}, ${req.user?.identity || null})`;
          logger.info(`Feedback recorded: user_modal for consultation ${consultationId}`);
        }
        res.json({
          success: true,
          consultationId,
          recorded: true,
          cascadingResolution: null,
          recommendMDReview: false,
          totalAgentsResolved: 0,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`User modal feedback API error: ${error.message}`);
        return next(error);
      }
    });

    this.app.post('/predictions/resolve/follow-up', requireApiKey, mediumLimiter, async (req, res, next) => {
      try {
        const { consultationId, followUpData } = req.body;
        if (!consultationId || !followUpData) {
          return res.status(400).json({ error: 'consultationId and followUpData are required' });
        }
        const sql = (await import('./utils/db.js')).default;
        if (sql) {
          await sql`INSERT INTO consultation_feedback (consultation_id, feedback_type, payload, submitted_by) VALUES (${consultationId}, 'follow_up', ${JSON.stringify(followUpData)}, ${req.user?.identity || null})`;
          logger.info(`Feedback recorded: follow_up for consultation ${consultationId}`);
        }
        res.json({ success: true, consultationId, recorded: true, timestamp: new Date().toISOString() });
      } catch (error) {
        logger.error(`Follow-up feedback API error: ${error.message}`);
        return next(error);
      }
    });

    // Research endpoints
    this.app.post('/research/trigger', requireApiKey, strictLimiter, async (req, res, next) => {
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
              return res.json({ success: true, consultationId, status: 'pending', estimatedSeconds: agentConfig.research?.timeoutSeconds || 25 });
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
          return res.json({ success: true, consultationId, status: 'pending', estimatedSeconds: agentConfig.research?.timeoutSeconds || 25 });
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

        // Fire-and-forget: curate studies in background. Timeout is config-driven
        // (default 25s; bumped from 15s to accommodate optional LLM query generation).
        const RESEARCH_TIMEOUT_MS = (agentConfig.research?.timeoutSeconds || 25) * 1000;
        Promise.race([
          this.researchAgent.curateRelevantStudies(enrichedQuery, userTier),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Research timed out after ${RESEARCH_TIMEOUT_MS / 1000} seconds`)), RESEARCH_TIMEOUT_MS)
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
        return next(error);
      }
    });

    this.app.get('/research/:consultationId', requireApiKey, mediumLimiter, async (req, res, next) => {
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
          const totalBudget = agentConfig.research?.timeoutSeconds || 25;
          const elapsedSeconds = (Date.now() - new Date(row.created_at).getTime()) / 1000;
          const estimatedSeconds = Math.max(0, totalBudget - Math.round(elapsedSeconds));
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
        return next(error);
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
          feedback: {
            mdReview: 'POST /predictions/resolve/md-review - Persist MD review feedback (V2 substrate)',
            userModal: 'POST /predictions/resolve/user-modal - Persist user feedback modal (V2 substrate)',
            followUp: 'POST /predictions/resolve/follow-up - Persist PROMIS follow-up data (V2 substrate)'
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
    this.app.use((err, req, res, next) => {
      const status = err.status || 500;
      logger.error({
        event: 'unhandled_error',
        requestId: req.id,
        status,
        message: err.message,
        stack: err.stack,
      });

      if (err.code === 'validation_error') {
        return res.status(400).json({
          error: 'validation_error',
          requestId: req.id,
          ...(process.env.NODE_ENV !== 'production' && { issues: err.issues }),
        });
      }

      if (process.env.NODE_ENV === 'production') {
        return res.status(status).json({ error: 'internal_error', requestId: req.id });
      }

      res.status(status).json({
        error: 'internal_error',
        requestId: req.id,
        message: err.message,
        ...(err.stack && { stack: err.stack }),
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
      hasQuery: !!query,
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
      const RESEARCH_TIMEOUT_MS = (agentConfig.research?.timeoutSeconds || 25) * 1000;
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
          setTimeout(() => reject(new Error(`Research timed out after ${RESEARCH_TIMEOUT_MS / 1000} seconds`)), RESEARCH_TIMEOUT_MS)
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