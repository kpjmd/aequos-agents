import { BaseAgent } from './base-agent.js';
import { XMLParser } from 'fast-xml-parser';
import { agentConfig } from '../config/agent-config.js';
import logger from '../utils/logger.js';

export class ResearchAgent extends BaseAgent {
  constructor(name = 'Research Pioneer', accountManager = null) {
    super(name, 'medical literature research and evidence curation', accountManager, 'researchPioneer');
    this.agentType = 'research_pioneer';

    // PubMed API configuration
    this.pubmedBaseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    this.pubmedApiKey = agentConfig.pubmed?.apiKey || null;
    this.requestTimeout = agentConfig.pubmed?.requestTimeout || 15000;
    this.maxResults = agentConfig.pubmed?.maxResults || 20;

    // XML parser for PubMed responses
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      isArray: (name) => ['PubmedArticle', 'Author', 'PublicationType', 'AbstractText', 'ELocationID', 'ArticleId'].includes(name),
    });

    // Journal quality tiers
    this.journalTiers = this.initializeJournalTiers();

    // Research tracking
    this.researchHistory = [];
    this.searchCache = new Map();
  }

  initializeJournalTiers() {
    return {
      // Tier 1: Top orthopedic and general medical journals (score: 3)
      tier1: {
        score: 3,
        journals: [
          'journal of bone and joint surgery',
          'jbjs',
          'american journal of sports medicine',
          'ajsm',
          'new england journal of medicine',
          'nejm',
          'jama',
          'lancet',
          'bmj',
          'arthroscopy',
        ],
      },
      // Tier 2: Strong specialty journals (score: 2)
      tier2: {
        score: 2,
        journals: [
          'clinical orthopaedics and related research',
          'knee surgery sports traumatology arthroscopy',
          'kssta',
          'journal of shoulder and elbow surgery',
          'jses',
          'foot and ankle international',
          'bone and joint journal',
          'journal of arthroplasty',
          'spine',
        ],
      },
      // Tier 3: Rehabilitation and musculoskeletal journals (score: 1)
      tier3: {
        score: 1,
        journals: [
          'archives of physical medicine and rehabilitation',
          'physical therapy',
          'journal of orthopaedic and sports physical therapy',
          'jospt',
          'bmc musculoskeletal disorders',
          'european spine journal',
        ],
      },
    };
  }

  getSystemPrompt() {
    return `You are ${this.name}, a medical literature research specialist in the OrthoIQ recovery ecosystem.

Your role is to curate and summarize relevant medical literature to support evidence-based orthopedic care.

Experience level: ${this.experience} points
Token balance: ${this.tokenBalance}

Guidelines:
- Summarize research findings in patient-friendly language (8th grade reading level)
- Always cite specific studies with authors, journal, and year
- Distinguish between strong evidence (RCTs, meta-analyses) and weaker evidence (case reports, reviews)
- Be honest about limitations and conflicting evidence
- Focus on clinically actionable findings relevant to the patient's condition
- Never overstate conclusions beyond what the evidence supports
- Present both surgical and conservative treatment evidence when applicable`;
  }

  async curateRelevantStudies(clinicalQuery, tier = 'basic') {
    const startTime = Date.now();

    try {
      logger.info(`Research agent curating studies for: ${JSON.stringify(clinicalQuery).substring(0, 100)}`);

      // Build optimized PubMed query
      const searchQuery = this.buildPubMedQuery(clinicalQuery);
      logger.info(`PubMed search query: ${searchQuery}`);

      // Search PubMed for relevant PMIDs
      const pmids = await this.searchPubMed(searchQuery);

      if (!pmids || pmids.length === 0) {
        logger.info('No PubMed results found');
        return {
          success: true,
          citations: [],
          intro: 'No relevant studies were found for this specific query. This may indicate a gap in the current literature or that the search terms need refinement.',
          searchQuery,
          totalFound: 0,
          tier,
          responseTime: Date.now() - startTime,
        };
      }

      // Fetch article details
      const articles = await this.fetchArticleDetails(pmids);

      // Filter, score, and limit by quality
      const citations = this.filterByQuality(articles, clinicalQuery, tier);

      // Generate research intro summary
      const intro = await this.generateResearchIntro(citations, clinicalQuery);

      // Track research history
      const researchRecord = {
        query: clinicalQuery,
        searchQuery,
        totalFound: pmids.length,
        citationsReturned: citations.length,
        tier,
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
      this.researchHistory.push(researchRecord);

      logger.info(`Research complete: ${citations.length} citations curated from ${pmids.length} results`);

      return {
        success: true,
        citations,
        intro,
        searchQuery,
        totalFound: pmids.length,
        tier,
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      logger.error(`Research curation failed: ${error.message}`);
      return {
        success: false,
        citations: [],
        intro: 'Unable to retrieve research literature at this time. Please consult your healthcare provider for evidence-based recommendations.',
        searchQuery: '',
        totalFound: 0,
        tier,
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  buildPubMedQuery(clinicalQuery) {
    let queryText = '';

    // Extract relevant text from clinical query object or string
    if (typeof clinicalQuery === 'string') {
      queryText = clinicalQuery;
    } else {
      const parts = [];
      if (clinicalQuery.primaryComplaint) parts.push(clinicalQuery.primaryComplaint);
      if (clinicalQuery.symptoms) parts.push(clinicalQuery.symptoms);
      if (clinicalQuery.diagnosis) parts.push(clinicalQuery.diagnosis);
      if (clinicalQuery.procedure) parts.push(clinicalQuery.procedure);
      queryText = parts.join(' ');
    }

    // Normalize
    queryText = queryText.toLowerCase().trim();

    // Expand common orthopedic abbreviations
    const abbreviations = {
      'acl': 'anterior cruciate ligament',
      'pcl': 'posterior cruciate ligament',
      'mcl': 'medial collateral ligament',
      'lcl': 'lateral collateral ligament',
      'tka': 'total knee arthroplasty',
      'tha': 'total hip arthroplasty',
      'thr': 'total hip replacement',
      'tkr': 'total knee replacement',
      'rom': 'range of motion',
      'cts': 'carpal tunnel syndrome',
      'lbp': 'low back pain',
      'ohss': 'overhead shoulder syndrome',
      'slap': 'superior labrum anterior posterior',
      'rct': 'rotator cuff tear',
    };

    for (const [abbr, expanded] of Object.entries(abbreviations)) {
      // Match whole word boundaries
      const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
      if (regex.test(queryText)) {
        queryText = queryText.replace(regex, expanded);
      }
    }

    // Add PubMed filters
    const filters = [];
    filters.push(`(${queryText})`);
    filters.push('("2020"[Date - Publication] : "2025"[Date - Publication])');
    filters.push('(Meta-Analysis[pt] OR Systematic Review[pt] OR Randomized Controlled Trial[pt] OR Clinical Trial[pt] OR Review[pt])');
    filters.push('English[la]');
    filters.push('Humans[MeSH]');

    return filters.join(' AND ');
  }

  async searchPubMed(query) {
    try {
      const params = new URLSearchParams({
        db: 'pubmed',
        term: query,
        retmax: String(this.maxResults),
        retmode: 'json',
        sort: 'relevance',
      });

      if (this.pubmedApiKey) {
        params.set('api_key', this.pubmedApiKey);
      }

      const url = `${this.pubmedBaseUrl}/esearch.fcgi?${params.toString()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`PubMed search failed: ${response.status}`);
        }

        const data = await response.json();
        return data.esearchresult?.idlist || [];
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.warn('PubMed search timed out');
      } else {
        logger.error(`PubMed search error: ${error.message}`);
      }
      return [];
    }
  }

  async fetchArticleDetails(pmids) {
    if (!pmids || pmids.length === 0) return [];

    try {
      const params = new URLSearchParams({
        db: 'pubmed',
        id: pmids.join(','),
        retmode: 'xml',
        rettype: 'abstract',
      });

      if (this.pubmedApiKey) {
        params.set('api_key', this.pubmedApiKey);
      }

      const url = `${this.pubmedBaseUrl}/efetch.fcgi?${params.toString()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`PubMed fetch failed: ${response.status}`);
        }

        const xmlData = await response.text();
        return this.parseArticleXML(xmlData);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.warn('PubMed article fetch timed out');
      } else {
        logger.error(`PubMed article fetch error: ${error.message}`);
      }
      return [];
    }
  }

  parseArticleXML(xmlData) {
    try {
      const parsed = this.xmlParser.parse(xmlData);
      const articles = parsed?.PubmedArticleSet?.PubmedArticle;

      if (!articles) return [];

      const articleArray = Array.isArray(articles) ? articles : [articles];

      return articleArray.map(article => {
        const medlineCitation = article.MedlineCitation;
        const articleData = medlineCitation?.Article;

        if (!articleData) return null;

        // Extract PMID
        const pmid = medlineCitation.PMID?.['#text'] || medlineCitation.PMID || '';

        // Extract title
        const title = articleData.ArticleTitle?.['#text'] || articleData.ArticleTitle || '';

        // Required-field validation: skip articles missing PMID or title
        const pmidStr = String(pmid).trim();
        const titleStr = String(title).trim();
        if (!pmidStr || !titleStr) return null;

        // Extract authors
        const authorList = articleData.AuthorList?.Author;
        const { formatted: authors, raw: rawAuthors } = this.extractAuthors(authorList);

        // Extract journal info
        const journal = articleData.Journal;
        const journalTitle = journal?.Title || journal?.ISOAbbreviation || '';
        const journalIssue = journal?.JournalIssue;
        const year = journalIssue?.PubDate?.Year || journalIssue?.PubDate?.MedlineDate || '';
        const volume = journalIssue?.Volume || '';
        const issue = journalIssue?.Issue || '';

        // Extract pagination
        const pages = articleData.Pagination?.MedlinePgn || '';

        // Extract DOI from ELocationID
        const elocationIds = articleData.ELocationID;
        let doi = '';
        if (Array.isArray(elocationIds)) {
          const doiEntry = elocationIds.find(e => e['@_EIdType'] === 'doi');
          doi = doiEntry?.['#text'] || '';
        } else if (elocationIds?.['@_EIdType'] === 'doi') {
          doi = elocationIds['#text'] || '';
        }

        // DOI fallback: check PubmedData.ArticleIdList
        if (!doi) {
          const articleIds = article.PubmedData?.ArticleIdList?.ArticleId;
          if (articleIds) {
            const ids = Array.isArray(articleIds) ? articleIds : [articleIds];
            const doiEntry = ids.find(e => e['@_IdType'] === 'doi');
            doi = doiEntry?.['#text'] || '';
          }
        }

        // Extract abstract
        const abstractText = this.extractAbstractText(articleData.Abstract?.AbstractText);

        // Extract study type from publication types (check Article then MedlineCitation)
        const pubTypes = articleData.PublicationTypeList?.PublicationType
            || medlineCitation.PublicationTypeList?.PublicationType;
        const studyType = this.classifyStudyType(pubTypes);

        return {
          pmid: pmidStr,
          title: titleStr,
          authors,
          rawAuthors,
          journal: String(journalTitle),
          year: String(year),
          volume: String(volume),
          issue: String(issue),
          pages: String(pages),
          doi: String(doi),
          pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmidStr}/`,
          abstract: abstractText,
          studyType,
          qualityScore: 0,
          relevanceScore: 0,
        };
      }).filter(Boolean);
    } catch (error) {
      logger.error(`XML parsing error: ${error.message}`);
      return [];
    }
  }

  extractAuthors(authorList) {
    if (!authorList) return { formatted: '', raw: [] };
    const authors = Array.isArray(authorList) ? authorList : [authorList];
    const raw = authors
      .map(author => {
        if (author.CollectiveName) return author.CollectiveName;
        const lastName = author.LastName || '';
        if (!lastName) return '';
        const initials = author.Initials
          || (author.ForeName ? author.ForeName.split(/\s+/).map(w => w[0]).join('') : '');
        return initials ? `${lastName} ${initials}` : lastName;
      })
      .filter(Boolean);

    // Formatted: max 3 authors, single first initial, ", et al." if >3
    // Only abbreviate when the second token looks like initials (all-uppercase letters)
    const display = raw.slice(0, 3).map(name => {
      const parts = name.split(' ');
      if (parts.length < 2) return name; // lastName-only
      const secondToken = parts[1];
      if (/^[A-Z]+$/.test(secondToken)) {
        // "Smith JA" → "Smith J"
        return `${parts[0]} ${secondToken[0]}`;
      }
      // CollectiveName like "WHO Research Group" or "OARSI Group" — return as-is
      return name;
    });
    const formatted = display.join(', ') + (raw.length > 3 ? ', et al.' : '');

    return { formatted, raw };
  }

  classifyStudyType(pubTypeNames) {
    if (!pubTypeNames) return 'Other';

    const types = Array.isArray(pubTypeNames) ? pubTypeNames : [pubTypeNames];
    const typeStrings = types.map(t => {
      const text = t?.['#text'] || t || '';
      return String(text).toLowerCase();
    });

    // Priority order: Meta-Analysis > Systematic Review > RCT > Clinical Trial > Review > Other
    if (typeStrings.some(t => t.includes('meta-analysis'))) return 'Meta-Analysis';
    if (typeStrings.some(t => t.includes('systematic review'))) return 'Systematic Review';
    if (typeStrings.some(t => t.includes('randomized controlled trial'))) return 'Randomized Controlled Trial';
    if (typeStrings.some(t => t.includes('clinical trial'))) return 'Clinical Trial';
    if (typeStrings.some(t => t.includes('review'))) return 'Review';

    return 'Other';
  }

  extractAbstractText(abstractText) {
    if (!abstractText) return '';

    // Handle string
    if (typeof abstractText === 'string') return abstractText;

    // Handle array (structured abstract with labels)
    if (Array.isArray(abstractText)) {
      return abstractText
        .map(section => {
          const label = section['@_Label'] || '';
          const text = section['#text'] || section || '';
          return label ? `${label}: ${text}` : String(text);
        })
        .join(' ');
    }

    // Handle object (single section)
    if (typeof abstractText === 'object') {
      return abstractText['#text'] || JSON.stringify(abstractText);
    }

    return String(abstractText);
  }

  filterByQuality(studies, clinicalQuery = '', tier = 'basic') {
    const scored = studies.map(study => {
      // Base score
      let score = 5;

      // Journal reputation (0-3)
      score += this.getJournalTierScore(study.journal);

      // Study type (0-2)
      const typeScores = {
        'Randomized Controlled Trial': 2,
        'Meta-Analysis': 2,
        'Systematic Review': 1.5,
        'Review': 1,
      };
      score += typeScores[study.studyType] || 0;

      // Recency (0-2)
      const year = parseInt(study.year);
      if (!isNaN(year)) {
        if (year >= 2024) score += 2;
        else if (year === 2023) score += 1.5;
        else if (year >= 2020) score += 1;
      }

      // Cap at 10
      const qualityScore = Math.min(score, 10);

      // Relevance scoring
      const relevanceScore = this.scoreRelevance(study.title, clinicalQuery);

      return { ...study, qualityScore, relevanceScore };
    });

    // Filter, sort, and limit
    const maxCitations = tier === 'premium' ? 5 : 3;
    return scored
      .filter(s => s.qualityScore >= 6)
      .sort((a, b) => b.qualityScore - a.qualityScore || b.relevanceScore - a.relevanceScore)
      .slice(0, maxCitations);
  }

  getJournalTierScore(journalName) {
    if (!journalName) return 0;

    const normalized = journalName.toLowerCase();

    for (const tier of Object.values(this.journalTiers)) {
      if (tier.journals.some(j => normalized.includes(j))) {
        return tier.score;
      }
    }

    return 0;
  }

  scoreRelevance(title, clinicalQuery) {
    if (!title || !clinicalQuery) return 0;

    // Extract query text
    let queryText = '';
    if (typeof clinicalQuery === 'string') {
      queryText = clinicalQuery;
    } else {
      const parts = [];
      if (clinicalQuery.primaryComplaint) parts.push(clinicalQuery.primaryComplaint);
      if (clinicalQuery.symptoms) parts.push(clinicalQuery.symptoms);
      if (clinicalQuery.diagnosis) parts.push(clinicalQuery.diagnosis);
      if (clinicalQuery.procedure) parts.push(clinicalQuery.procedure);
      queryText = parts.join(' ');
    }

    if (!queryText) return 0;

    const stopWords = new Set(['the','a','an','and','or','of','in','to','for','with','is','on','at','by','from']);
    const queryTerms = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    if (queryTerms.length === 0) return 0;

    const titleLower = title.toLowerCase();
    const matches = queryTerms.filter(term => titleLower.includes(term)).length;

    return Math.min(Math.round((matches / queryTerms.length) * 10), 10);
  }

  async generateResearchIntro(studies, clinicalQuery) {
    if (!studies || studies.length === 0) {
      return 'No relevant studies were found matching the clinical query.';
    }

    try {
      const studySummaries = studies.map(s =>
        `- "${s.title}" (${s.journal}, ${s.year}) - ${s.studyType}`
      ).join('\n');

      const queryDescription = typeof clinicalQuery === 'string'
        ? clinicalQuery
        : JSON.stringify(clinicalQuery);

      const prompt = `Based on these studies found for a patient with: ${queryDescription}

Studies:
${studySummaries}

Write a 2-3 paragraph patient-friendly summary (8th grade reading level) of what the current research says about this condition. Be specific about what the evidence shows. Do not use medical jargon without explanation.`;

      const intro = await this.processMessage(prompt);
      return typeof intro === 'string' ? intro : String(intro);
    } catch (error) {
      logger.warn(`Failed to generate research intro: ${error.message}`);
      return `We found ${studies.length} relevant ${studies.length === 1 ? 'study' : 'studies'} related to your condition. Please review the citations below for the latest evidence-based recommendations.`;
    }
  }

  getResearchStatistics() {
    const totalSearches = this.researchHistory.length;
    const totalCitations = this.researchHistory.reduce(
      (sum, r) => sum + r.citationsReturned, 0
    );
    const avgResponseTime = totalSearches > 0
      ? Math.round(this.researchHistory.reduce((sum, r) => sum + r.responseTime, 0) / totalSearches)
      : 0;

    return {
      totalSearches,
      totalCitations,
      avgResponseTime,
      tokenBalance: this.tokenBalance,
    };
  }
}

export default ResearchAgent;
