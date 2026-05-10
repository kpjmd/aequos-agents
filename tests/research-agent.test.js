import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Mock config before importing any agents
jest.unstable_mockModule('../src/config/agent-config.js', () => ({
  agentConfig: {
    cdp: {
      apiKeyName: 'test_key',
      privateKey: 'test_private_key'
    },
    claude: {
      apiKey: 'test_claude_key'
    },
    network: {
      id: 'base-sepolia'
    },
    agent: {
      minConfidenceThreshold: 0.7,
      experienceMultiplier: 1.0
    },
    pubmed: {
      apiKey: null,
      requestTimeout: 15000,
      maxResults: 20
    },
    blockchain: {
      enabled: false,
      mockResponses: true
    },
    environment: {
      nodeEnv: 'test',
      logLevel: 'error'
    }
  }
}));

// Mock LangChain Anthropic to avoid real API calls
jest.unstable_mockModule('@langchain/anthropic', () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({
      content: 'Mock research summary paragraph one. Mock research summary paragraph two.'
    })
  }))
}));

// Mock CDP agentkit core
jest.unstable_mockModule('@coinbase/cdp-agentkit-core', () => ({
  default: {},
  CdpAgentkit: jest.fn()
}));

// Import after mocking (moduleNameMapper handles agentkit/cdp-sdk automatically)
const { ResearchAgent } = await import('../src/agents/research-agent.js');
const { BaseAgent } = await import('../src/agents/base-agent.js');
const { OrthopedicSpecialist } = await import('../src/agents/orthopedic-specialist.js');

describe('ResearchAgent - Initialization', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should initialize with correct properties', () => {
    expect(agent.name).toBe('Research Pioneer');
    expect(agent.specialization).toBe('medical literature research and evidence curation');
    expect(agent.agentId).toBe('researchPioneer');
    expect(agent.agentType).toBe('research_pioneer');
    expect(agent.pubmedBaseUrl).toBe('https://eutils.ncbi.nlm.nih.gov/entrez/eutils');
    expect(agent.requestTimeout).toBe(15000);
    expect(agent.maxResults).toBe(20);
    expect(agent.journalTiers).toBeDefined();
    expect(agent.researchHistory).toEqual([]);
    expect(agent.searchCache).toBeInstanceOf(Map);
  });

  test('should extend BaseAgent, NOT OrthopedicSpecialist', () => {
    expect(agent).toBeInstanceOf(BaseAgent);
    expect(agent).not.toBeInstanceOf(OrthopedicSpecialist);
  });

  test('should have a research-focused system prompt', () => {
    const prompt = agent.getSystemPrompt();
    expect(prompt).toBeDefined();
    expect(prompt).toContain('Research Pioneer');
    expect(prompt).toContain('plain language');
    expect(prompt).toContain('evidence');
    expect(prompt).toContain('limitations');
  });
});

describe('ResearchAgent - Query Building', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should add date, study type, language, and human filters', () => {
    const query = agent.buildPubMedQuery('knee pain after surgery');
    expect(query).toContain('2020');
    expect(query).toContain('2025');
    expect(query).toContain('Meta-Analysis');
    expect(query).toContain('Systematic Review');
    expect(query).toContain('Randomized Controlled Trial');
    expect(query).toContain('English[la]');
    expect(query).toContain('Humans[MeSH]');
  });

  test('should expand ACL abbreviation', () => {
    const query = agent.buildPubMedQuery('acl reconstruction recovery');
    expect(query).toContain('anterior cruciate ligament');
    expect(query).not.toMatch(/\bacl\b/i);
  });

  test('should handle shoulder injury query object', () => {
    const query = agent.buildPubMedQuery({
      primaryComplaint: 'shoulder pain',
      symptoms: 'rotator cuff weakness',
    });
    expect(query).toContain('shoulder');
    expect(query).toContain('"rotator cuff"');
  });

  test('should expand LBP abbreviation for chronic back pain', () => {
    const query = agent.buildPubMedQuery('chronic lbp treatment');
    expect(query).toContain('lumbar');
  });

  test('should handle obscure presentation as-is', () => {
    const query = agent.buildPubMedQuery('patellofemoral crepitus bilateral');
    expect(query).toContain('patellofemoral crepitus bilateral');
    expect(query).toContain('English[la]');
  });
});

describe('ResearchAgent - XML Parsing', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should parse full PubMed XML article', () => {
    const sampleXml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>12345678</PMID>
      <Article>
        <Journal>
          <ISOAbbreviation>J Bone Joint Surg Am</ISOAbbreviation>
          <JournalIssue>
            <Volume>105</Volume>
            <Issue>3</Issue>
            <PubDate>
              <Year>2023</Year>
            </PubDate>
          </JournalIssue>
          <Title>Journal of Bone and Joint Surgery</Title>
        </Journal>
        <ArticleTitle>ACL Reconstruction Outcomes: A Systematic Review</ArticleTitle>
        <Pagination>
          <MedlinePgn>215-228</MedlinePgn>
        </Pagination>
        <ELocationID EIdType="doi">10.2106/JBJS.22.01234</ELocationID>
        <Abstract>
          <AbstractText>This systematic review evaluates ACL reconstruction outcomes across 50 studies.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Smith</LastName>
            <Initials>JA</Initials>
          </Author>
          <Author>
            <LastName>Jones</LastName>
            <Initials>BK</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType>Systematic Review</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(sampleXml);
    expect(articles).toHaveLength(1);

    const article = articles[0];
    expect(article.pmid).toBe('12345678');
    expect(article.title).toBe('ACL Reconstruction Outcomes: A Systematic Review');
    expect(article.authors).toBe('Smith J, Jones B');
    expect(article.rawAuthors).toEqual(['Smith JA', 'Jones BK']);
    expect(article.journal).toBe('Journal of Bone and Joint Surgery');
    expect(article.year).toBe('2023');
    expect(article.volume).toBe('105');
    expect(article.issue).toBe('3');
    expect(article.pages).toBe('215-228');
    expect(article.doi).toBe('10.2106/JBJS.22.01234');
    expect(article.pubmedUrl).toBe('https://pubmed.ncbi.nlm.nih.gov/12345678/');
    expect(article.abstract).toContain('systematic review');
    expect(article.studyType).toBe('Systematic Review');
  });

  test('should handle empty XML gracefully', () => {
    const emptyXml = `<?xml version="1.0" ?>
<PubmedArticleSet></PubmedArticleSet>`;

    const articles = agent.parseArticleXML(emptyXml);
    expect(articles).toEqual([]);
  });

  test('should handle malformed XML gracefully', () => {
    const malformedXml = 'not xml at all <broken>';
    const articles = agent.parseArticleXML(malformedXml);
    // Should return empty array rather than throwing
    expect(Array.isArray(articles)).toBe(true);
  });
});

