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

Your role is to curate and present medical literature evidence to support evidence-based orthopedic care decisions, tailored to each patient's context.

Experience level: ${this.experience} points
Token balance: ${this.tokenBalance}

## Evidence Hierarchy & Grading

Assign a grade to each citation based on study design and quality:

| Grade | Evidence Level | Study Types |
|-------|---------------|-------------|
| A | Level 1–2, population-matched | Systematic reviews, meta-analyses, high-quality RCTs |
| B | Level 2–3, or Level 1–2 with population mismatch | Lower-quality RCTs, prospective cohort, case-control studies |
| C | Level 4–5 | Retrospective studies, case series, narrative reviews, expert opinion |
| X | Conflicts guidelines or flagged concern | Studies contradicting AAOS/AOSSM/APTA guidelines; note why |

Do not mix evidence levels without flagging it. If presenting both Level 1 and Level 4 evidence together, state explicitly why the lower-level evidence is included.

## Population Relevance Filters

Flag mismatches between study population and patient context:
- **Age brackets**: Pediatric (<18) — adult studies are NOT applicable; Young adult (18–35); Middle-aged (35–55); Older adult (55+) — flag if a study excluded patients >65
- **Activity level**: Competitive vs. recreational vs. sedentary — flag when study population differs meaningfully
- **Treatment type**: If the question is about conservative management but most evidence is surgical, state: "Note: The majority of high-quality evidence for this condition is surgical. Conservative management evidence is limited."
- **Anatomical specificity**: Confirm the study matches the specific structure in question (e.g., medial vs. lateral meniscus, ACL vs. PCL)

## Key Guideline Sources (Static Reference)

Cross-reference findings against these guidelines. Note alignment or conflict explicitly:
- **AAOS** (American Academy of Orthopaedic Surgeons) — surgical indications, implant selection, rehab timelines
- **AOSSM** (American Orthopaedic Society for Sports Medicine) — return-to-sport criteria, overuse injuries, biologics
- **APTA** (American Physical Therapy Association) — conservative management and PT protocols
- **NICE / Cochrane** — systematic reviews for conservative MSK management

If a citation contradicts current guidelines → assign Grade X and explain the discrepancy.
If guidelines are silent on the specific question → note this as a gap in Evidence Gaps section.

## Emerging Topic Flags

Apply these notes in the Evidence Gaps section when relevant:
- **Biologics** (PRP, stem cells, exosomes): Always note current FDA regulatory status. PRP evidence is protocol-dependent (leukocyte-rich vs. leukocyte-poor produce different outcomes). Exosomes are largely preclinical as of 2025–2026.
- **Return-to-sport (RTS)**: Time-based criteria alone are insufficient — note whether study RTS criteria are time-based or functional/criteria-based.
- **Techniques <5 years old**: Flag limited long-term follow-up data; note learning curve effects if reported.
- **Conflicting studies**: Present both; note conflict may reflect patient selection or outcome measure differences — do not adjudicate.

## Core Standards

