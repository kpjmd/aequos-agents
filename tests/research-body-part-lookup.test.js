/**
 * research-body-part-lookup.test.js
 *
 * Regression tests for anatomical term coverage in the research agent.
 *
 * Background: the research agent's PubMed query builder relies on two lookup
 * tables (bodyPartMap in extractClinicalTerms, fallback list in scoreRelevance)
 * to convert free-text anatomy into targeted PubMed search terms.  If a term
 * is missing from the map the query falls back to a generic "(fracture AND …)"
 * form, PubMed returns off-topic papers, and all are rejected by the relevance
 * filter — producing "0 citations curated from 20 results".
 *
 * These tests pin the specific bone/structure → PubMed term mappings so that
 * a future omission is caught immediately rather than discovered through manual
 * testing of a live consultation.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Mock config before importing any agents
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
    invoke: jest.fn().mockResolvedValue({ content: 'Mock summary.' }),
  })),
}));

jest.unstable_mockModule('@coinbase/cdp-agentkit-core', () => ({
  default: {},
  CdpAgentkit: jest.fn(),
}));

const { ResearchAgent } = await import('../src/agents/research-agent.js');

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock study suitable for filterByQuality / scoreRelevance.
 * Override any field via the `overrides` object.
 */
function mockStudy(title, abstract = '', overrides = {}) {
  return {
    title,
    abstract,
    journal: 'Journal of Bone and Joint Surgery',  // tier-1 → +3 quality
    year: '2024',
    studyType: 'Randomized Controlled Trial',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Long bones (regression guard for the first fix)
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Body Part Lookup: Long Bones', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  const cases = [
    ['clavicle fracture treatment', 'clavicle'],
    ['collarbone injury management', 'clavicle'],
    ['scapula fracture displaced', 'scapula'],
    ['humerus fracture pediatric', 'humerus'],
    ['tibia fracture management', 'tibia'],
    ['fibula stress fracture athlete', 'fibula'],
    ['femur fracture elderly patient', 'femur'],
    ['patella fracture treatment options', 'patella'],
    ['radius fracture distal', 'radius'],
    ['ulna fracture management', 'ulna'],
    ['rib fracture trauma', 'rib'],
    ['pelvis fracture elderly', 'pelvis'],
  ];

  test.each(cases)(
    'extractClinicalTerms("%s") includes "%s"',
    (queryText, expectedTerm) => {
      const terms = agent.extractClinicalTerms(queryText, {});
      expect(terms).toContain(expectedTerm);
    }
  );

  test('existing soft-tissue joints still resolve (regression)', () => {
    expect(agent.extractClinicalTerms('knee meniscal tear', {})).toContain('knee');
    expect(agent.extractClinicalTerms('shoulder rotator cuff pain', {})).toContain('shoulder');
    expect(agent.extractClinicalTerms('hip osteoarthritis', {})).toContain('hip');
    expect(agent.extractClinicalTerms('ankle sprain treatment', {})).toContain('ankle');
    expect(agent.extractClinicalTerms('wrist pain after fall', {})).toContain('wrist');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Sub-anatomical: shoulder structures
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Body Part Lookup: Shoulder Sub-structures', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  test('glenoid fracture → "glenoid"', () => {
    expect(agent.extractClinicalTerms('glenoid fracture surgery', {})).toContain('glenoid');
  });

  test('greater tuberosity fracture → "greater tuberosity"', () => {
    expect(agent.extractClinicalTerms('greater tuberosity fracture treatment', {})).toContain('greater tuberosity');
  });

  test('proximal humerus fracture → "proximal humerus"', () => {
    expect(agent.extractClinicalTerms('proximal humerus fracture elderly', {})).toContain('proximal humerus');
  });

  test('"humeral head" maps to proximal humerus term', () => {
    const terms = agent.extractClinicalTerms('humeral head fracture displaced', {});
    expect(terms).toContain('proximal humerus');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Sub-anatomical: ankle / foot structures (motivating bug)
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Body Part Lookup: Ankle/Foot Sub-structures', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  test('talus fracture → "talus" (the original motivating case)', () => {
    expect(agent.extractClinicalTerms('xray showed a talus fracture', {})).toContain('talus');
  });

  test('calcaneus fracture → "calcaneus"', () => {
    expect(agent.extractClinicalTerms('calcaneus fracture management', {})).toContain('calcaneus');
  });

  test('navicular fracture → "navicular"', () => {
    expect(agent.extractClinicalTerms('navicular stress fracture foot', {})).toContain('navicular');
  });

  test('metatarsal fracture → "metatarsal"', () => {
    expect(agent.extractClinicalTerms('5th metatarsal fracture treatment', {})).toContain('metatarsal');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Sub-anatomical: hip / knee structures
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Body Part Lookup: Hip/Knee Sub-structures', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  test('femoral neck fracture → "femoral neck"', () => {
    expect(agent.extractClinicalTerms('femoral neck fracture elderly', {})).toContain('femoral neck');
  });

  test('tibial plateau fracture → "tibial plateau"', () => {
    expect(agent.extractClinicalTerms('tibial plateau fracture after skiing', {})).toContain('tibial plateau');
  });

  test('"tibial" alone does not shadow "tibial plateau" when full phrase present', () => {
    // This catches the multi-word ordering bug: 'tibia' must not match before 'tibial plateau'
    const terms = agent.extractClinicalTerms('tibial plateau fracture surgery', {});
    expect(terms).toContain('tibial plateau');
    expect(terms).not.toContain('tibia');
  });

  test('acetabulum fracture → "acetabulum"', () => {
    expect(agent.extractClinicalTerms('acetabulum fracture treatment', {})).toContain('acetabulum');
  });

  test('intertrochanteric fracture → "intertrochanteric"', () => {
    expect(agent.extractClinicalTerms('intertrochanteric hip fracture elderly', {})).toContain('intertrochanteric');
  });

  test('groin pain → "hip" (synonym mapping)', () => {
    expect(agent.extractClinicalTerms('34yo cyclist with groin pain for 4 months', {})).toContain('hip');
  });

  test('adductor strain → "hip" (synonym mapping)', () => {
    expect(agent.extractClinicalTerms('adductor strain after running', {})).toContain('hip');
  });

  test('inner thigh pain → "hip" (synonym mapping)', () => {
    expect(agent.extractClinicalTerms('inner thigh pain worsening with activity', {})).toContain('hip');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Sub-anatomical: elbow / wrist structures
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Body Part Lookup: Elbow/Wrist Sub-structures', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  test('radial head fracture → "radial head"', () => {
    expect(agent.extractClinicalTerms('radial head fracture elbow pain', {})).toContain('radial head');
  });

  test('"radial" alone does not shadow "radial head" when full phrase present', () => {
    const terms = agent.extractClinicalTerms('radial head fracture treatment', {});
    expect(terms).toContain('radial head');
    expect(terms).not.toContain('radius');
  });

  test('olecranon fracture → "olecranon"', () => {
    expect(agent.extractClinicalTerms('olecranon fracture fixation', {})).toContain('olecranon');
  });

  test('scaphoid fracture → "scaphoid"', () => {
    expect(agent.extractClinicalTerms('scaphoid fracture wrist pain', {})).toContain('scaphoid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — buildPubMedQuery integration: bone term appears in the final query
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - buildPubMedQuery: anatomical term in query string', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  test('talus fracture query contains "talus"', () => {
    const query = agent.buildPubMedQuery('xray showed a talus fracture what should I do');
    expect(query).toContain('talus');
  });

  test('tibial plateau fracture query contains "tibial plateau"', () => {
    const query = agent.buildPubMedQuery('tibial plateau fracture after skiing accident');
    expect(query).toContain('tibial plateau');
  });

  test('radial head fracture query contains "radial head"', () => {
    const query = agent.buildPubMedQuery('radial head fracture elbow pain after fall');
    expect(query).toContain('radial head');
  });

  test('object-form clavicle query (original bug scenario) contains "clavicle"', () => {
    const query = agent.buildPubMedQuery({
      primaryComplaint: '17yo clavicle fracture 5 days after falling off skateboard',
      bodyPart: 'clavicle',
    });
    expect(query).toContain('clavicle');
  });

  test('all queries still include date and study-type filters', () => {
    const query = agent.buildPubMedQuery('talus fracture management');
    expect(query).toContain('2020');
    expect(query).toContain('2025');
    expect(query).toContain('Meta-Analysis');
    expect(query).toContain('English[la]');
    expect(query).toContain('Humans[MeSH]');
  });

  test('posterolateral corner query contains "posterolateral corner", not "anterior cruciate ligament"', () => {
    const query = agent.buildPubMedQuery('What is a posterolateral corner knee injury?');
    expect(query).toContain('posterolateral corner');
    expect(query).not.toContain('anterior cruciate ligament');
  });

  test('PLC abbreviation expands to posterolateral corner in query', () => {
    const query = agent.buildPubMedQuery('PLC reconstruction surgery outcomes');
    expect(query).toContain('posterolateral corner');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — scoreRelevance: bone papers score above the ≥3 threshold
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - scoreRelevance: bone-specific papers pass threshold', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  test('talus fracture paper scores ≥3 for talus fracture query', () => {
    const study = mockStudy(
      'Surgical Management of Displaced Talus Fractures',
      'Talus fractures are uncommon but serious injuries. This review examines surgical versus conservative treatment.'
    );
    const query = { primaryComplaint: 'xray showed a talus fracture', bodyPart: 'talus' };
    expect(agent.scoreRelevance(study, query)).toBeGreaterThanOrEqual(3);
  });

  test('clavicle fracture paper scores ≥3 for clavicle fracture query (original bug)', () => {
    const study = mockStudy(
      'Surgical vs Non-Operative Treatment of Displaced Clavicle Fractures',
      'Clavicle fractures are among the most common fractures. Displaced fractures may require surgical fixation.'
    );
    const query = { primaryComplaint: '17yo clavicle fracture 5 days after skateboard fall', bodyPart: 'clavicle' };
    expect(agent.scoreRelevance(study, query)).toBeGreaterThanOrEqual(3);
  });

  test('tibial plateau paper scores ≥3 for tibial plateau query', () => {
    const study = mockStudy(
      'Tibial Plateau Fracture Fixation: A Systematic Review',
      'Tibial plateau fractures present unique challenges. This review evaluates surgical approaches.'
    );
    const query = { primaryComplaint: 'tibial plateau fracture after skiing', bodyPart: 'tibial plateau' };
    expect(agent.scoreRelevance(study, query)).toBeGreaterThanOrEqual(3);
  });

  test('off-topic paper (knee replacement) scores <3 for talus fracture query', () => {
    const study = mockStudy(
      'Total Knee Arthroplasty Outcomes in Osteoarthritis',
      'Total knee replacement improves function in patients with end-stage knee osteoarthritis.'
    );
    const query = { primaryComplaint: 'xray showed a talus fracture', bodyPart: 'talus' };
    expect(agent.scoreRelevance(study, query)).toBeLessThan(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — Regression: "0 citations" end-to-end scenario
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Regression: 0 citations for specific bones', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  test('talus fracture paper survives filterByQuality against talus query', () => {
    const papers = [
      mockStudy(
        'Surgical Management of Displaced Talus Fractures',
        'Talus fractures require careful evaluation. This RCT compares surgical and conservative management outcomes in 150 patients with displaced talar neck fractures.',
      ),
      // Off-topic papers that should be filtered out
      mockStudy(
        'Total Knee Arthroplasty Outcomes in Osteoarthritis',
        'Total knee replacement outcomes study in patients with knee osteoarthritis.',
      ),
      mockStudy(
        'Lumbar Disc Herniation Conservative Management',
        'Conservative treatment of lumbar disc herniation with physical therapy.',
      ),
      mockStudy(
        'Rotator Cuff Repair Techniques: A Systematic Review',
        'Comparison of double-row versus single-row rotator cuff repair in shoulder surgery.',
      ),
    ];

    const query = {
      primaryComplaint: 'patient fell and xray showed a talus fracture, what treatment is recommended',
      bodyPart: 'talus',
    };

    const results = agent.filterByQuality(papers, query, 'basic');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain('Talus');
  });

  test('clavicle fracture paper survives filterByQuality (original bug regression)', () => {
    const papers = [
      mockStudy(
        'Surgical vs Conservative Treatment of Displaced Clavicle Fractures in Adolescents',
        'Clavicle fractures are common in adolescents. This RCT of 120 patients compares ORIF with sling immobilization for displaced midshaft clavicle fractures.',
      ),
      mockStudy(
        'Hip Fracture Management in Elderly Patients',
        'Intertrochanteric hip fractures in patients over 75 years.',
      ),
      mockStudy(
        'Anterior Cruciate Ligament Reconstruction Outcomes',
        'ACL reconstruction with patellar tendon autograft versus hamstring tendon graft.',
      ),
    ];

    const query = {
      primaryComplaint: '17yo with clavicle fracture 5 days after falling off skateboard',
      bodyPart: 'clavicle',
    };

    const results = agent.filterByQuality(papers, query, 'basic');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain('Clavicle');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 9 — Posterolateral corner (motivating bug: ACL returned instead of PLC)
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Posterolateral Corner: condition map and abbreviation', () => {
  let agent;
  beforeEach(() => { agent = new ResearchAgent(); });

  test('extractClinicalTerms: "posterolateral corner" → includes posterolateral corner term', () => {
    const terms = agent.extractClinicalTerms('posterolateral corner knee injury', {});
    expect(terms.some(t => t.includes('posterolateral corner'))).toBe(true);
  });

  test('buildPubMedQuery: PLC abbreviation expands to posterolateral corner', () => {
    // Abbreviation expansion happens in buildPubMedQuery before extractClinicalTerms is called
    const query = agent.buildPubMedQuery('PLC reconstruction surgery outcomes');
    expect(query).toContain('posterolateral corner');
  });

  test('extractClinicalTerms: "posterolateral corner" does NOT produce "anterior cruciate ligament"', () => {
    const terms = agent.extractClinicalTerms('posterolateral corner knee injury', {});
    expect(terms).not.toContain('"anterior cruciate ligament"');
  });

  test('PLC paper scores ≥3 for posterolateral corner query', () => {
    const study = mockStudy(
      'Posterolateral Corner Reconstruction: Outcomes and Complications',
      'The posterolateral corner (PLC) is a complex anatomical structure. This review evaluates PLC reconstruction outcomes in 180 patients.'
    );
    const query = { primaryComplaint: 'What is a posterolateral corner knee injury?', bodyPart: 'knee' };
    expect(agent.scoreRelevance(study, query)).toBeGreaterThanOrEqual(3);
  });
});
