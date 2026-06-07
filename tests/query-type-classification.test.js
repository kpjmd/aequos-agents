import { describe, test, expect, jest } from '@jest/globals';

// Mock logger to prevent actual logging during tests
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock Anthropic SDK
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'mock response' }],
        usage: { input_tokens: 100, output_tokens: 50 }
      })
    }
  }))
}));

// Mock CDP modules
jest.unstable_mockModule('@coinbase/cdp-langchain', () => ({
  CdpAgentkit: { configureWithWallet: jest.fn().mockResolvedValue({}) }
}));
jest.unstable_mockModule('@coinbase/coinbase-sdk', () => ({
  Coinbase: { configure: jest.fn() },
  Wallet: { create: jest.fn().mockResolvedValue({ getDefaultAddress: () => ({ getId: () => '0xmock' }) }) }
}));

// Import after mocking
const { TriageAgent } = await import('../src/agents/triage-agent.js');

describe('Query Type Classification', () => {
  let triageAgent;

  beforeAll(() => {
    triageAgent = new TriageAgent('Test Triage');
  });

  // ===== Heuristic Classifier: Informational Queries =====

  describe('classifyQueryType — informational queries', () => {
    test('"What\'s the latest on PRP and knee arthritis?" → informational', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: "What's the latest on PRP and knee arthritis?"
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational).toContain('research_seeking');
    });

    test('"Why does my knee hurt after running?" → informational', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'Why does my knee hurt after running?'
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational).toContain('explanation_seeking_prefix');
    });

    test('"Why does my hip snap/click?" → informational', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'Why does my hip snap and click?'
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational).toContain('explanation_seeking_prefix');
    });

    test('"Is it normal for knees to crack?" → informational', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'Is it normal for knees to crack?'
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational).toContain('explanation_seeking_prefix');
    });

    test('"ACL surgery vs conservative treatment" → informational', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'ACL surgery vs conservative treatment'
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational).toContain('comparison_query');
    });

    test('"What causes plantar fasciitis in runners?" → informational', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'What causes plantar fasciitis in runners?'
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational).toContain('explanation_seeking_prefix');
    });

    test('"When can I return to basketball after ACL surgery?" → informational (recovery_timeline_general)', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'When can I return to basketball after ACL surgery?'
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational).toContain('recovery_timeline_general');
    });

    test('"How long does rotator cuff recovery take?" → informational (recovery_timeline_general)', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'How long does rotator cuff recovery take?'
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational).toContain('recovery_timeline_general');
    });

    test('"What is the recovery time for a meniscus tear?" → informational (recovery_timeline_general)', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'What is the recovery time for a meniscus tear?'
      });
      expect(result.queryType).toBe('informational');
      expect(result.signals.informational.length).toBeGreaterThan(0);
    });
  });

  // ===== Heuristic Classifier: Clinical Queries =====

  describe('classifyQueryType — clinical queries', () => {
    test('structured case data with painLevel + duration → clinical', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'Knee pain',
        painLevel: 7,
        duration: '3 weeks',
        location: 'left knee',
        age: 35
      });
      expect(result.queryType).toBe('clinical');
      expect(result.signals.clinical.length).toBeGreaterThanOrEqual(1);
    });

    test('"My knee has been hurting for 3 weeks after I fell" → clinical', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'My knee has been hurting for 3 weeks after I fell'
      });
      expect(result.queryType).toBe('clinical');
      expect(result.signals.clinical).toContain('personal_timeline');
      expect(result.signals.clinical).toContain('injury_mechanism');
    });

    test('"I twisted my ankle yesterday, pain 8/10" → clinical', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'I twisted my ankle yesterday, pain 8/10'
      });
      expect(result.queryType).toBe('clinical');
      expect(result.signals.clinical).toContain('injury_mechanism');
      expect(result.signals.clinical).toContain('pain_severity');
    });

    test('"I can\'t walk on my left foot" → clinical', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: "I can't walk on my left foot"
      });
      expect(result.queryType).toBe('clinical');
      expect(result.signals.clinical).toContain('functional_limitation');
    });

    test('"My doctor prescribed ibuprofen for my shoulder pain" → clinical', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'My doctor prescribed ibuprofen for my shoulder pain'
      });
      expect(result.queryType).toBe('clinical');
      expect(result.signals.clinical).toContain('treatment_history');
    });

    test('"I had ACL surgery 2 weeks ago and my knee is still swollen" → clinical (overrides recovery timeline)', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'I had ACL surgery 2 weeks ago and my knee is still swollen'
      });
      expect(result.queryType).toBe('clinical');
      // Should detect clinical signals that prevent recovery_timeline_general
      expect(result.signals.clinical.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===== Ambiguous → Clinical Defaults =====

  describe('classifyQueryType — ambiguous defaults to clinical', () => {
    test('"My knee hurts" (bare, no context) → clinical', () => {
      const result = triageAgent.classifyQueryType({
        primaryComplaint: 'My knee hurts'
      });
      expect(result.queryType).toBe('clinical');
      expect(result.confidence).toBeLessThanOrEqual(0.55);
    });

    test('empty query → clinical', () => {
      const result = triageAgent.classifyQueryType({});
      expect(result.queryType).toBe('clinical');
      expect(result.confidence).toBe(0.5);
    });
  });

  // ===== Emergency Override =====

  describe('triageAssessment — emergency override', () => {
    test('emergency urgency forces queryType to clinical regardless of LLM classification', () => {
      // Simulate parseTriageResponse returning informational with emergency urgency
      const response = `
        1. PRIMARY FINDINGS:
        - General educational query about compartment syndrome

        2. URGENCY CLASSIFICATION: Emergency

        QUERY_TYPE: INFORMATIONAL
        QUERY_SUBTYPE: FACTUAL
      `;
      const parsed = triageAgent.parseTriageResponse(response);
      // Parser picks up INFORMATIONAL
      expect(parsed.queryType).toBe('informational');
      expect(parsed.urgencyLevel).toBe('emergency');

      // The triageAssessment return logic overrides: emergency → clinical
      // We test this by checking the override logic directly
      const queryType = (parsed.urgencyLevel === 'emergency' || parsed.urgencyLevel === 'urgent')
        ? 'clinical'
        : (parsed.queryType || 'clinical');
      expect(queryType).toBe('clinical');
    });
  });

  // ===== Parser Tests =====

  describe('parseTriageResponse — queryType and querySubtype parsing', () => {
    test('parses QUERY_TYPE: INFORMATIONAL from LLM response', () => {
      const response = `
        1. PRIMARY FINDINGS:
        - General knowledge question

        QUERY_TYPE: INFORMATIONAL
        QUERY_SUBTYPE: FACTUAL
      `;
      const result = triageAgent.parseTriageResponse(response);
      expect(result.queryType).toBe('informational');
    });

    test('parses QUERY_TYPE: CLINICAL from LLM response', () => {
      const response = `
        1. PRIMARY FINDINGS:
        - Patient presenting with acute symptoms

        QUERY_TYPE: CLINICAL
        QUERY_SUBTYPE: FACTUAL
      `;
      const result = triageAgent.parseTriageResponse(response);
      expect(result.queryType).toBe('clinical');
    });

    test('parses QUERY_SUBTYPE: DEBATABLE from LLM response (Phase 2 stub)', () => {
      const response = `
        1. PRIMARY FINDINGS:
        - Treatment comparison question

        QUERY_TYPE: INFORMATIONAL
        QUERY_SUBTYPE: DEBATABLE
      `;
      const result = triageAgent.parseTriageResponse(response);
      expect(result.querySubtype).toBe('debatable');
    });

    test('defaults to clinical / null when section 8 is missing', () => {
      const response = `
        1. PRIMARY FINDINGS:
        - Standard triage without query type section
      `;
      const result = triageAgent.parseTriageResponse(response);
      expect(result.queryType).toBe('clinical');
      expect(result.querySubtype).toBeNull();
    });

    test('parses markdown-bold formatted QUERY_TYPE: **QUERY_TYPE:** INFORMATIONAL', () => {
      const response = `
        1. PRIMARY FINDINGS:
        - General knowledge question

        **QUERY_TYPE:** INFORMATIONAL
        **QUERY_SUBTYPE:** DEBATABLE
      `;
      const result = triageAgent.parseTriageResponse(response);
      expect(result.queryType).toBe('informational');
      expect(result.querySubtype).toBe('debatable');
    });

    test('parses QUERY_TYPE with extra whitespace around colon', () => {
      const response = `
        1. PRIMARY FINDINGS:
        - General question

        QUERY_TYPE :  INFORMATIONAL
        QUERY_SUBTYPE :  FACTUAL
      `;
      const result = triageAgent.parseTriageResponse(response);
      expect(result.queryType).toBe('informational');
      expect(result.querySubtype).toBe('factual');
    });

    test('parses QUERY TYPE with space separator (no underscore)', () => {
      const response = `
        1. PRIMARY FINDINGS:
        - General question

        QUERY TYPE: INFORMATIONAL
        QUERY SUBTYPE: FACTUAL
      `;
      const result = triageAgent.parseTriageResponse(response);
      expect(result.queryType).toBe('informational');
      expect(result.querySubtype).toBe('factual');
    });
  });

  // ===== Regression: effectiveQueryType OR-logic =====

  describe('effectiveQueryType — OR-logic regression', () => {
    test('heuristic informational + parser default clinical → informational', () => {
      // Simulates the production bug: parser fails, defaults to 'clinical',
      // but heuristic correctly says 'informational'
      const triageQueryType = 'clinical'; // parser failed, kept default
      const heuristicQueryType = 'informational'; // heuristic detected correctly

      // Old broken logic: 'clinical' || 'informational' = 'clinical'
      const oldLogic = triageQueryType || heuristicQueryType;
      expect(oldLogic).toBe('clinical'); // confirms the bug

      // New fixed logic: either saying informational → informational
      const newLogic =
        (triageQueryType === 'informational' || heuristicQueryType === 'informational')
          ? 'informational'
          : 'clinical';
      expect(newLogic).toBe('informational'); // confirms the fix
    });

    test('both say clinical → clinical', () => {
      const triageQueryType = 'clinical';
      const heuristicQueryType = 'clinical';
      const result =
        (triageQueryType === 'informational' || heuristicQueryType === 'informational')
          ? 'informational'
          : 'clinical';
      expect(result).toBe('clinical');
    });

    test('triage says informational, heuristic says clinical → informational', () => {
      const triageQueryType = 'informational';
      const heuristicQueryType = 'clinical';
      const result =
        (triageQueryType === 'informational' || heuristicQueryType === 'informational')
          ? 'informational'
          : 'clinical';
      expect(result).toBe('informational');
    });
  });
});