- Present findings in plain language (8th-grade reading level)
- Always cite specific studies with authors, journal, year, and PubMed ID
- Never overstate conclusions beyond what the evidence supports
- Be honest about limitations and conflicting evidence
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
      let pmids = await this.searchPubMed(searchQuery);

      // Fallback: if no results with strict query, retry without study-type filter
      if (!pmids || pmids.length === 0) {
        logger.info('No PubMed results with structured query — retrying with broader search');
        const broaderQuery = this.buildBroaderQuery(clinicalQuery);
        logger.info(`Broader PubMed query: ${broaderQuery}`);
        pmids = await this.searchPubMed(broaderQuery);
      }

      if (!pmids || pmids.length === 0) {
        logger.info('No PubMed results found after fallback search');
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
      let citations = this.filterByQuality(articles, clinicalQuery, tier);

      // Post-quality-filter fallback: if PMIDs were found but none survived
      // quality filtering, retry with a broader (OR-joined) query
      if (citations.length === 0 && pmids.length > 0) {
        logger.info(`0 citations survived quality filter from ${pmids.length} results — retrying with broader query`);
        const broaderQuery = this.buildBroaderQuery(clinicalQuery);
        logger.info(`Broader PubMed query: ${broaderQuery}`);
        const broaderPmids = await this.searchPubMed(broaderQuery);
        if (broaderPmids && broaderPmids.length > 0) {
          const broaderArticles = await this.fetchArticleDetails(broaderPmids);
          const broaderCitations = this.filterByQuality(broaderArticles, clinicalQuery, tier);
          if (broaderCitations.length > 0) {
            citations = broaderCitations;
          }
        }
      }

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
      // Wrist / hand
      'tfcc': 'triangular fibrocartilage complex',
      'druj': 'distal radioulnar joint',
      // Shoulder
      'rsa': 'reverse shoulder arthroplasty',
      'tsa': 'total shoulder arthroplasty',
      // Spine
      'ivd': 'intervertebral disc',
      'ddd': 'degenerative disc disease',
      // Ankle / foot
      'atfl': 'anterior talofibular ligament',
      'cfl': 'calcaneofibular ligament',
      // Hip
      'fai': 'femoroacetabular impingement',
      // General
      'oa': 'osteoarthritis',
      'ra': 'rheumatoid arthritis',
      'nsaid': 'nonsteroidal anti-inflammatory',
      'orif': 'open reduction internal fixation',
    };

    for (const [abbr, expanded] of Object.entries(abbreviations)) {
      // Match whole word boundaries
      const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
      if (regex.test(queryText)) {
        queryText = queryText.replace(regex, expanded);
      }
    }

    // Extract focused clinical terms instead of sending raw natural language to PubMed
    const clinicalTerms = this.extractClinicalTerms(queryText, clinicalQuery);

    // Build structured PubMed query
    const filters = [];

    if (clinicalTerms.length > 0) {
      filters.push(`(${clinicalTerms.join(' AND ')})`);
    } else {
      // Fallback: try structured bodyPart/location before using raw text
      const structuredBodyPart =
        typeof clinicalQuery === 'object'
          ? (clinicalQuery.bodyPart || clinicalQuery.location || '').toLowerCase().trim()
          : '';
      if (structuredBodyPart) {
        filters.push(`(${structuredBodyPart})`);
      } else {
        // Last resort: raw text — truncated to first 8 words to avoid over-constraining PubMed
        const shortFallback = queryText.split(' ').slice(0, 8).join(' ');
        filters.push(`(${shortFallback})`);
      }
    }

    // Note: no MeSH scope filter here — clinical terms already ensure orthopedic focus,
    // and the scope filter combined with date+studytype filters was too restrictive (0 results).
    // The relevance scoring in filterByQuality catches any stray off-topic results.
    filters.push('("2020"[Date - Publication] : "2025"[Date - Publication])');
    filters.push('(Meta-Analysis[pt] OR Systematic Review[pt] OR Randomized Controlled Trial[pt] OR Clinical Trial[pt] OR Review[pt])');
    filters.push('English[la]');
    filters.push('Humans[MeSH]');

    return filters.join(' AND ');
  }

  /**
   * Broader fallback query — drops study-type filter to cast a wider net.
   * Used when the primary query returns 0 results.
   */
  buildBroaderQuery(clinicalQuery) {
    let queryText = '';
    if (typeof clinicalQuery === 'string') {
      queryText = clinicalQuery;
    } else {
      const parts = [];
      if (clinicalQuery.primaryComplaint) parts.push(clinicalQuery.primaryComplaint);
      if (clinicalQuery.symptoms && clinicalQuery.symptoms !== clinicalQuery.primaryComplaint) parts.push(clinicalQuery.symptoms);
      queryText = parts.join(' ');
    }
    queryText = queryText.toLowerCase().trim();

    const clinicalTerms = this.extractClinicalTerms(queryText, clinicalQuery);
    let termClause;
    if (clinicalTerms.length > 0) {
      termClause = `(${clinicalTerms.join(' OR ')})`;
    } else {
      const structuredBodyPart =
        typeof clinicalQuery === 'object'
          ? (clinicalQuery.bodyPart || clinicalQuery.location || '').toLowerCase().trim()
          : '';
      if (structuredBodyPart) {
        termClause = `(${structuredBodyPart})`;
      } else {
        const shortFallback = queryText.split(' ').slice(0, 8).join(' ');
        termClause = `(${shortFallback})`;
      }
    }

    return [
      termClause,
      '("2018"[Date - Publication] : "2025"[Date - Publication])',
      'English[la]',
      'Humans[MeSH]',
    ].join(' AND ');
  }

  /**
   * Extract focused clinical terms from free text for PubMed search.
   * Uses simple unquoted keywords so PubMed automatic term mapping works correctly.
   * Returns max 3 terms to avoid over-constraining the query.
   */
  extractClinicalTerms(queryText, clinicalQuery) {
    const terms = [];

    // Priority 0: pull in triage-identified diagnosis terms.
    // When a user provides vague symptoms, triage converts them to specific conditions
    // (e.g. "knee pain + slipping after basketball" → ["anterior cruciate ligament", "meniscus"]).
    // Adding those terms to the search text lets the condition/body-part maps below find
    // specific PubMed terms instead of falling back to generic keywords.
    let triageText = '';
    if (typeof clinicalQuery === 'object' && clinicalQuery.triageContext) {
      const ctx = clinicalQuery.triageContext;
      const diagnosisTerms = Array.isArray(ctx.suggestedDiagnoses) ? ctx.suggestedDiagnoses : [];
      const findingTerms = Array.isArray(ctx.assessment?.primaryFindings) ? ctx.assessment.primaryFindings : [];
      triageText = [...diagnosisTerms, ...findingTerms].join(' ').toLowerCase();
    }

    // 1. Body part / anatomical term — simple unquoted keywords for PubMed auto-mapping.
    //
    // Ordering rules (both matter because the loop breaks on the first match):
    //   a) Multi-word phrases before their single-word substrings
    //      ("tibial plateau" before "tibia" — "tibial" contains the substring "tibia")
    //   b) Specific sub-anatomical structures before their parent joint name
    //      ("navicular" before "foot"; "scaphoid" before "wrist")
    //      so that "navicular fracture foot pain" resolves to "navicular", not "foot".
    const bodyPartMap = {
      // ── Shoulder region (specific → generic) ──
      'humeral head': 'proximal humerus',
      'greater tuberosity': 'greater tuberosity',
      'lesser tuberosity': 'lesser tuberosity',
      'proximal humerus': 'proximal humerus',
      'acromioclavicular': 'acromioclavicular',
      'glenohumeral': 'glenohumeral',
      'glenoid': 'glenoid',
      'acromion': 'shoulder',
      'coracoid': 'shoulder',
      'shoulder': 'shoulder',
      // ── Elbow region (specific → generic) ──
      'radial head': 'radial head',
      'lateral epicondyle': 'elbow',
      'medial epicondyle': 'elbow',
      'olecranon': 'olecranon',
      'capitellum': 'elbow',
      'coronoid': 'elbow',
      'elbow': 'elbow',
      // ── Wrist / hand region (specific → generic) ──
      'distal radius': 'radius',
      'scaphoid': 'scaphoid',
      'lunate': 'wrist',
      'hamate': 'wrist',
      'capitate': 'wrist',
      'carpal': 'wrist',
      'metacarpal': 'hand',
      'phalanx': 'hand',
      'phalanges': 'hand',
      'wrist': 'wrist',
      'hand': 'hand',
      'finger': 'finger',
      'thumb': 'thumb',
      'forearm': 'forearm',
      // ── Hip region (specific → generic) ──
      'groin': 'hip',
      'adductor': 'hip',
      'inner thigh': 'hip',
      'femoral neck': 'femoral neck',
      'femoral head': 'femoral head',
      'intertrochanteric': 'intertrochanteric',
      'subtrochanteric': 'subtrochanteric',
      'greater trochanter': 'femur',
      'lesser trochanter': 'femur',
      'acetabulum': 'acetabulum',
      'hip': 'hip',
      // ── Knee region (specific → generic) ──
      'tibial plateau': 'tibial plateau',
      'lateral plateau': 'tibial plateau',
      'medial plateau': 'tibial plateau',
      'femoral condyle': 'femur',
      'lateral condyle': 'knee',
      'medial condyle': 'knee',
      'patella': 'patella',
      'knee': 'knee',
      // ── Ankle / foot region (specific → generic) ──
      'lateral malleolus': 'ankle',
      'medial malleolus': 'ankle',
      'distal fibula': 'fibula',
      'distal tibia': 'tibia',
      'talus': 'talus',
      'calcaneus': 'calcaneus',
      'navicular': 'navicular',
      'metatarsal': 'metatarsal',
      'malleolus': 'ankle',
      'cuboid': 'foot',
      'ankle': 'ankle',
      'foot': 'foot',
      'toe': 'toe',
      'heel': 'calcaneus',
      // ── Spine region (specific → generic) ──
      'lower back': 'lumbar',
      'lumbar': 'lumbar',
      'cervical': 'cervical',
      'thoracic': 'thoracic',
      'vertebra': 'spine',
      'vertebrae': 'spine',
      'sacral': 'sacrum',
      'coccyx': 'sacrum',
      'back': 'lumbar',
      'neck': 'cervical',
      'spine': 'spine',
      // ── Long bones (after regions to avoid shadowing sub-structures) ──
      'clavicle': 'clavicle',
      'collarbone': 'clavicle',
      'clavicular': 'clavicle',
      'scapula': 'scapula',
      'humerus': 'humerus',
      'proximal tibia': 'tibia',
      'distal femur': 'femur',
      'tibia': 'tibia',
      'fibula': 'fibula',
      'femur': 'femur',
      'radius': 'radius',
      'ulna': 'ulna',
      'sternum': 'sternum',
      'rib': 'rib',
      'pelvis': 'pelvis',
      'sacrum': 'sacrum',
    };

    // Prefer structured bodyPart/location field; append triage diagnosis terms for specificity
    const structuredPart =
      (typeof clinicalQuery === 'object' && (clinicalQuery.bodyPart || clinicalQuery.location)) || '';
    const searchText = (structuredPart + ' ' + queryText + ' ' + triageText).toLowerCase();

    for (const [keyword, meshTerm] of Object.entries(bodyPartMap)) {
      if (searchText.includes(keyword)) {
        terms.push(meshTerm);
        break; // one body part is enough
      }
    }

    // 2. Condition / diagnosis terms — use simple keywords, NOT quoted MeSH descriptors.
    // Quoted MeSH phrases (e.g. "fractures, bone") require exact phrase match in free text.
    // Simple keywords let PubMed's automatic term mapping do the right thing.
    const conditionMap = {
      'triangular fibrocartilage': 'triangular fibrocartilage',
      'triangular fibrocartilage complex': 'triangular fibrocartilage',
      'anterior cruciate ligament': '"anterior cruciate ligament"',
      'posterior cruciate ligament': '"posterior cruciate ligament"',
      'medial collateral ligament': '"medial collateral ligament"',
      'rotator cuff': '"rotator cuff"',
      'meniscus': 'meniscus',
      'meniscal': 'meniscus',
      'labrum': 'labrum',
      'labral': 'labrum',
      'tendinitis': 'tendinitis',
      'tendinopathy': 'tendinopathy',
      'tendon': 'tendon',
      'fracture': 'fracture',
      'dislocation': 'dislocation',
      'sprain': 'sprain',
      'strain': 'strain',
      'osteoarthritis': 'osteoarthritis',
      'bursitis': 'bursitis',
      'impingement': 'impingement',
      'plantar fasciitis': '"plantar fasciitis"',
      'carpal tunnel': '"carpal tunnel"',
      'sciatica': 'sciatica',
      'herniated disc': '"disc herniation"',
      'disc herniation': '"disc herniation"',
      'scoliosis': 'scoliosis',
      'frozen shoulder': '"frozen shoulder"',
      'adhesive capsulitis': '"adhesive capsulitis"',
      'tennis elbow': '"tennis elbow"',
      'lateral epicondylitis': 'epicondylitis',
      'medial epicondylitis': 'epicondylitis',
      'achilles': 'achilles tendon',
      'femoroacetabular': '"femoroacetabular impingement"',
      'distal radioulnar': '"distal radioulnar joint"',
    };

    for (const [keyword, term] of Object.entries(conditionMap)) {
      if (searchText.includes(keyword)) {
        terms.push(term);
        break; // one condition term is enough
      }
    }

    // 3. Treatment / intervention term (optional third term) — simple keywords only
    const treatmentMap = {
      'arthroscopy': 'arthroscopy',
      'arthroscopic': 'arthroscopy',
      'arthroplasty': 'arthroplasty',
      'replacement': 'replacement',
      'surgery': 'surgery',
      'surgical': 'surgery',
      'rehabilitation': 'rehabilitation',
      'physical therapy': '"physical therapy"',
      'exercise': 'exercise',
      'injection': 'injection',
      'prp': '"platelet rich plasma"',
      'stem cell': '"stem cell"',
    };

    if (terms.length < 3) {
      for (const [keyword, term] of Object.entries(treatmentMap)) {
        if (searchText.includes(keyword)) {
          terms.push(term);
          break;
        }
      }
    }

    return terms.slice(0, 3);
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

      // Relevance scoring (pass full study object for abstract access)
      const relevanceScore = this.scoreRelevance(study, clinicalQuery);

      // Combined score: 40% quality, 60% relevance
      const combinedScore = (qualityScore * 0.4) + (relevanceScore * 0.6);

      return { ...study, qualityScore, relevanceScore, combinedScore };
    });

    // Filter, sort, and limit
    const maxCitations = tier === 'premium' ? 5 : 3;
    return scored
      .filter(s => s.qualityScore >= 6)
      .filter(s => s.relevanceScore >= 3) // Require minimum topic relevance — prevents off-topic high-prestige papers
      .sort((a, b) => b.combinedScore - a.combinedScore)
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

  scoreRelevance(study, clinicalQuery) {
    // Accept both old-style (title string, query) and new-style (study object, query) call signatures
    const title = typeof study === 'string' ? study : (study?.title || '');
    const abstract = typeof study === 'object' ? (study?.abstract || '') : '';

    if (!title || !clinicalQuery) return 0;

    // Build query text from structured or plain query
    let queryText = '';
    if (typeof clinicalQuery === 'string') {
      queryText = clinicalQuery;
    } else {
      const parts = [];
      if (clinicalQuery.primaryComplaint) parts.push(clinicalQuery.primaryComplaint);
      if (clinicalQuery.symptoms && clinicalQuery.symptoms !== clinicalQuery.primaryComplaint) parts.push(clinicalQuery.symptoms);
      if (clinicalQuery.diagnosis) parts.push(clinicalQuery.diagnosis);
      if (clinicalQuery.procedure) parts.push(clinicalQuery.procedure);
      if (clinicalQuery.location) parts.push(clinicalQuery.location);
      if (clinicalQuery.bodyPart) parts.push(clinicalQuery.bodyPart);
      queryText = parts.join(' ');
    }

    if (!queryText) return 0;

    // Expand abbreviations for richer matching
    let expandedQuery = queryText.toLowerCase();
    const abbrMap = {
      'tfcc': 'triangular fibrocartilage complex',
      'acl': 'anterior cruciate ligament',
      'pcl': 'posterior cruciate ligament',
      'mcl': 'medial collateral ligament',
      'slap': 'superior labrum anterior posterior',
      'rct': 'rotator cuff tear',
      'fai': 'femoroacetabular impingement',
      'oa': 'osteoarthritis',
    };
    for (const [abbr, full] of Object.entries(abbrMap)) {
      if (new RegExp(`\\b${abbr}\\b`, 'i').test(expandedQuery)) {
        expandedQuery += ' ' + full;
      }
    }

    // Generic medical stop words to avoid false positives
    const stopWords = new Set([
      'the','a','an','and','or','of','in','to','for','with','is','on','at','by','from',
      'pain','injury','treatment','patients','study','clinical','after','been','have',
      'this','that','can','are','was','were','has','had','may','will','would',
      'should','could','about','into','over','than','them','they','what','when',
      'which','who','how','its','not','but','also','one','two','three','all',
      'our','their','your','use','used','using','between','within','through',
    ]);

    const queryTerms = expandedQuery.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
    if (queryTerms.length === 0) return 0;

    const titleLower = title.toLowerCase();
    const abstractLower = abstract.toLowerCase();

    // Expand abbreviations in title/abstract too, for richer matching
    let expandedTitle = titleLower;
    let expandedAbstract = abstractLower;
    for (const [abbr, full] of Object.entries(abbrMap)) {
      if (new RegExp(`\\b${abbr}\\b`, 'i').test(expandedTitle)) {
        expandedTitle += ' ' + full;
      }
      if (new RegExp(`\\b${abbr}\\b`, 'i').test(expandedAbstract)) {
        expandedAbstract += ' ' + full;
      }
    }

    // Title matches worth 2×, abstract matches worth 1×
    const titleMatches = queryTerms.filter(t => expandedTitle.includes(t)).length;
    const abstractMatches = queryTerms.filter(t => expandedAbstract.includes(t)).length;
    const termScore = ((titleMatches * 2) + abstractMatches) / (queryTerms.length * 2);
    let score = termScore * 6; // up to 6 points from term matching

    // Bonus: multi-word clinical phrase matches in title or abstract (up to 4 points)
    const clinicalPhrases = [
      'triangular fibrocartilage', 'anterior cruciate', 'posterior cruciate',
      'rotator cuff', 'carpal tunnel', 'plantar fasciitis', 'frozen shoulder',
      'adhesive capsulitis', 'tennis elbow', 'lateral epicondylitis',
      'achilles tendon', 'meniscal tear', 'labral tear', 'disc herniation',
      'spinal stenosis', 'total knee', 'total hip', 'total shoulder',
      'femoroacetabular impingement', 'distal radioulnar',
      // Fracture-specific phrases
      'clavicle fracture', 'collarbone fracture', 'displaced fracture',
      'butterfly fragment', 'scapula fracture', 'humeral fracture',
      'tibial fracture', 'femoral fracture', 'patellar fracture',
      'radial fracture', 'ulnar fracture', 'rib fracture',
      'stress fracture', 'open reduction', 'internal fixation',
      // Sub-anatomical structure phrases
      'talus fracture', 'talar fracture', 'calcaneus fracture', 'calcaneal fracture',
      'tibial plateau fracture', 'radial head fracture', 'olecranon fracture',
      'glenoid fracture', 'greater tuberosity fracture', 'proximal humerus fracture',
      'femoral neck fracture', 'intertrochanteric fracture', 'acetabular fracture',
      'scaphoid fracture', 'distal radius fracture', 'metatarsal fracture',
      'navicular fracture', 'capitellum fracture',
    ];
    const matchedPhrases = clinicalPhrases.filter(p => expandedQuery.includes(p));
    if (matchedPhrases.length > 0) {
      const phraseMatches = matchedPhrases.filter(p => (expandedTitle + ' ' + expandedAbstract).includes(p)).length;
      score += (phraseMatches / matchedPhrases.length) * 4;
    } else {
      // Fallback: body part presence gives partial credit
      const bodyParts = [
        // Joint names
        'knee','shoulder','hip','ankle','wrist','elbow','back','neck','spine','foot','hand',
        // Long bones
        'clavicle','scapula','humerus','tibia','fibula','femur','patella','radius','ulna',
        'sternum','rib','pelvis','sacrum','forearm',
        // Sub-anatomical structures
        'talus','calcaneus','navicular','metatarsal','malleolus',
        'glenoid','glenohumeral','olecranon','capitellum','radial head',
        'scaphoid','acetabulum','tibial plateau','femoral neck','femoral head',
        'intertrochanteric','proximal humerus','greater tuberosity',
      ];
      const queryBodyPart = bodyParts.find(bp => expandedQuery.includes(bp));
      if (queryBodyPart && (expandedTitle.includes(queryBodyPart) || expandedAbstract.includes(queryBodyPart))) {
        score += 3;
      }
    }

    return Math.min(Math.round(score), 10);
  }

  async generateResearchIntro(studies, clinicalQuery) {
    if (!studies || studies.length === 0) {
      return 'No relevant studies were found matching the clinical query.';
    }

    try {
      const gradeFromStudy = (s) => {
        const type = s.studyType || '';
        const score = s.qualityScore || 0;
        if (type === 'Systematic Review' || type === 'Meta-Analysis') return 'A';
        if (type === 'Randomized Controlled Trial') return score >= 7 ? 'A' : 'B';
        if (type === 'Prospective Cohort' || type === 'Cohort Study') return 'B';
        if (type === 'Retrospective Cohort' || type === 'Case-Control') return 'B';
        return 'C';
      };

      const tierLabel = (s) => {
        const t = this.getJournalTierScore(s.journal);
        if (t === 3) return 'Tier 1 (top-tier journal)';
        if (t === 2) return 'Tier 2 (strong specialty journal)';
        if (t === 1) return 'Tier 3 (rehabilitation/MSK journal)';
        return 'unranked journal';
      };

      const studySummaries = studies.map(s => {
        const abstractSnippet = s.abstract
          ? s.abstract.substring(0, 200).replace(/\n/g, ' ') + (s.abstract.length > 200 ? '…' : '')
          : 'No abstract available.';
        const firstAuthor = Array.isArray(s.authors) && s.authors.length > 0
          ? s.authors[0]
          : (s.authors || 'Unknown');
        return [
          `PMID: ${s.pmid || 'N/A'}`,
          `Authors: ${firstAuthor}${Array.isArray(s.authors) && s.authors.length > 1 ? ' et al.' : ''}`,
          `Title: ${s.title}`,
          `Journal: ${s.journal} (${tierLabel(s)})`,
          `Year: ${s.year}`,
          `Study type: ${s.studyType} — Suggested grade: ${gradeFromStudy(s)}`,
          `Quality score: ${s.qualityScore}/10`,
          `Abstract: ${abstractSnippet}`,
        ].join('\n');
      }).join('\n\n');

      const queryDescription = typeof clinicalQuery === 'string'
        ? clinicalQuery
        : JSON.stringify(clinicalQuery);

      const highestLevel = (() => {
        const types = studies.map(s => s.studyType || '');
        if (types.some(t => t === 'Systematic Review' || t === 'Meta-Analysis')) return 1;
        if (types.some(t => t === 'Randomized Controlled Trial')) return 2;
        if (types.some(t => t === 'Prospective Cohort' || t === 'Cohort Study')) return 3;
        if (types.some(t => t === 'Retrospective Cohort' || t === 'Case-Control')) return 4;
        return 5;
      })();

      const prompt = `You are a medical literature specialist. Structure a research summary using the exact format below.

Clinical query: ${queryDescription}

Studies (${studies.length} total; highest evidence level: Level ${highestLevel}):

${studySummaries}

Produce the response in this exact structure:

## Research Summary: [fill in condition/question from the clinical query]

**Clinical Question**: [Restate the query in PICO format: Population, Intervention, Comparison, Outcome — plain language, 1–2 sentences]
**Evidence Base**: [${studies.length} ${studies.length === 1 ? 'study' : 'studies'} found; highest level: Level ${highestLevel}]

---

### Key Findings

[2–4 sentences. Synthesize the most actionable finding first. Plain language, 8th-grade reading level. Do not just list abstracts — synthesize what the body of evidence says.]

---

### Citations

[For each study, output:]
**[Grade X]** [First author et al., Year] — [Journal]
*[One sentence: what was studied, what was found, why it is relevant to this question. If grade is B or C, briefly note why (population mismatch, study design limitation, etc.).]*
PubMed ID: [PMID]

---

### Evidence Gaps & Caveats

- [Note any age, activity level, or surgical vs. conservative population mismatches]
- [Note alignment or conflict with AAOS, AOSSM, or APTA guidelines — if unknown, write "Guideline alignment: not verified in this search"]
- [For biologics: note FDA status. For techniques <5 years old: flag limited follow-up data.]
- [Other limitations or weak evidence areas]

---

### Suggested Follow-Up Searches

[1–2 related PubMed queries the user may want to run for adjacent evidence]`;

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