describe('ResearchAgent - Quality Scoring', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should return correct journal tier scores', () => {
    expect(agent.getJournalTierScore('Journal of Bone and Joint Surgery')).toBe(3);
    expect(agent.getJournalTierScore('JBJS')).toBe(3);
    expect(agent.getJournalTierScore('New England Journal of Medicine')).toBe(3);
    expect(agent.getJournalTierScore('Clinical Orthopaedics and Related Research')).toBe(2);
    expect(agent.getJournalTierScore('Journal of Orthopaedic and Sports Physical Therapy')).toBe(1);
    expect(agent.getJournalTierScore('Unknown Journal')).toBe(0);
  });

  test('should filter and sort studies by quality', () => {
    const studies = [
      {
        title: 'Low quality study',
        journal: 'Unknown Journal',
        year: '2015',
        studyType: 'Other',
        abstract: '',
      },
      {
        title: 'High quality meta-analysis',
        journal: 'Journal of Bone and Joint Surgery',
        year: '2024',
        studyType: 'Meta-Analysis',
        abstract: 'A comprehensive meta-analysis examining outcomes.',
      },
      {
        title: 'Medium quality RCT',
        journal: 'Spine',
        year: '2022',
        studyType: 'Randomized Controlled Trial',
        abstract: 'This RCT compared two surgical approaches.',
      },
    ];

    const filtered = agent.filterByQuality(studies, 'quality');

    // High quality should be first (5+3+2+2=12 capped to 10)
    expect(filtered[0].title).toBe('High quality meta-analysis');
    expect(filtered[0].qualityScore).toBe(10);
    expect(filtered[0]).toHaveProperty('relevanceScore');

    // Medium quality (5+2+2+1=10)
    expect(filtered[1].title).toBe('Medium quality RCT');
    expect(filtered[1].qualityScore).toBe(10);

    // Low quality (5+0+0+0=5) should be filtered out (< 6)
    expect(filtered.find(s => s.title === 'Low quality study')).toBeUndefined();
  });

  test('should classify study types correctly', () => {
    expect(agent.classifyStudyType([{ '#text': 'Meta-Analysis' }])).toBe('Meta-Analysis');
    expect(agent.classifyStudyType([{ '#text': 'Systematic Review' }])).toBe('Systematic Review');
    expect(agent.classifyStudyType([{ '#text': 'Randomized Controlled Trial' }])).toBe('Randomized Controlled Trial');
    expect(agent.classifyStudyType([{ '#text': 'Clinical Trial' }])).toBe('Clinical Trial');
    expect(agent.classifyStudyType([{ '#text': 'Review' }])).toBe('Review');
    expect(agent.classifyStudyType([{ '#text': 'Journal Article' }])).toBe('Other');
    expect(agent.classifyStudyType(null)).toBe('Other');
  });
});

describe('ResearchAgent - Citation Formatting', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should include all required fields in parsed citation', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>99999999</PMID>
      <Article>
        <Journal>
          <JournalIssue>
            <Volume>10</Volume>
            <Issue>2</Issue>
            <PubDate><Year>2024</Year></PubDate>
          </JournalIssue>
          <Title>Test Journal</Title>
        </Journal>
        <ArticleTitle>Test Article</ArticleTitle>
        <Pagination><MedlinePgn>1-10</MedlinePgn></Pagination>
        <ELocationID EIdType="doi">10.1000/test</ELocationID>
        <Abstract><AbstractText>Test abstract text for the article.</AbstractText></Abstract>
        <AuthorList>
          <Author><LastName>Doe</LastName><Initials>J</Initials></Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType>Randomized Controlled Trial</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles).toHaveLength(1);

    const citation = articles[0];
    const requiredFields = [
      'pmid', 'title', 'authors', 'journal', 'year',
      'volume', 'issue', 'pages', 'doi', 'pubmedUrl',
      'abstract', 'studyType', 'qualityScore', 'relevanceScore'
    ];

    requiredFields.forEach(field => {
      expect(citation).toHaveProperty(field);
    });
  });
});

describe('ResearchAgent - Abstract Extraction', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should handle string abstract', () => {
    const result = agent.extractAbstractText('Simple abstract text');
    expect(result).toBe('Simple abstract text');
  });

  test('should handle structured abstract array', () => {
    const structured = [
      { '@_Label': 'BACKGROUND', '#text': 'Background info here.' },
      { '@_Label': 'METHODS', '#text': 'Methods description here.' },
      { '@_Label': 'RESULTS', '#text': 'Results summary here.' },
    ];
    const result = agent.extractAbstractText(structured);
    expect(result).toContain('BACKGROUND: Background info here.');
    expect(result).toContain('METHODS: Methods description here.');
    expect(result).toContain('RESULTS: Results summary here.');
  });

  test('should handle null/undefined abstract', () => {
    expect(agent.extractAbstractText(null)).toBe('');
    expect(agent.extractAbstractText(undefined)).toBe('');
  });
});

describe('ResearchAgent - Statistics', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should return zero initial statistics', () => {
    const stats = agent.getResearchStatistics();
    expect(stats.totalSearches).toBe(0);
    expect(stats.totalCitations).toBe(0);
    expect(stats.avgResponseTime).toBe(0);
  });
});

describe('ResearchAgent - Author Formatting', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should show max 3 authors with et al. when >3', () => {
    const authorList = [
      { LastName: 'Alpha', Initials: 'AA' },
      { LastName: 'Beta', Initials: 'BB' },
      { LastName: 'Gamma', Initials: 'CC' },
      { LastName: 'Delta', Initials: 'DD' },
    ];
    const { formatted, raw } = agent.extractAuthors(authorList);
    expect(raw).toHaveLength(4);
    expect(formatted).toBe('Alpha A, Beta B, Gamma C, et al.');
  });

  test('should use ForeName when Initials absent', () => {
    const authorList = [
      { LastName: 'Smith', ForeName: 'John Andrew' },
    ];
    const { formatted, raw } = agent.extractAuthors(authorList);
    expect(raw).toEqual(['Smith JA']);
    expect(formatted).toBe('Smith J');
  });

  test('should handle CollectiveName', () => {
    const authorList = [
      { CollectiveName: 'WHO Research Group' },
    ];
    const { formatted, raw } = agent.extractAuthors(authorList);
    expect(raw).toEqual(['WHO Research Group']);
    expect(formatted).toBe('WHO Research Group');
  });

  test('should handle mixed author types', () => {
    const authorList = [
      { LastName: 'Smith', Initials: 'JA' },
      { CollectiveName: 'OARSI Group' },
    ];
    const { formatted, raw } = agent.extractAuthors(authorList);
    expect(raw).toEqual(['Smith JA', 'OARSI Group']);
    expect(formatted).toBe('Smith J, OARSI Group');
  });

  test('should return empty formatted and raw for no authors', () => {
    const { formatted, raw } = agent.extractAuthors(null);
    expect(raw).toEqual([]);
    expect(formatted).toBe('');
  });

  test('should format exactly 3 authors without et al.', () => {
    const authorList = [
      { LastName: 'Alpha', Initials: 'A' },
      { LastName: 'Beta', Initials: 'B' },
      { LastName: 'Gamma', Initials: 'C' },
    ];
    const { formatted } = agent.extractAuthors(authorList);
    expect(formatted).toBe('Alpha A, Beta B, Gamma C');
    expect(formatted).not.toContain('et al.');
  });
});

