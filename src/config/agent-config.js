import dotenv from 'dotenv';

dotenv.config();

export const agentConfig = {
  // Base Agent Configuration
  cdp: {
    // Support both AgentKit and SDK variable names for compatibility
    apiKeyName: process.env.CDP_API_KEY_NAME,
    apiKeyId: process.env.CDP_API_KEY_ID,
    privateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  },
  
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxTokens: parseInt(process.env.MAX_TOKENS) || 2500,
    fastMaxTokens: parseInt(process.env.FAST_MAX_TOKENS) || 1000,
  },
  
  network: {
    id: process.env.NETWORK_ID || 'base-sepolia',
  },
  
  // Agent Behavior Configuration
  agent: {
    experienceMultiplier: parseFloat(process.env.AGENT_EXPERIENCE_MULTIPLIER) || 1.0,
    minConfidenceThreshold: parseFloat(process.env.MIN_CONFIDENCE_THRESHOLD) || 0.7,
    maxSpecialistsPerCase: parseInt(process.env.MAX_SPECIALISTS_PER_CASE) || 5,
  },
  
  // Token Economics Configuration
  tokenEconomics: {
    contractAddress: process.env.TOKEN_CONTRACT_ADDRESS,
    baseRewardAmount: parseInt(process.env.BASE_REWARD_AMOUNT) || 1,
    maxRewardMultiplier: parseInt(process.env.MAX_REWARD_MULTIPLIER) || 50,
  },
  
  // Blockchain Configuration
  blockchain: {
    baseRpcUrl: process.env.BASE_RPC_URL || 'https://sepolia.base.org',
    baseMainnetRpcUrl: process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org',
    gasLimit: parseInt(process.env.GAS_LIMIT) || 200000,
    gasPriceGwei: parseInt(process.env.GAS_PRICE_GWEI) || 20,
    enabled: process.env.ENABLE_BLOCKCHAIN === 'true',
    mockResponses: process.env.MOCK_BLOCKCHAIN_RESPONSES === 'true',
  },
  
  // API Configuration
  api: {
    port: parseInt(process.env.PORT) || 3000,
    rateLimit: parseInt(process.env.API_RATE_LIMIT) || 100,
    corsOrigin: process.env.CORS_ORIGIN || '*',
  },
  
  // Recovery Metrics Configuration
  recovery: {
    defaultWeeks: parseInt(process.env.DEFAULT_RECOVERY_WEEKS) || 16,
    painReductionTarget: parseInt(process.env.PAIN_REDUCTION_TARGET) || 70,
    functionalImprovementTarget: parseInt(process.env.FUNCTIONAL_IMPROVEMENT_TARGET) || 80,
    patientSatisfactionTarget: parseInt(process.env.PATIENT_SATISFACTION_TARGET) || 8,
  },
  
  // Security Configuration
  security: {
    jwtSecret: process.env.JWT_SECRET,
    apiKey: process.env.API_KEY,
    encryptionKey: process.env.ENCRYPTION_KEY,
  },
  
  // Research Agent Configuration
  research: {
    enabled: process.env.ENABLE_RESEARCH_AGENT !== 'false', // default: enabled
    // Total wall-clock budget for the async research job (PubMed + LLM query gen + intro).
    // Bumped from 15 → 25 to accommodate optional Haiku query generation (~1–2s overhead).
    timeoutSeconds: parseInt(process.env.RESEARCH_TIMEOUT_SECONDS) || 25,
    // Feature flag for LLM-based PubMed query construction. Default ON (2026-06-28): the heuristic
    // keyword map drops conditions outside its hardcoded vocabulary (e.g. "septic arthritis" →
    // "knee AND surgery"), which the Phase 2.5 evidence validation showed wrecks decision-level
    // retrieval. Haiku translates the case into a MeSH/field-tagged query, falling back to the
    // deterministic keyword pipeline on timeout/invalid output. Set RESEARCH_LLM_QUERY_ENABLED=false
    // to opt out.
    llmQueryEnabled: process.env.RESEARCH_LLM_QUERY_ENABLED !== 'false',
    // Per-attempt budget for the Haiku query-generation call. Falls back to heuristic on exceed.
    llmQueryTimeoutMs: parseInt(process.env.RESEARCH_LLM_QUERY_TIMEOUT_MS) || 3000,
    // Per-attempt budget for the Haiku intro-generation call. On exceed, falls back to a
    // plain-text summary WITHOUT discarding the already-retrieved citations (F4). Kept well
    // under timeoutSeconds so a slow intro can't consume the whole job budget.
    introTimeoutMs: parseInt(process.env.RESEARCH_INTRO_TIMEOUT_MS) || 8000,
  },

  // PubMed Research Configuration
  pubmed: {
    apiKey: process.env.PUBMED_API_KEY,
    requestTimeout: parseInt(process.env.PUBMED_REQUEST_TIMEOUT) || 15000,
    maxResults: parseInt(process.env.PUBMED_MAX_RESULTS) || 20,
  },

  // Development/Testing
  environment: {
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};

export default agentConfig;