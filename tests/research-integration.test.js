import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ── In-memory database mock ─────────────────────────────────────────────────
// Simulates Neon's sql tagged template against a Map<consultationId, record>.

const store = new Map();
let nextId = 1;

async function mockSql(strings, ...values) {
  const query = strings.join('$').toLowerCase();

  // INSERT INTO research_results
  if (query.includes('insert into research_results')) {
    const consultationId = values[0];
    const id = nextId++;
    store.set(consultationId, {
      id,
      consultation_id: consultationId,
      status: 'pending',
      intro: null,
      citations: null,
      search_query: null,
      studies_reviewed: null,
      tier: null,
      error: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    });
    return [{ id }];
  }

  // UPDATE → complete
  if (query.includes('update research_results') && query.includes("status = 'complete'")) {
    const consultationId = values[values.length - 1];
    const record = store.get(consultationId);
    if (record && record.status === 'pending') {
      record.status = 'complete';
      record.intro = values[0];
      record.citations = values[1];
      record.search_query = values[2];
      record.studies_reviewed = values[3];
      record.tier = values[4];
      record.completed_at = new Date().toISOString();
      return [record];
    }
    return [];
  }

  // UPDATE → failed
  if (query.includes('update research_results') && query.includes("status = 'failed'")) {
    const consultationId = values[values.length - 1];
    const record = store.get(consultationId);
    if (record && record.status === 'pending') {
      record.status = 'failed';
      record.error = values[0];
      record.completed_at = new Date().toISOString();
      return [record];
    }
    return [];
  }

  // SELECT
  if (query.includes('select') && query.includes('research_results')) {
    const consultationId = values[0];
    const record = store.get(consultationId);
    return record ? [record] : [];
  }

  return [];
}

mockSql._store = store;
mockSql._reset = () => {
  store.clear();
  nextId = 1;
};

// ── Module mocks (before dynamic imports) ───────────────────────────────────

jest.unstable_mockModule('../src/utils/db.js', () => ({
  default: mockSql,
}));

jest.unstable_mockModule('../src/config/agent-config.js', () => ({
  agentConfig: {
    cdp: { apiKeyName: 'test_key', privateKey: 'test_private_key' },
    claude: { apiKey: 'test_claude_key' },
    network: { id: 'base-sepolia' },
    agent: { minConfidenceThreshold: 0.7, experienceMultiplier: 1.0 },
    pubmed: { apiKey: null, requestTimeout: 15000, maxResults: 20 },
    blockchain: { enabled: false, mockResponses: true },
    environment: { nodeEnv: 'test', logLevel: 'error' },
  },
}));

jest.unstable_mockModule('@langchain/anthropic', () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({
      content: 'Research shows promising outcomes for this condition. Multiple studies support evidence-based approaches to recovery.',
    }),
  })),
}));

jest.unstable_mockModule('@coinbase/cdp-agentkit-core', () => ({
  default: {},
  CdpAgentkit: jest.fn(),
}));

// ── Dynamic imports (after mocks) ──────────────────────────────────────────

const { storeResearchPending, storeResearchResult, storeResearchError, getResearchResult } =
  await import('../src/utils/research-storage.js');
const { ResearchAgent } = await import('../src/agents/research-agent.js');
const { TokenManager, RESEARCH_TOKEN_EVENTS } = await import('../src/utils/token-manager.js');
const { distributeResearchTokens } = await import('../src/utils/research-tokens.js');

// ── Clinical test data ─────────────────────────────────────────────────────

const CASES = {
  knee: { primaryComplaint: 'knee instability after soccer injury', symptoms: 'giving way, swelling', duration: '2 weeks' },
  shoulder: { primaryComplaint: 'shoulder pain with overhead activities', symptoms: 'impingement, weakness', duration: '3 months' },
  back: { primaryComplaint: 'chronic lower back pain', symptoms: 'radiating pain, stiffness', duration: '6 months' },
  ankle: { primaryComplaint: 'ankle sprain recovery', symptoms: 'lateral ankle pain, instability', duration: '4 weeks' },
};

// ── Mock article factory ───────────────────────────────────────────────────

let articleCounter = 10000000;