describe('ResearchAgent - Required Field Validation', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should skip article with missing PMID', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID></PMID>
      <Article>
        <Journal><Title>Test</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>Valid Title</ArticleTitle>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles).toHaveLength(0);
  });

  test('should skip article with missing title', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>11111111</PMID>
      <Article>
        <Journal><Title>Test</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle></ArticleTitle>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles).toHaveLength(0);
  });

  test('should keep valid articles and skip invalid in mixed batch', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>22222222</PMID>
      <Article>
        <Journal><Title>Good Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>Valid Article</ArticleTitle>
        <AuthorList><Author><LastName>Good</LastName><Initials>A</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
  <PubmedArticle>
    <MedlineCitation>
      <PMID></PMID>
      <Article>
        <Journal><Title>Bad Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>No PMID Article</ArticleTitle>
        <AuthorList><Author><LastName>Bad</LastName><Initials>B</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles).toHaveLength(1);
    expect(articles[0].pmid).toBe('22222222');
  });
});

describe('ResearchAgent - DOI Fallback', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should extract DOI from PubmedData.ArticleIdList when ELocationID has none', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>33333333</PMID>
      <Article>
        <Journal><Title>Test Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>DOI Fallback Test</ArticleTitle>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">33333333</ArticleId>
        <ArticleId IdType="doi">10.1234/fallback-doi</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles[0].doi).toBe('10.1234/fallback-doi');
  });

  test('should prefer ELocationID DOI over PubmedData DOI', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>44444444</PMID>
      <Article>
        <Journal><Title>Test Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>DOI Priority Test</ArticleTitle>
        <ELocationID EIdType="doi">10.1234/primary-doi</ELocationID>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="doi">10.1234/secondary-doi</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles[0].doi).toBe('10.1234/primary-doi');
  });

  test('should handle no DOI anywhere', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>55555555</PMID>
      <Article>
        <Journal><Title>Test Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>No DOI Article</ArticleTitle>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles[0].doi).toBe('');
  });
});

describe('ResearchAgent - PublicationType Location Fallback', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should find PublicationTypeList under MedlineCitation when not in Article', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>66666666</PMID>
      <Article>
        <Journal><Title>Test Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>PubType Location Test</ArticleTitle>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
      </Article>
      <PublicationTypeList>
        <PublicationType>Meta-Analysis</PublicationType>
      </PublicationTypeList>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles[0].studyType).toBe('Meta-Analysis');
  });
});

describe('ResearchAgent - Additional XML Parsing', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should handle article with no abstract', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>77777777</PMID>
      <Article>
        <Journal><Title>Test Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>No Abstract Article</ArticleTitle>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles).toHaveLength(1);
    expect(articles[0].abstract).toBe('');
  });

  test('should handle multiple ELocationIDs (doi + pii)', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>88888888</PMID>
      <Article>
        <Journal><Title>Test Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>Multi ELocationID Test</ArticleTitle>
        <ELocationID EIdType="pii">S0001-0002(24)00003-4</ELocationID>
        <ELocationID EIdType="doi">10.1234/multi-doi</ELocationID>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles[0].doi).toBe('10.1234/multi-doi');
  });
});

describe('ResearchAgent - Quality Score Calculation', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
    jest.spyOn(agent, 'scoreRelevance').mockReturnValue(5);
  });

  afterEach(() => jest.restoreAllMocks());

  test('should cap score at 10 for tier1 + RCT + recent study', () => {
    const studies = [{
      title: 'ACL Reconstruction Outcomes',
      journal: 'Journal of Bone and Joint Surgery',
      year: '2024',
      studyType: 'Randomized Controlled Trial',
      abstract: '',
    }];
    // 5 (base) + 3 (tier1) + 2 (RCT) + 2 (>=2024) = 12 → capped at 10
    const result = agent.filterByQuality(studies);
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(10);
  });

  test('should score 5 and filter out unknown journal + Other type + old study', () => {
    const studies = [{
      title: 'Old obscure study',
      journal: 'Unknown Journal',
      year: '2015',
      studyType: 'Other',
      abstract: '',
    }];
    // 5 (base) + 0 (unknown) + 0 (Other) + 0 (old) = 5 → filtered out (< 6)
    const result = agent.filterByQuality(studies);
    expect(result).toHaveLength(0);
  });

  test('should score 8.5 for tier2 + review + 2023 study', () => {
    const studies = [{
      title: 'Spine Review 2023',
      journal: 'Spine',
      year: '2023',
      studyType: 'Review',
      abstract: '',
    }];
    // 5 (base) + 2 (tier2) + 1 (Review) + 1.5 (2023) = 9.5
    const result = agent.filterByQuality(studies);
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(9.5);
  });
});

describe('ResearchAgent - Relevance Scoring', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should return 10 for full keyword match', () => {
    const score = agent.scoreRelevance(
      'ACL Reconstruction Recovery Outcomes',
      'ACL reconstruction recovery outcomes'
    );
    expect(score).toBe(10);
  });

  test('should return proportional score for partial match', () => {
    const score = agent.scoreRelevance(
      'Knee Pain After Surgery',
      'knee pain recovery physical therapy'
    );
    // "knee" matches, "pain" matches, "recovery" no, "physical" no, "therapy" no
    // 2/5 terms → 4
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(10);
  });

  test('should return 0 when no query provided', () => {
    expect(agent.scoreRelevance('Some Title', '')).toBe(0);
    expect(agent.scoreRelevance('Some Title', null)).toBe(0);
  });

  test('should handle object-form clinical query', () => {
    const score = agent.scoreRelevance(
      'Rotator Cuff Repair Outcomes',
      { primaryComplaint: 'shoulder pain', diagnosis: 'rotator cuff tear' }
    );
    expect(score).toBeGreaterThan(0);
  });
});

describe('ResearchAgent - Filter Threshold', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
    jest.spyOn(agent, 'scoreRelevance').mockReturnValue(5);
  });

  afterEach(() => jest.restoreAllMocks());

  test('should include studies scoring exactly 6', () => {
    const studies = [{
      title: 'Borderline study',
      journal: 'Journal of Orthopaedic and Sports Physical Therapy',
      year: '2019',
      studyType: 'Other',
      abstract: '',
    }];
    // 5 (base) + 1 (tier3) + 0 (Other) + 0 (old) = 6 → included
    const result = agent.filterByQuality(studies);
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(6);
  });

  test('should exclude studies scoring below 6', () => {
    const studies = [{
      title: 'Below threshold study',
      journal: 'Unknown Journal',
      year: '2019',
      studyType: 'Other',
      abstract: '',
    }];
    // 5 (base) + 0 (unknown) + 0 (Other) + 0 (old) = 5 → excluded
    const result = agent.filterByQuality(studies);
    expect(result).toHaveLength(0);
  });
});

describe('ResearchAgent - Tier-based Limiting', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
    jest.spyOn(agent, 'scoreRelevance').mockReturnValue(5);
  });

  afterEach(() => jest.restoreAllMocks());

  const makeStudies = (count) => Array.from({ length: count }, (_, i) => ({
    title: `Study ${i + 1}`,
    journal: 'Journal of Bone and Joint Surgery',
    year: '2024',
    studyType: 'Meta-Analysis',
    abstract: '',
  }));

  test('should return max 3 studies for basic tier', () => {
    const studies = makeStudies(6);
    const result = agent.filterByQuality(studies, '', 'basic');
    expect(result).toHaveLength(3);
  });

  test('should return max 5 studies for premium tier', () => {
    const studies = makeStudies(8);
    const result = agent.filterByQuality(studies, '', 'premium');
    expect(result).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Expanded PubMed Query Generation
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Query Building (Expanded Abbreviations)', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should expand TKA to total knee arthroplasty', () => {
    const query = agent.buildPubMedQuery('tka rehabilitation outcomes');
    expect(query).toContain('knee');
    expect(query).toContain('arthroplasty');
    expect(query).not.toMatch(/\btka\b/i);
  });

  test('should expand THA to total hip arthroplasty', () => {
    const query = agent.buildPubMedQuery('tha recovery protocol');
    expect(query).toContain('hip');
    expect(query).toContain('arthroplasty');
    expect(query).not.toMatch(/\btha\b/i);
  });

  test('should expand THR to total hip replacement', () => {
    const query = agent.buildPubMedQuery('thr complications postoperative');
    expect(query).toContain('hip');
    expect(query).toContain('replacement');
    expect(query).not.toMatch(/\bthr\b/i);
  });

  test('should expand TKR to total knee replacement', () => {
    const query = agent.buildPubMedQuery('tkr rehabilitation protocol');
    expect(query).toContain('knee');
    expect(query).toContain('replacement');
    expect(query).not.toMatch(/\btkr\b/i);
  });

  test('should expand MCL to medial collateral ligament', () => {
    const query = agent.buildPubMedQuery('mcl sprain treatment options');
    expect(query).toContain('medial collateral ligament');
    expect(query).not.toMatch(/\bmcl\b/i);
  });

  test('should expand LCL to lateral collateral ligament', () => {
    const query = agent.buildPubMedQuery('lcl injury management');
    expect(query).toContain('lateral collateral ligament');
    expect(query).not.toMatch(/\blcl\b/i);
  });

  test('should expand PCL to posterior cruciate ligament', () => {
    const query = agent.buildPubMedQuery('pcl reconstruction surgery');
    expect(query).toContain('posterior cruciate ligament');
    expect(query).not.toMatch(/\bpcl\b/i);
  });

  test('should expand ROM to range of motion', () => {
    const query = agent.buildPubMedQuery('limited rom shoulder exercises');
    expect(query).toContain('shoulder');
    expect(query).not.toMatch(/\brom\b/i);
  });

  test('should expand multiple abbreviations in one query', () => {
    const query = agent.buildPubMedQuery('acl and mcl combined injury treatment');
    expect(query).toContain('anterior cruciate ligament');
    expect(query).not.toMatch(/\bacl\b/i);
    expect(query).not.toMatch(/\bmcl\b/i);
  });
});