function createMockArticle(overrides = {}) {
  articleCounter += 1;
  return {
    pmid: String(articleCounter),
    title: 'Mock Article Title',
    authors: 'Smith J, Doe A',
    rawAuthors: ['Smith J', 'Doe A'],
    journal: 'Journal of Bone and Joint Surgery',
    year: '2024',
    volume: '106',
    issue: '3',
    pages: '123-130',
    doi: `10.2106/JBJS.24.${String(articleCounter).slice(-5)}`,
    pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${articleCounter}/`,
    abstract: 'Mock abstract for testing.',
    studyType: 'Randomized Controlled Trial',
    qualityScore: 0,
    relevanceScore: 0,
    ...overrides,
  };
}

const MOCK_ARTICLES = {
  knee: [
    createMockArticle({ title: 'ACL Reconstruction Outcomes in Athletes: A Randomized Trial', journal: 'Journal of Bone and Joint Surgery', studyType: 'Randomized Controlled Trial' }),
    createMockArticle({ title: 'Knee Instability Management: A Comprehensive Meta-Analysis', journal: 'American Journal of Sports Medicine', studyType: 'Meta-Analysis' }),
    createMockArticle({ title: 'Return to Sport After ACL Injury and Reconstruction', journal: 'Arthroscopy', studyType: 'Randomized Controlled Trial' }),
    createMockArticle({ title: 'Conservative vs Surgical Management of Knee Instability', journal: 'Journal of Bone and Joint Surgery', studyType: 'Systematic Review', year: '2023' }),
    createMockArticle({ title: 'Soccer-Related Knee Injuries and Recovery Protocols', journal: 'Knee Surgery Sports Traumatology Arthroscopy', studyType: 'Randomized Controlled Trial' }),
  ],
  shoulder: [
    createMockArticle({ title: 'Shoulder Impingement Syndrome Treatment Outcomes', journal: 'Journal of Bone and Joint Surgery', studyType: 'Randomized Controlled Trial' }),
    createMockArticle({ title: 'Overhead Athlete Shoulder Pain: Meta-Analysis of Interventions', journal: 'American Journal of Sports Medicine', studyType: 'Meta-Analysis' }),
    createMockArticle({ title: 'Physical Therapy for Subacromial Impingement Syndrome', journal: 'Journal of Orthopaedic and Sports Physical Therapy', studyType: 'Randomized Controlled Trial' }),
    createMockArticle({ title: 'Rotator Cuff Weakness Management Strategies in Athletes', journal: 'Journal of Shoulder and Elbow Surgery', studyType: 'Randomized Controlled Trial', year: '2023' }),
  ],
  back: [
    createMockArticle({ title: 'Chronic Low Back Pain: Exercise vs Surgery Outcomes', journal: 'New England Journal of Medicine', studyType: 'Randomized Controlled Trial' }),
    createMockArticle({ title: 'Radiating Pain Management in Chronic LBP: A Meta-Analysis', journal: 'Lancet', studyType: 'Meta-Analysis' }),
    createMockArticle({ title: 'Lumbar Spine Rehabilitation Protocols: A Clinical Trial', journal: 'Spine', studyType: 'Randomized Controlled Trial' }),
    createMockArticle({ title: 'Chronic Pain and Stiffness: Multi-modal Treatment Approaches', journal: 'BMJ', studyType: 'Randomized Controlled Trial' }),
    createMockArticle({ title: 'Core Strengthening Programs for Low Back Pain Recovery', journal: 'Journal of Orthopaedic and Sports Physical Therapy', studyType: 'Systematic Review', year: '2023' }),
    createMockArticle({ title: 'Epidural Injections for Radicular Low Back Pain', journal: 'Spine', studyType: 'Randomized Controlled Trial', year: '2023' }),
  ],
  ankle: [
    createMockArticle({ title: 'Lateral Ankle Sprain Rehabilitation: Evidence-Based Protocols', journal: 'American Journal of Sports Medicine', studyType: 'Randomized Controlled Trial' }),
    createMockArticle({ title: 'Ankle Instability Prevention Programs: A Meta-Analysis', journal: 'Journal of Bone and Joint Surgery', studyType: 'Meta-Analysis' }),
    createMockArticle({ title: 'Functional Recovery After Ankle Sprain in Athletes', journal: 'Journal of Orthopaedic and Sports Physical Therapy', studyType: 'Randomized Controlled Trial' }),
  ],
};

// ── Helper: mock PubMed spies for a given case ─────────────────────────────

function mockPubMedForCase(agentInstance, caseKey, pmidCount) {
  const pmids = Array.from({ length: pmidCount || MOCK_ARTICLES[caseKey].length }, (_, i) => String(30000 + i));
  jest.spyOn(agentInstance, 'searchPubMed').mockResolvedValue(pmids);
  jest.spyOn(agentInstance, 'fetchArticleDetails').mockResolvedValue(MOCK_ARTICLES[caseKey]);
  return pmids;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Research Integration Tests', () => {
  let agent;
  let tokenManager;

  beforeEach(async () => {
    mockSql._reset();
    agent = new ResearchAgent();
    tokenManager = new TokenManager();
    await tokenManager.initializeAgentWallet(agent);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────
  // 1. Complete Research Flow
  // ────────────────────────────────────────────────────────────────────────

  describe('Complete Research Flow', () => {
    test('should complete full trigger → store → curate → persist → token cycle', async () => {
      const consultationId = 'flow-knee-001';

      // 1. Store pending
      const id = await storeResearchPending(consultationId);
      expect(typeof id).toBe('number');

      // 2. Mock PubMed and run research
      mockPubMedForCase(agent, 'knee');
      const result = await agent.curateRelevantStudies(CASES.knee);
      expect(result.success).toBe(true);
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.intro).toBeTruthy();
      expect(result.tier).toBe('basic');

      // 3. Persist result
      const rowsAffected = await storeResearchResult(consultationId, result);
      expect(rowsAffected).toBe(1);

      // 4. Verify DB record transitioned pending → complete
      const dbRecord = await getResearchResult(consultationId);
      expect(dbRecord.status).toBe('complete');
      expect(dbRecord.intro).toBeTruthy();
      expect(dbRecord.tier).toBe('basic');

      // 5. Distribute tokens
      const tokenResult = await distributeResearchTokens(consultationId, result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.tokens).toBeGreaterThan(0);
    });

    test('should store research result with correct fields', async () => {
      const consultationId = 'fields-test-001';
      await storeResearchPending(consultationId);

      mockPubMedForCase(agent, 'shoulder');
      const result = await agent.curateRelevantStudies(CASES.shoulder);
      await storeResearchResult(consultationId, result);

      const dbRecord = await getResearchResult(consultationId);
      expect(dbRecord.status).toBe('complete');
      expect(dbRecord.intro).not.toBeNull();
      expect(dbRecord.search_query).toBeTruthy();
      expect(dbRecord.tier).toBe('basic');

      // Citations stored as JSON string
      const citations = JSON.parse(dbRecord.citations);
      expect(Array.isArray(citations)).toBe(true);
      expect(citations.length).toBeGreaterThan(0);
    });

    test('should track research in agent researchHistory', async () => {
      agent.researchHistory = [];

      mockPubMedForCase(agent, 'knee');
      await agent.curateRelevantStudies(CASES.knee);

      expect(agent.researchHistory.length).toBe(1);
      const record = agent.researchHistory[0];
      expect(record.query).toEqual(CASES.knee);
      expect(record.searchQuery).toBeTruthy();
      expect(typeof record.totalFound).toBe('number');
      expect(typeof record.citationsReturned).toBe('number');
      expect(record.tier).toBe('basic');
      expect(typeof record.responseTime).toBe('number');
      expect(record.timestamp).toBeTruthy();
    });

    test('should work with all 4 clinical cases', async () => {
      for (const [caseKey, clinicalQuery] of Object.entries(CASES)) {
        const consultationId = `all-cases-${caseKey}`;
        await storeResearchPending(consultationId);

        mockPubMedForCase(agent, caseKey);
        const result = await agent.curateRelevantStudies(clinicalQuery);
        expect(result.success).toBe(true);
        expect(result.citations.length).toBeGreaterThan(0);

        await storeResearchResult(consultationId, result);
        const dbRecord = await getResearchResult(consultationId);
        expect(dbRecord.status).toBe('complete');

        jest.restoreAllMocks();
      }
    });

    test('should handle sequential consultations with distinct IDs', async () => {
      const id1 = 'seq-001';
      const id2 = 'seq-002';

      await storeResearchPending(id1);
      await storeResearchPending(id2);

      // First consultation
      mockPubMedForCase(agent, 'knee');
      const result1 = await agent.curateRelevantStudies(CASES.knee);
      await storeResearchResult(id1, result1);
      jest.restoreAllMocks();

      // Second consultation
      mockPubMedForCase(agent, 'ankle');
      const result2 = await agent.curateRelevantStudies(CASES.ankle);
      await storeResearchResult(id2, result2);

      const db1 = await getResearchResult(id1);
      const db2 = await getResearchResult(id2);
      expect(db1.status).toBe('complete');
      expect(db2.status).toBe('complete');
      expect(db1.consultation_id).not.toBe(db2.consultation_id);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Asynchronous Delivery Timing
  // ────────────────────────────────────────────────────────────────────────

  describe('Asynchronous Delivery Timing', () => {
    test('should store pending status before research begins', async () => {
      const consultationId = 'timing-pending-001';
      await storeResearchPending(consultationId);

      // Verify DB has pending before research runs
      const dbBefore = await getResearchResult(consultationId);
      expect(dbBefore.status).toBe('pending');

      // Now run research and complete
      mockPubMedForCase(agent, 'knee');
      const result = await agent.curateRelevantStudies(CASES.knee);
      await storeResearchResult(consultationId, result);

      const dbAfter = await getResearchResult(consultationId);
      expect(dbAfter.status).toBe('complete');
    });

    test('should complete research within 15s timeout budget', async () => {
      mockPubMedForCase(agent, 'knee');

      const start = Date.now();
      const result = await agent.curateRelevantStudies(CASES.knee);
      const elapsed = Date.now() - start;

      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(1000); // Mocked PubMed = near-instant
    });

    test('should enforce 15s timeout for slow research', async () => {
      const consultationId = 'timeout-test-001';
      await storeResearchPending(consultationId);

      // Mock searchPubMed to simulate a timeout error
      jest.spyOn(agent, 'searchPubMed').mockRejectedValue(
        new Error('PubMed search timed out')
      );

      const result = await agent.curateRelevantStudies(CASES.knee);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');

      // Store the error in DB
      await storeResearchError(consultationId, result.error);

      const dbRecord = await getResearchResult(consultationId);
      expect(dbRecord.status).toBe('failed');
      expect(dbRecord.error).toContain('timed out');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Tier-Based Access
  // ────────────────────────────────────────────────────────────────────────

  describe('Tier-Based Access', () => {
    test('basic tier returns max 3 citations', async () => {
      // Provide 6 articles — basic tier should cap at 3
      jest.spyOn(agent, 'searchPubMed').mockResolvedValue(
        Array.from({ length: 6 }, (_, i) => String(40000 + i))
      );
      jest.spyOn(agent, 'fetchArticleDetails').mockResolvedValue(MOCK_ARTICLES.back);

      const result = await agent.curateRelevantStudies(CASES.back, 'basic');
      expect(result.citations.length).toBeLessThanOrEqual(3);
    });

    test('premium tier returns max 5 citations', async () => {
      // Create 8 high-quality articles to ensure enough pass the quality filter
      const eightArticles = [
        ...MOCK_ARTICLES.back,
        createMockArticle({ title: 'Advanced Lumbar Stabilization Techniques', journal: 'New England Journal of Medicine', studyType: 'Randomized Controlled Trial' }),
        createMockArticle({ title: 'Multimodal Pain Management for Chronic Back Pain', journal: 'Lancet', studyType: 'Meta-Analysis' }),
      ];

      jest.spyOn(agent, 'searchPubMed').mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => String(50000 + i))
      );
      jest.spyOn(agent, 'fetchArticleDetails').mockResolvedValue(eightArticles);

      const result = await agent.curateRelevantStudies(CASES.back, 'premium');
      expect(result.citations.length).toBeLessThanOrEqual(5);
    });

    test('tier is stored correctly in DB result', async () => {
      const consultationId = 'tier-store-001';
      await storeResearchPending(consultationId);

      mockPubMedForCase(agent, 'shoulder');
      const result = await agent.curateRelevantStudies(CASES.shoulder, 'premium');
      await storeResearchResult(consultationId, result);

      const dbRecord = await getResearchResult(consultationId);
      expect(dbRecord.tier).toBe('premium');
    });

    test('premium tier adds PREMIUM_ACCESS token bonus', async () => {
      mockPubMedForCase(agent, 'knee');
      const result = await agent.curateRelevantStudies(CASES.knee, 'premium');
      expect(result.citations.length).toBeGreaterThan(0);

      const tokenResult = await distributeResearchTokens('premium-tier-001', result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.breakdown.premiumAccess).toBe(RESEARCH_TOKEN_EVENTS.PREMIUM_ACCESS);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. Error Scenarios
  // ────────────────────────────────────────────────────────────────────────

  describe('Error Scenarios', () => {
    test('should handle PubMed API error gracefully', async () => {
      jest.spyOn(agent, 'searchPubMed').mockRejectedValue(
        new Error('PubMed API unavailable')
      );

      const result = await agent.curateRelevantStudies(CASES.knee);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('should store failed status in DB on error', async () => {
      const consultationId = 'error-store-001';
      await storeResearchPending(consultationId);

      jest.spyOn(agent, 'searchPubMed').mockRejectedValue(
        new Error('Network failure')
      );

      const result = await agent.curateRelevantStudies(CASES.knee);
      await storeResearchError(consultationId, result.error);

      const dbRecord = await getResearchResult(consultationId);
      expect(dbRecord.status).toBe('failed');
      expect(dbRecord.error).not.toBeNull();
    });

    test('should handle no studies found', async () => {
      jest.spyOn(agent, 'searchPubMed').mockResolvedValue([]);

      const result = await agent.curateRelevantStudies(CASES.knee);
      expect(result.success).toBe(true);
      expect(result.citations).toEqual([]);
      expect(result.totalFound).toBe(0);
    });

    test('should return graceful fallback intro on error', async () => {
      jest.spyOn(agent, 'searchPubMed').mockRejectedValue(
        new Error('Service unavailable')
      );

      const result = await agent.curateRelevantStudies(CASES.knee);
      expect(result.intro).toContain('Unable to retrieve');
    });

    test('should return zero tokens for failed research', async () => {
      const result = {
        success: false,
        citations: [],
        intro: 'Unable to retrieve research literature.',
        searchQuery: '',
        totalFound: 0,
        tier: 'basic',
        error: 'Service unavailable',
      };

      const tokenResult = await distributeResearchTokens('failed-001', result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.tokens).toBe(0);
      expect(tokenResult.distributed).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Database Operations
  // ────────────────────────────────────────────────────────────────────────

  describe('Database Operations', () => {
    test('storeResearchPending creates pending record', async () => {
      const consultationId = 'db-pending-001';
      const id = await storeResearchPending(consultationId);
      expect(typeof id).toBe('number');

      const dbRecord = await getResearchResult(consultationId);
      expect(dbRecord.status).toBe('pending');
    });

    test('storeResearchResult transitions pending → complete', async () => {
      const consultationId = 'db-complete-001';
      await storeResearchPending(consultationId);

      const result = {
        intro: 'Test research intro text',
        citations: [{ title: 'Test Study', journal: 'JBJS' }],
        searchQuery: 'knee instability',
        studiesReviewed: 5,
        tier: 'basic',
      };

      const rowsAffected = await storeResearchResult(consultationId, result);
      expect(rowsAffected).toBe(1);

      const dbRecord = await getResearchResult(consultationId);
      expect(dbRecord.status).toBe('complete');
      expect(dbRecord.intro).toBe('Test research intro text');
      expect(dbRecord.search_query).toBe('knee instability');
      expect(dbRecord.tier).toBe('basic');
    });

    test('storeResearchError transitions pending → failed', async () => {
      const consultationId = 'db-failed-001';
      await storeResearchPending(consultationId);

      const rowsAffected = await storeResearchError(consultationId, 'PubMed API timeout');
      expect(rowsAffected).toBe(1);

      const dbRecord = await getResearchResult(consultationId);
      expect(dbRecord.status).toBe('failed');
      expect(dbRecord.error).toBe('PubMed API timeout');
    });

    test('storeResearchResult on non-pending returns 0', async () => {
      const consultationId = 'db-nonpending-001';
      await storeResearchPending(consultationId);

      // Transition to failed first
      await storeResearchError(consultationId, 'First error');

      // Attempt to complete a failed record — should be rejected
      const result = {
        intro: 'Late result',
        citations: [],
        searchQuery: 'test',
        studiesReviewed: 0,
        tier: 'basic',
      };
      const rowsAffected = await storeResearchResult(consultationId, result);
      expect(rowsAffected).toBe(0);
    });

    test('getResearchResult returns null for unknown ID', async () => {
      const result = await getResearchResult('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 6. Token Distribution
  // ────────────────────────────────────────────────────────────────────────

  describe('Token Distribution', () => {
    test('should award base token (1) for any completed search', async () => {
      const result = {
        success: true,
        citations: [createMockArticle({ qualityScore: 7, year: '2024' })],
        tier: 'basic',
        searchQuery: 'test',
      };

      const tokenResult = await distributeResearchTokens('token-base-001', result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.breakdown.base).toBe(RESEARCH_TOKEN_EVENTS.LITERATURE_SEARCH_COMPLETED);
    });

    test('should add RELEVANT_STUDIES_FOUND (3) when 3+ citations', async () => {
      const result = {
        success: true,
        citations: [
          createMockArticle({ qualityScore: 7, year: '2024' }),
          createMockArticle({ qualityScore: 8, year: '2024' }),
          createMockArticle({ qualityScore: 7, year: '2023' }),
        ],
        tier: 'basic',
        searchQuery: 'test',
      };

      const tokenResult = await distributeResearchTokens('token-relevant-001', result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.breakdown.relevantStudies).toBe(RESEARCH_TOKEN_EVENTS.RELEVANT_STUDIES_FOUND);
    });

    test('should add HIGH_IMPACT_JOURNAL (5 each) for qualityScore >= 9', async () => {
      const result = {
        success: true,
        citations: [
          createMockArticle({ qualityScore: 10, year: '2024' }),
          createMockArticle({ qualityScore: 10, year: '2024' }),
        ],
        tier: 'basic',
        searchQuery: 'test',
      };

      const tokenResult = await distributeResearchTokens('token-impact-001', result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.breakdown.highImpactJournals).toBe(10);
    });

    test('should add RECENT_EVIDENCE (2) when 2+ citations from year >= 2023', async () => {
      const result = {
        success: true,
        citations: [
          createMockArticle({ qualityScore: 7, year: '2024' }),
          createMockArticle({ qualityScore: 7, year: '2024' }),
        ],
        tier: 'basic',
        searchQuery: 'test',
      };

      const tokenResult = await distributeResearchTokens('token-recent-001', result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.breakdown.recentEvidence).toBe(RESEARCH_TOKEN_EVENTS.RECENT_EVIDENCE);
    });

    test('should apply LOW_RELEVANCE penalty (-2) when avg quality < 6', async () => {
      const result = {
        success: true,
        citations: [
          createMockArticle({ qualityScore: 5, year: '2024' }),
          createMockArticle({ qualityScore: 5, year: '2024' }),
        ],
        tier: 'basic',
        searchQuery: 'test',
      };

      const tokenResult = await distributeResearchTokens('token-penalty-001', result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.breakdown.lowRelevancePenalty).toBe(RESEARCH_TOKEN_EVENTS.LOW_RELEVANCE);
    });

    test('should return zero tokens for empty citations', async () => {
      const result = {
        success: true,
        citations: [],
        tier: 'basic',
        searchQuery: 'test',
      };

      const tokenResult = await distributeResearchTokens('token-empty-001', result, {
        tokenManager,
        researchAgent: agent,
      });
      expect(tokenResult.tokens).toBe(0);
      expect(tokenResult.distributed).toBeNull();
      expect(tokenResult.breakdown.base).toBe(0);
      expect(tokenResult.breakdown.relevantStudies).toBe(0);
      expect(tokenResult.breakdown.highImpactJournals).toBe(0);
      expect(tokenResult.breakdown.recentEvidence).toBe(0);
      expect(tokenResult.breakdown.lowRelevancePenalty).toBe(0);
    });
  });
});