describe('ResearchAgent - Query Building (Object and Edge Cases)', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should handle query object with diagnosis and procedure fields', () => {
    const query = agent.buildPubMedQuery({
      primaryComplaint: 'knee pain',
      diagnosis: 'meniscal tear',
      procedure: 'arthroscopic repair',
    });
    expect(query).toContain('knee');
    expect(query).toContain('meniscus');
    expect(query).toContain('arthroscopy');
  });

  test('should handle query object with only diagnosis field', () => {
    const query = agent.buildPubMedQuery({ diagnosis: 'rotator cuff tear' });
    expect(query).toContain('"rotator cuff"');
    expect(query).toContain('English[la]');
    expect(query).toContain('Humans[MeSH]');
  });

  test('should handle empty string input without throwing', () => {
    const query = agent.buildPubMedQuery('');
    expect(typeof query).toBe('string');
    expect(query).toContain('English[la]');
    expect(query).toContain('Humans[MeSH]');
    expect(query).toContain('()');
  });

  test('should handle whitespace-only string input without throwing', () => {
    const query = agent.buildPubMedQuery('   ');
    expect(typeof query).toBe('string');
    expect(query).toContain('English[la]');
    expect(query).toContain('Humans[MeSH]');
  });

  test('should handle very long query string (500+ chars) without throwing', () => {
    const longQuery = 'knee '.repeat(100);
    const query = agent.buildPubMedQuery(longQuery);
    expect(typeof query).toBe('string');
    expect(query).toContain('knee');
    expect(query).toContain('English[la]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Orthopedic Condition Mock XML Data
// ─────────────────────────────────────────────────────────────────────────────

const ACL_MOCK_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>38001001</PMID>
      <Article>
        <Journal>
          <ISOAbbreviation>Am J Sports Med</ISOAbbreviation>
          <JournalIssue>
            <Volume>52</Volume>
            <Issue>4</Issue>
            <PubDate><Year>2024</Year></PubDate>
          </JournalIssue>
          <Title>American Journal of Sports Medicine</Title>
        </Journal>
        <ArticleTitle>Hamstring vs Patellar Tendon Autograft for ACL Reconstruction: A Randomized Controlled Trial With 5-Year Follow-up</ArticleTitle>
        <Pagination><MedlinePgn>891-903</MedlinePgn></Pagination>
        <ELocationID EIdType="doi">10.1177/03635465231225678</ELocationID>
        <Abstract>
          <AbstractText Label="BACKGROUND">Anterior cruciate ligament reconstruction graft choice remains debated.</AbstractText>
          <AbstractText Label="METHODS">A total of 240 patients were randomized to hamstring or patellar tendon autograft ACL reconstruction.</AbstractText>
          <AbstractText Label="RESULTS">At 5-year follow-up, both groups showed similar IKDC scores (88.2 vs 87.5, p=0.42).</AbstractText>
          <AbstractText Label="CONCLUSION">Both graft types provide comparable long-term outcomes for primary ACL reconstruction.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author><LastName>Rodriguez</LastName><Initials>MA</Initials></Author>
          <Author><LastName>Chen</LastName><Initials>WL</Initials></Author>
          <Author><LastName>Patel</LastName><Initials>RK</Initials></Author>
          <Author><LastName>Williams</LastName><Initials>TA</Initials></Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType>Randomized Controlled Trial</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

const SHOULDER_MOCK_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>38002002</PMID>
      <Article>
        <Journal>
          <JournalIssue>
            <Volume>32</Volume>
            <Issue>8</Issue>
            <PubDate><Year>2023</Year></PubDate>
          </JournalIssue>
          <Title>Journal of Shoulder and Elbow Surgery</Title>
        </Journal>
        <ArticleTitle>Subacromial Decompression vs Conservative Treatment for Shoulder Impingement Syndrome: A Systematic Review</ArticleTitle>
        <Pagination><MedlinePgn>1645-1658</MedlinePgn></Pagination>
        <ELocationID EIdType="doi">10.1016/j.jse.2023.04.012</ELocationID>
        <Abstract>
          <AbstractText>This systematic review compares surgical and conservative management of subacromial impingement syndrome across 28 randomized controlled trials.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author><LastName>Kim</LastName><Initials>SK</Initials></Author>
          <Author><LastName>Nakamura</LastName><Initials>T</Initials></Author>
          <Author><LastName>Davis</LastName><Initials>JL</Initials></Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType>Systematic Review</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

const LBP_MOCK_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>38003003</PMID>
      <Article>
        <Journal>
          <JournalIssue>
            <Volume>49</Volume>
            <Issue>2</Issue>
            <PubDate><Year>2024</Year></PubDate>
          </JournalIssue>
          <Title>Spine</Title>
        </Journal>
        <ArticleTitle>Exercise Therapy vs Passive Modalities for Chronic Low Back Pain: A Meta-Analysis of 42 Randomized Trials</ArticleTitle>
        <Pagination><MedlinePgn>112-127</MedlinePgn></Pagination>
        <ELocationID EIdType="doi">10.1097/BRS.0000000000004856</ELocationID>
        <Abstract>
          <AbstractText Label="OBJECTIVE">To compare effectiveness of active exercise therapy versus passive treatment modalities for chronic low back pain.</AbstractText>
          <AbstractText Label="RESULTS">Exercise therapy demonstrated significantly greater pain reduction (SMD -0.68, 95% CI -0.85 to -0.51) compared to passive modalities.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author><LastName>Thompson</LastName><Initials>AJ</Initials></Author>
          <Author><LastName>Garcia</LastName><Initials>MR</Initials></Author>
          <Author><LastName>Lee</LastName><Initials>SH</Initials></Author>
          <Author><LastName>Brown</LastName><Initials>KP</Initials></Author>
          <Author><LastName>Wilson</LastName><Initials>JT</Initials></Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType>Meta-Analysis</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

const ROTATOR_CUFF_MOCK_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>38004004</PMID>
      <Article>
        <Journal>
          <JournalIssue>
            <Volume>40</Volume>
            <Issue>1</Issue>
            <PubDate><Year>2024</Year></PubDate>
          </JournalIssue>
          <Title>Arthroscopy</Title>
        </Journal>
        <ArticleTitle>Early vs Delayed Rehabilitation After Arthroscopic Rotator Cuff Repair: A Prospective Clinical Trial</ArticleTitle>
        <Pagination><MedlinePgn>45-58</MedlinePgn></Pagination>
        <ELocationID EIdType="doi">10.1016/j.arthro.2023.09.030</ELocationID>
        <Abstract>
          <AbstractText>This prospective clinical trial enrolled 180 patients undergoing arthroscopic rotator cuff repair to compare early versus standard-delayed rehabilitation initiation.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author><LastName>Anderson</LastName><Initials>BJ</Initials></Author>
          <Author><LastName>Yamamoto</LastName><Initials>KS</Initials></Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType>Clinical Trial</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

describe('ResearchAgent - XML Parsing (Orthopedic Condition Mocks)', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should parse ACL reconstruction mock with 4 authors (triggers et al.)', () => {
    const articles = agent.parseArticleXML(ACL_MOCK_XML);
    expect(articles).toHaveLength(1);
    const a = articles[0];

    expect(a.pmid).toBe('38001001');
    expect(a.title).toContain('ACL Reconstruction');
    expect(a.authors).toBe('Rodriguez M, Chen W, Patel R, et al.');
    expect(a.rawAuthors).toHaveLength(4);
    expect(a.journal).toBe('American Journal of Sports Medicine');
    expect(a.year).toBe('2024');
    expect(a.volume).toBe('52');
    expect(a.issue).toBe('4');
    expect(a.pages).toBe('891-903');
    expect(a.doi).toBe('10.1177/03635465231225678');
    expect(a.pubmedUrl).toBe('https://pubmed.ncbi.nlm.nih.gov/38001001/');
    expect(a.studyType).toBe('Randomized Controlled Trial');
    expect(a.abstract).toContain('BACKGROUND:');
  });

  test('should parse shoulder impingement mock with exactly 3 authors (no et al.)', () => {
    const articles = agent.parseArticleXML(SHOULDER_MOCK_XML);
    expect(articles).toHaveLength(1);
    const a = articles[0];

    expect(a.pmid).toBe('38002002');
    expect(a.title).toContain('Shoulder Impingement');
    expect(a.rawAuthors).toHaveLength(3);
    expect(a.authors).not.toContain('et al.');
    expect(a.authors).toBe('Kim S, Nakamura T, Davis J');
    expect(a.journal).toBe('Journal of Shoulder and Elbow Surgery');
    expect(a.year).toBe('2023');
    expect(a.studyType).toBe('Systematic Review');
    expect(a.doi).toBe('10.1016/j.jse.2023.04.012');
  });

  test('should parse low back pain mock with 5 authors and Meta-Analysis type', () => {
    const articles = agent.parseArticleXML(LBP_MOCK_XML);
    expect(articles).toHaveLength(1);
    const a = articles[0];

    expect(a.pmid).toBe('38003003');
    expect(a.rawAuthors).toHaveLength(5);
    expect(a.authors).toBe('Thompson A, Garcia M, Lee S, et al.');
    expect(a.studyType).toBe('Meta-Analysis');
    expect(a.journal).toBe('Spine');
    expect(a.year).toBe('2024');
    expect(a.doi).toBe('10.1097/BRS.0000000000004856');
  });

  test('should parse rotator cuff repair mock with exactly 2 authors and Clinical Trial type', () => {
    const articles = agent.parseArticleXML(ROTATOR_CUFF_MOCK_XML);
    expect(articles).toHaveLength(1);
    const a = articles[0];

    expect(a.pmid).toBe('38004004');
    expect(a.rawAuthors).toHaveLength(2);
    expect(a.authors).toBe('Anderson B, Yamamoto K');
    expect(a.authors).not.toContain('et al.');
    expect(a.studyType).toBe('Clinical Trial');
    expect(a.journal).toBe('Arthroscopy');
    expect(a.year).toBe('2024');
  });

  test('should construct correct PubMed URL for all 4 orthopedic mocks', () => {
    const expected = [
      [ACL_MOCK_XML,          'https://pubmed.ncbi.nlm.nih.gov/38001001/'],
      [SHOULDER_MOCK_XML,     'https://pubmed.ncbi.nlm.nih.gov/38002002/'],
      [LBP_MOCK_XML,          'https://pubmed.ncbi.nlm.nih.gov/38003003/'],
      [ROTATOR_CUFF_MOCK_XML, 'https://pubmed.ncbi.nlm.nih.gov/38004004/'],
    ];

    for (const [xml, expectedUrl] of expected) {
      const articles = agent.parseArticleXML(xml);
      expect(articles[0].pubmedUrl).toBe(expectedUrl);
    }
  });
});

describe('ResearchAgent - XML Parsing (Multi-Article and Edge Cases)', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should parse multi-article XML response with 3 articles', () => {
    // Build a combined PubmedArticleSet with 3 articles
    const acl     = ACL_MOCK_XML.replace(/<\?xml[^?]*\?>\s*<PubmedArticleSet>/, '').replace(/<\/PubmedArticleSet>\s*$/, '');
    const shoulder = SHOULDER_MOCK_XML.replace(/<\?xml[^?]*\?>\s*<PubmedArticleSet>/, '').replace(/<\/PubmedArticleSet>\s*$/, '');
    const lbp     = LBP_MOCK_XML.replace(/<\?xml[^?]*\?>\s*<PubmedArticleSet>/, '').replace(/<\/PubmedArticleSet>\s*$/, '');
    const multiXml = `<?xml version="1.0" ?><PubmedArticleSet>${acl}${shoulder}${lbp}</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(multiXml);
    expect(articles).toHaveLength(3);

    const pmids = articles.map(a => a.pmid);
    expect(pmids).toContain('38001001');
    expect(pmids).toContain('38002002');
    expect(pmids).toContain('38003003');
  });

  test('should handle article with missing optional fields (no volume, no issue, no pages)', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>39000001</PMID>
      <Article>
        <Journal>
          <JournalIssue>
            <PubDate><Year>2024</Year></PubDate>
          </JournalIssue>
          <Title>Test Journal</Title>
        </Journal>
        <ArticleTitle>Article Without Optional Fields</ArticleTitle>
        <AuthorList>
          <Author><LastName>Doe</LastName><Initials>J</Initials></Author>
        </AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles).toHaveLength(1);
    expect(articles[0].volume).toBe('');
    expect(articles[0].issue).toBe('');
    expect(articles[0].pages).toBe('');
    expect(articles[0].doi).toBe('');
    expect(articles[0].abstract).toBe('');
  });

  test('should extract year from MedlineDate when Year element is absent', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>39000002</PMID>
      <Article>
        <Journal>
          <JournalIssue>
            <PubDate>
              <MedlineDate>2023 Jan-Feb</MedlineDate>
            </PubDate>
          </JournalIssue>
          <Title>Test Journal</Title>
        </Journal>
        <ArticleTitle>Article With MedlineDate</ArticleTitle>
        <AuthorList>
          <Author><LastName>Smith</LastName><Initials>A</Initials></Author>
        </AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles).toHaveLength(1);
    expect(articles[0].year).toBe('2023 Jan-Feb');
    // parseInt('2023 Jan-Feb') = 2023, so quality scoring still works
    expect(parseInt(articles[0].year)).toBe(2023);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Granular Quality Score Verification
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Quality Score Granular Verification', () => {
  let agent;

  // Helper: study with unknown journal + Other type, variable year
  const makeStudy = (year, overrides = {}) => ({
    title: 'Generic Study Title',
    journal: 'Unknown Journal',
    year: String(year),
    studyType: 'Other',
    abstract: '',
    ...overrides,
  });

  beforeEach(() => {
    agent = new ResearchAgent();
    jest.spyOn(agent, 'scoreRelevance').mockReturnValue(5);
  });

  afterEach(() => jest.restoreAllMocks());

  // Recency bonus tests (base 5 + unknown journal 0 + Other 0 + recency)
  test('should give recency bonus of +2 for year 2025 (score = 7)', () => {
    const result = agent.filterByQuality([makeStudy(2025)], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(7);
  });

  test('should give recency bonus of +2 for year 2024 (score = 7)', () => {
    const result = agent.filterByQuality([makeStudy(2024)], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(7);
  });

  test('should give recency bonus of +1.5 for year 2023 (score = 6.5)', () => {
    const result = agent.filterByQuality([makeStudy(2023)], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(6.5);
  });

  test('should give recency bonus of +1 for year 2021 (score = 6)', () => {
    const result = agent.filterByQuality([makeStudy(2021)], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(6);
  });

  test('should give recency bonus of 0 for year 2019 and filter out (score = 5)', () => {
    const result = agent.filterByQuality([makeStudy(2019)], '', 'premium');
    expect(result).toHaveLength(0);
  });

  // Study type bonus tests (base 5 + unknown journal 0 + year 2024 recency +2)
  test('should give study type bonus of +2 for Meta-Analysis (score = 9)', () => {
    const result = agent.filterByQuality([makeStudy(2024, { studyType: 'Meta-Analysis' })], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(9);
  });

  test('should give study type bonus of +1.5 for Systematic Review (score = 8.5)', () => {
    const result = agent.filterByQuality([makeStudy(2024, { studyType: 'Systematic Review' })], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(8.5);
  });

  test('should give study type bonus of +2 for Randomized Controlled Trial (score = 9)', () => {
    const result = agent.filterByQuality([makeStudy(2024, { studyType: 'Randomized Controlled Trial' })], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(9);
  });

  test('should give study type bonus of 0 for Clinical Trial (not in typeScores map, score = 7)', () => {
    // Clinical Trial is classified by classifyStudyType but has no entry in typeScores
    const result = agent.filterByQuality([makeStudy(2024, { studyType: 'Clinical Trial' })], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(7);
  });

  test('should give study type bonus of +1 for Review (score = 8)', () => {
    const result = agent.filterByQuality([makeStudy(2024, { studyType: 'Review' })], '', 'premium');
    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(8);
  });

  test('should use relevanceScore as tiebreaker when qualityScores are equal', () => {
    jest.restoreAllMocks();
    const studies = [
      makeStudy(2024, { title: 'Knee Hip Pain Management Protocols', studyType: 'Review' }),
      makeStudy(2024, { title: 'Knee Reconstruction Outcomes Study', studyType: 'Review' }),
    ];
    // Both: 5 + 0 (unknown journal) + 1 (Review) + 2 (2024) = 8
    const result = agent.filterByQuality(studies, 'knee reconstruction outcomes', 'premium');
    expect(result).toHaveLength(2);
    expect(result[0].qualityScore).toBe(result[1].qualityScore);
    expect(result[0].title).toContain('Knee Reconstruction');
    expect(result[0].relevanceScore).toBeGreaterThan(result[1].relevanceScore);
  });

  test('should include both qualityScore and relevanceScore in every output item', () => {
    const studies = [makeStudy(2024, { studyType: 'RCT' }), makeStudy(2023)];
    const result = agent.filterByQuality(studies, 'knee', 'premium');
    for (const item of result) {
      expect(typeof item.qualityScore).toBe('number');
      expect(typeof item.relevanceScore).toBe('number');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Citation Formatting for Orthopedic Conditions
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Citation Formatting (Orthopedic Conditions)', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  test('should produce complete ACL reconstruction citation with all 14 fields', () => {
    const articles = agent.parseArticleXML(ACL_MOCK_XML);
    const citation = articles[0];

    const requiredFields = [
      'pmid', 'title', 'authors', 'rawAuthors', 'journal', 'year',
      'volume', 'issue', 'pages', 'doi', 'pubmedUrl',
      'abstract', 'studyType', 'qualityScore', 'relevanceScore',
    ];
    for (const field of requiredFields) {
      expect(citation).toHaveProperty(field);
    }

    expect(citation.pmid).toBe('38001001');
    expect(citation.title).toContain('ACL Reconstruction');
    expect(citation.authors).toContain('et al.');
    expect(citation.journal).toBe('American Journal of Sports Medicine');
    expect(citation.year).toBe('2024');
    expect(citation.volume).toBe('52');
    expect(citation.issue).toBe('4');
    expect(citation.pages).toBe('891-903');
    expect(citation.doi).toBeTruthy();
    expect(citation.pubmedUrl).toBe('https://pubmed.ncbi.nlm.nih.gov/38001001/');
    expect(citation.studyType).toBe('Randomized Controlled Trial');
    expect(citation.abstract).toBeTruthy();
    expect(citation.qualityScore).toBe(0);     // before filterByQuality
    expect(citation.relevanceScore).toBe(0);   // before filterByQuality
  });

  test('should produce complete shoulder impingement citation with all 14 fields', () => {
    const articles = agent.parseArticleXML(SHOULDER_MOCK_XML);
    const citation = articles[0];

    expect(citation.pmid).toBe('38002002');
    expect(citation.title).toContain('Shoulder Impingement');
    expect(citation.authors).toBe('Kim S, Nakamura T, Davis J');
    expect(citation.journal).toBe('Journal of Shoulder and Elbow Surgery');
    expect(citation.year).toBe('2023');
    expect(citation.volume).toBe('32');
    expect(citation.issue).toBe('8');
    expect(citation.pages).toBe('1645-1658');
    expect(citation.studyType).toBe('Systematic Review');
    expect(citation.pubmedUrl).toBe('https://pubmed.ncbi.nlm.nih.gov/38002002/');
  });

  test('should format PubMed URL correctly for all 4 orthopedic condition mocks', () => {
    const cases = [
      [ACL_MOCK_XML,          '38001001'],
      [SHOULDER_MOCK_XML,     '38002002'],
      [LBP_MOCK_XML,          '38003003'],
      [ROTATOR_CUFF_MOCK_XML, '38004004'],
    ];

    for (const [xml, pmid] of cases) {
      const articles = agent.parseArticleXML(xml);
      expect(articles[0].pubmedUrl).toBe(`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`);
    }
  });

  test('should format exactly 2 authors without et al.', () => {
    const articles = agent.parseArticleXML(ROTATOR_CUFF_MOCK_XML);
    expect(articles[0].rawAuthors).toHaveLength(2);
    expect(articles[0].authors).toBe('Anderson B, Yamamoto K');
    expect(articles[0].authors).not.toContain('et al.');
  });

  test('should format exactly 1 author without comma or et al.', () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>39000010</PMID>
      <Article>
        <Journal>
          <JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue>
          <Title>Test Journal</Title>
        </Journal>
        <ArticleTitle>Single Author Article</ArticleTitle>
        <AuthorList>
          <Author><LastName>Smith</LastName><Initials>JA</Initials></Author>
        </AuthorList>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = agent.parseArticleXML(xml);
    expect(articles[0].rawAuthors).toHaveLength(1);
    expect(articles[0].authors).toBe('Smith J');
    expect(articles[0].authors).not.toContain(',');
    expect(articles[0].authors).not.toContain('et al.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Error Handling
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - Error Handling', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should return success:true with empty citations when searchPubMed returns []', async () => {
    jest.spyOn(agent, 'searchPubMed').mockResolvedValue([]);
    const result = await agent.curateRelevantStudies('knee pain');

    expect(result.success).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.totalFound).toBe(0);
    expect(typeof result.intro).toBe('string');
    expect(result.intro.length).toBeGreaterThan(0);
    expect(result.tier).toBe('basic');
  });

  test('should return success:false when searchPubMed throws', async () => {
    jest.spyOn(agent, 'searchPubMed').mockRejectedValue(new Error('Network timeout'));
    const result = await agent.curateRelevantStudies('knee pain');

    expect(result.success).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.error).toBe('Network timeout');
  });

  test('should include all expected keys in error response', async () => {
    jest.spyOn(agent, 'searchPubMed').mockRejectedValue(new Error('API failure'));
    const result = await agent.curateRelevantStudies('shoulder impingement');

    const expectedKeys = ['success', 'citations', 'intro', 'searchQuery', 'totalFound', 'tier', 'responseTime', 'error'];
    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }
  });

  test('should set searchQuery to empty string in error response', async () => {
    jest.spyOn(agent, 'searchPubMed').mockRejectedValue(new Error('Timeout'));
    const result = await agent.curateRelevantStudies('low back pain');

    expect(result.searchQuery).toBe('');
  });

  test('should return descriptive intro containing "Unable to retrieve" on error', async () => {
    jest.spyOn(agent, 'searchPubMed').mockRejectedValue(new Error('Connection refused'));
    const result = await agent.curateRelevantStudies('hip pain');

    expect(result.intro).toContain('Unable to retrieve');
  });

  test('should return fallback string from generateResearchIntro when citations array is empty', async () => {
    const intro = await agent.generateResearchIntro([], 'knee pain');
    expect(intro).toBe('No relevant studies were found matching the clinical query.');
  });

  test('should return 0 from scoreRelevance when title is undefined', () => {
    expect(agent.scoreRelevance(undefined, 'knee pain')).toBe(0);
  });

  test('should return 0 from scoreRelevance when title is null', () => {
    expect(agent.scoreRelevance(null, 'knee pain')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: End-to-End curateRelevantStudies
// ─────────────────────────────────────────────────────────────────────────────

describe('ResearchAgent - End-to-End curateRelevantStudies', () => {
  let agent;

  // Pre-built study objects matching parseArticleXML output shape (score: 5+3+2+2=12→10)
  const makeMockStudies = (count) =>
    Array.from({ length: count }, (_, i) => ({
      pmid: String(30000000 + i),
      title: `Knee Reconstruction Outcomes Study ${i + 1}`,
      authors: `Author${i} A`,
      rawAuthors: [`Author${i} AA`],
      journal: 'American Journal of Sports Medicine',  // tier1 → +3
      year: '2024',                                    // recency → +2
      volume: String(52 + i),
      issue: String(i + 1),
      pages: `${i * 10 + 1}-${i * 10 + 10}`,
      doi: `10.1177/0000000000000${i}`,
      pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${30000000 + i}/`,
      abstract: `Study abstract for article ${i + 1} on knee reconstruction.`,
      studyType: 'Randomized Controlled Trial',        // RCT → +2
      qualityScore: 0,
      relevanceScore: 0,
    }));

  beforeEach(() => {
    agent = new ResearchAgent();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should return max 3 citations for basic tier', async () => {
    const mockStudies = makeMockStudies(6);
    jest.spyOn(agent, 'searchPubMed').mockResolvedValue(mockStudies.map(s => s.pmid));
    jest.spyOn(agent, 'fetchArticleDetails').mockResolvedValue(mockStudies);

    const result = await agent.curateRelevantStudies('knee reconstruction', 'basic');

    expect(result.success).toBe(true);
    expect(result.citations.length).toBeLessThanOrEqual(3);
    expect(result.tier).toBe('basic');
  });

  test('should return max 5 citations for premium tier', async () => {
    const mockStudies = makeMockStudies(8);
    jest.spyOn(agent, 'searchPubMed').mockResolvedValue(mockStudies.map(s => s.pmid));
    jest.spyOn(agent, 'fetchArticleDetails').mockResolvedValue(mockStudies);

    const result = await agent.curateRelevantStudies('knee reconstruction', 'premium');

    expect(result.success).toBe(true);
    expect(result.citations.length).toBeLessThanOrEqual(5);
    expect(result.tier).toBe('premium');
  });

  test('should update researchHistory after successful curation', async () => {
    expect(agent.researchHistory).toHaveLength(0);

    const mockStudies = makeMockStudies(3);
    jest.spyOn(agent, 'searchPubMed').mockResolvedValue(mockStudies.map(s => s.pmid));
    jest.spyOn(agent, 'fetchArticleDetails').mockResolvedValue(mockStudies);

    await agent.curateRelevantStudies('knee pain', 'basic');

    expect(agent.researchHistory).toHaveLength(1);
    const record = agent.researchHistory[0];
    expect(record).toHaveProperty('query');
    expect(record).toHaveProperty('searchQuery');
    expect(record).toHaveProperty('totalFound');
    expect(record).toHaveProperty('citationsReturned');
    expect(record).toHaveProperty('tier');
    expect(record).toHaveProperty('responseTime');
    expect(record).toHaveProperty('timestamp');
  });

  test('should return correct tier, searchQuery, and totalFound in response', async () => {
    const mockStudies = makeMockStudies(3);
    jest.spyOn(agent, 'searchPubMed').mockResolvedValue(mockStudies.map(s => s.pmid));
    jest.spyOn(agent, 'fetchArticleDetails').mockResolvedValue(mockStudies);

    const result = await agent.curateRelevantStudies('shoulder pain', 'premium');

    expect(result.tier).toBe('premium');
    expect(result.totalFound).toBe(3);
    expect(typeof result.searchQuery).toBe('string');
    expect(result.searchQuery.length).toBeGreaterThan(0);
    expect(result.searchQuery).toContain('shoulder');
  });

  test('should include responseTime as a non-negative number', async () => {
    const mockStudies = makeMockStudies(2);
    jest.spyOn(agent, 'searchPubMed').mockResolvedValue(mockStudies.map(s => s.pmid));
    jest.spyOn(agent, 'fetchArticleDetails').mockResolvedValue(mockStudies);

    const result = await agent.curateRelevantStudies('ankle sprain', 'basic');

    expect(typeof result.responseTime).toBe('number');
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  test('should return non-empty intro string for successful results', async () => {
    const mockStudies = makeMockStudies(3);
    jest.spyOn(agent, 'searchPubMed').mockResolvedValue(mockStudies.map(s => s.pmid));
    jest.spyOn(agent, 'fetchArticleDetails').mockResolvedValue(mockStudies);

    const result = await agent.curateRelevantStudies('rotator cuff tear', 'basic');

    expect(typeof result.intro).toBe('string');
    expect(result.intro.length).toBeGreaterThan(0);
  });
});
