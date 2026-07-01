import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { agentConfig } from '../config/agent-config.js';
import { toStanceEnum } from './equipoise-mappers.js';
import logger from './logger.js';

/**
 * Phase 2.5 — Managed-Agent research → claim-grounded `evidence_citations`.
 *
 * For one production panel_run, retrieve PubMed evidence (reusing the existing ResearchAgent
 * plumbing), classify each citation against the PANEL'S OWN stances, apply a strict acceptance rule,
 * and return rows ready for evidence_citations + the card's evidenceLedger.
 *
 * Design (co-designed with the surgeon, 2026-06-28):
 *   - NO FEEDBACK / pure annotation. This runs strictly DOWNSTREAM of a locked detector verdict +
 *     locked specialist positions (background, post-persistence). Data flows ONE direction: panel
 *     claims → evidence. It never re-runs the detector, never mutates positions/verdict/card status/
 *     routing. claim_text is taken from the panel's own per-stance reasoning (grounded, not invented).
 *   - STRICT acceptance (deterministic, in JS — NOT LLM discretion):
 *       accepted = grade ∈ {high,moderate} AND population_match ∈ {match,partial}
 *                  AND study_type ∈ {rct,systematic_review,meta_analysis,cohort}
 *     Everything retrieved is stored; non-qualifying rows persist accepted=false (audit trail).
 *   - population_match judged over THREE dimensions only: age bracket, activity/demand level,
 *     anatomical specificity. Major mismatch on any → mismatch; minor/adjacent → partial;
 *     unextractable study population → unknown; all align → match.
 *
 * Best-effort everywhere: never throws (logs + degrades). A classifier failure falls back to
 * hint-derived defaults (population_match='unknown' ⇒ nothing accepted), so rows still persist.
 */

const CLASSIFIER_MODEL = process.env.FAST_MODEL || 'claude-haiku-4-5-20251001';
const CLASSIFIER_TIMEOUT_MS = parseInt(process.env.EVIDENCE_CLASSIFIER_TIMEOUT_MS, 10) || 25000;

// Strict acceptance bar (locked 2026-06-28). Membership sets, applied deterministically.
const ACCEPT_GRADES = new Set(['high', 'moderate']);
const ACCEPT_POPULATION = new Set(['match', 'partial']);
const ACCEPT_STUDY_TYPES = new Set(['rct', 'systematic_review', 'meta_analysis', 'cohort']);

// PubMed publication-type string (ResearchAgent.classifyStudyType) → schema study_type enum hint.
// Only a hint: the LLM refines from the abstract (PubMed collapses cohort/case-series into Other/Review).
const STUDY_TYPE_HINT = {
  'Meta-Analysis': 'meta_analysis',
  'Systematic Review': 'systematic_review',
  'Randomized Controlled Trial': 'rct',
  'Clinical Trial': 'cohort',
  Review: 'expert_opinion',
  Other: 'expert_opinion',
};

const STUDY_TYPE_ENUM = ['rct', 'systematic_review', 'meta_analysis', 'cohort', 'case_control', 'case_series', 'guideline', 'expert_opinion'];

// Decision types whose equipoise does NOT hinge on patient demand level → judge population leniently
// (which_operation turns on pathology / fracture-pattern, per the archetype-flip axes; technique
// evidence is typically population-general). Everything else (operate-vs-nonop, timing) stays strict,
// where demand level is decision-critical. Locked with the surgeon 2026-06-28.
const LENIENT_POPULATION_TYPES = new Set(['which_operation']);

// When the panel elicited its positions at the POPULATION level (hybrid equipoise instrument), the
// card reasons about a typical adult for whom the decision arises — demand level is intentionally
// unspecified, not missing data. Judging that card's evidence under STRICT mode rejects every citation
// whose demand is unstated (population_match → 'unknown'), leaving an empty ledger on a well-formed
// card. So a population-level card always uses LENIENT population matching, regardless of decision_type.
function populationModeFor(decisionType, population = false) {
  if (population) return 'lenient';
  return LENIENT_POPULATION_TYPES.has(decisionType) ? 'lenient' : 'strict';
}

// Fields are validated STRINGS, not Zod enums, deliberately: withStructuredOutput does a strict Zod
// parse and a single off-menu value (e.g. the model writing "review" for study type) would reject the
// ENTIRE batch. The allowed values live in each .describe() to guide the model; classifyCitations()
// normalizes any off-menu value per-field (so one slip degrades one field, never the whole response).
const ClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      ref: z.number().int().describe('the 1-based citation number from the list, copied exactly'),
      supportsStance: z
        .string()
        .describe('one of: option_a | option_b | neither. Which decision option this citation\'s finding informs; "neither" if it does not bear on the A-vs-B fork'),
      studyType: z
        .string()
        .describe(`one of: ${STUDY_TYPE_ENUM.join(' | ')}. The study design judged from the abstract (more precise than the PubMed hint)`),
      evidenceGrade: z
        .string()
        .describe('one of: high | moderate | low | very_low. GRADE-style certainty: high = SR/MA or well-powered RCT; moderate = RCT with limitations or strong cohort; low = small/observational; very_low = case series / expert opinion'),
      populationMatch: z
        .string()
        .describe('one of: match | partial | mismatch | unknown. Study population vs THIS patient over age + activity/demand + anatomy, per the strictness mode given'),
      rationale: z.string().describe('one sentence: what the study found + why this grade and population_match'),
    })
  ),
});

const SYSTEM_INSTRUCTIONS = `You classify retrieved PubMed citations for a clinical decision point that an expert orthopedic panel has already deliberated. Your job is ANNOTATION ONLY — you describe the evidence; you do NOT decide the case, and nothing you output changes the panel's verdict.

For EACH numbered citation, return:
1. supportsStance — which decision option the citation's finding INFORMS. Use option_a or option_b ONLY when the study actually bears on the A-vs-B choice: a head-to-head comparison, or a finding about one option's outcome that speaks to whether it should be chosen OVER the other. Use "neither" when the study is merely about the same condition/anatomy without informing the fork, is inconclusive/balanced, or is DOWNSTREAM of the decision (e.g. a post-operative rehabilitation technique when the fork is whether to operate at all). If your rationale would say "does not address the decision", the answer is "neither". Map by the study's CONCLUSION, not its topic.
2. studyType — the design judged from the abstract (rct, systematic_review, meta_analysis, cohort, case_control, case_series, guideline, expert_opinion). The provided PubMed type is only a hint; correct it from the abstract.
3. evidenceGrade — GRADE-style certainty (high / moderate / low / very_low): high = systematic review/meta-analysis of RCTs or a well-powered low-risk RCT; moderate = RCT with limitations or a strong prospective cohort; low = small or retrospective observational; very_low = case series, narrative review, expert opinion.
4. populationMatch — the study population vs THIS patient, over exactly THREE dimensions:
   • AGE BRACKET (pediatric <18 / young adult 18–35 / middle-aged 35–55 / older adult 55+)
   • ACTIVITY / DEMAND LEVEL (competitive vs recreational vs sedentary/low-demand)
   • ANATOMICAL SPECIFICITY (exact structure/variant/severity — e.g. medial vs lateral, 2-part vs 3-/4-part)
   Apply the POPULATION STRICTNESS MODE given for this decision in the user message:
   • STRICT (operate-vs-nonop / timing decisions — demand level is decision-critical): a demand-level mismatch → "mismatch"; a major mismatch on age or anatomy → "mismatch"; a minor/adjacent gap → "partial"; a population you cannot characterize at all → "unknown". All three align → "match".
   • LENIENT (technique-choice decisions — the fork does NOT hinge on demand): if AGE bracket and ANATOMY match (or the study is a general adult population), use "match" or "partial" EVEN IF activity/demand is unstated — do NOT downgrade to "unknown" merely because demand is unspecified. A major mismatch on age or anatomy is still "mismatch". Reserve "unknown" for a population you genuinely cannot determine at all (no age, no anatomy).
5. rationale — one sentence.

Judge population over the three dimensions only — do NOT consider operative-vs-conservative cohort as a population dimension — and follow the strictness mode given for the decision.`;

let _llm = null; // lazily-constructed Haiku classifier LLM (mirrors dp-classifier.js)

/** Lazily construct the Haiku classifier LLM. */
function getClassifierLLM() {
  if (_llm) return _llm;
  _llm = new ChatAnthropic({
    anthropicApiKey: agentConfig.claude.apiKey,
    modelName: CLASSIFIER_MODEL,
    temperature: 0,
    maxTokens: 1500,
  });
  _llm.topP = undefined; // newer models reject LangChain's default topP of -1
  return _llm;
}

/** Test/CLI hook: reset the module-level LLM cache. */
export function _resetEvidenceCache() {
  _llm = null;
}

/** Strict acceptance rule — deterministic, the single source of truth for `accepted`. */
export function isAccepted({ evidenceGrade, populationMatch, studyType }) {
  return ACCEPT_GRADES.has(evidenceGrade) && ACCEPT_POPULATION.has(populationMatch) && ACCEPT_STUDY_TYPES.has(studyType);
}

/** Fallback grade from study type when the LLM did not assign one (degraded path). */
function gradeFromStudyType(studyType) {
  if (studyType === 'meta_analysis' || studyType === 'systematic_review' || studyType === 'rct') return 'high';
  if (studyType === 'cohort' || studyType === 'case_control') return 'moderate';
  if (studyType === 'case_series') return 'low';
  return 'very_low';
}

function snippet(texts, max = 180) {
  const joined = (texts || []).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) return '';
  return joined.length > max ? `${joined.slice(0, max - 1)}…` : joined;
}

/**
 * Derive the panel's per-stance CLAIMS — the grounding for claim_text (panel → evidence, one way).
 * Contested: each side's stance (an option label) + its specialists' reasoning. Converged: the modal
 * stance + the substantive positions' reasoning. Returns option labels + a {option_a?, option_b?} map.
 * @param {Object} perDP - a coordination-conference perDecisionPoint entry
 */
export function deriveClaims(perDP) {
  const dp = perDP?.decisionPoint || {};
  const [optionALabel = null, optionBLabel = null] = dp.options || [];
  const ss = perDP?.splitSummary || {};
  const claims = {};

  const addClaim = (stanceLabel, reasonings) => {
    const enumStance = toStanceEnum(stanceLabel, optionALabel, optionBLabel);
    if (enumStance === 'abstain') return;
    const label = enumStance === 'option_a' ? optionALabel : optionBLabel;
    const reason = snippet(reasonings);
    claims[enumStance] = { label, claimText: reason ? `${label} — ${reason}` : label };
  };

  if (Array.isArray(ss.sides) && ss.sides.length > 0) {
    for (const side of ss.sides) {
      addClaim(side.stance, (side.specialists || []).map((s) => s.reasoning));
    }
  } else {
    const modal = Array.isArray(ss.distinctStances) ? ss.distinctStances[0] : null;
    if (modal) {
      addClaim(
        modal,
        (perDP?.positions || []).filter((p) => p.finalStance === modal).map((p) => p.reasoning)
      );
    }
  }
  return { optionALabel, optionBLabel, claims };
}

/** Assemble the ResearchAgent clinicalQuery for a decision-level (balanced) PubMed retrieval. */
function buildClinicalQuery(dp, caseData = {}, patientContext = {}) {
  return {
    primaryComplaint: dp.question,
    bodyPart: caseData.bodyPart || patientContext.bodyRegion || '',
    procedure: Array.isArray(dp.options) ? dp.options.join(' vs ') : '',
    symptoms: caseData.symptoms || '',
    diagnosis: caseData.diagnosis || '',
    triageContext: caseData.triageContext || undefined,
  };
}

function renderUserMessage(dp, optionALabel, optionBLabel, claims, patientContext, citations, decisionType, population) {
  const mode = populationModeFor(decisionType, population);
  const modeLine =
    mode === 'lenient'
      ? `POPULATION STRICTNESS MODE: LENIENT (decision fork: ${decisionType || 'unknown'} — does NOT hinge on demand; do NOT mark "unknown" just because activity/demand is unstated).`
      : `POPULATION STRICTNESS MODE: STRICT (decision fork: ${decisionType || 'unknown'} — activity/demand level is decision-critical).`;

  const claimLines = Object.entries(claims)
    .map(([stance, c]) => `  - ${stance} (${c.label}): ${c.claimText}`)
    .join('\n') || '  - (panel did not articulate distinct per-stance claims)';

  const pc = patientContext || {};
  const patientLines = [
    `  - Age bracket: ${pc.ageBracket || 'unknown'}`,
    `  - Activity / demand level: ${pc.demandLevel || 'unknown'}`,
    `  - Body region: ${pc.bodyRegion || 'unknown'}`,
  ].join('\n');

  const citationBlocks = citations
    .map((c, i) => {
      const abstract = c.abstract ? String(c.abstract).slice(0, 600) : '(no abstract available)';
      return [
        `[${i + 1}] PMID ${c.pmid || 'N/A'} — ${c.title || '(no title)'}`,
        `    Journal: ${c.journal || 'unknown'} (${c.year || 'n.d.'}) | PubMed type hint: ${c.studyType || 'Other'}`,
        `    Abstract: ${abstract}`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    'DECISION POINT (already deliberated by the panel — do not re-decide it):',
    `  Question: ${dp.question}`,
    `  option_a: ${optionALabel ?? '(unspecified)'}`,
    `  option_b: ${optionBLabel ?? '(unspecified)'}`,
    '',
    'PANEL CLAIMS (the assertions each option rests on):',
    claimLines,
    '',
    modeLine,
    '',
    'THIS PATIENT (for populationMatch — judge over age bracket, activity/demand, anatomy only):',
    patientLines,
    '',
    `CITATIONS TO CLASSIFY (${citations.length}):`,
    citationBlocks,
    '',
    'Return one classification object per citation, keyed by its [ref] number.',
  ].join('\n');
}

/**
 * Classify retrieved citations against the panel's stances in ONE structured-output call.
 * Best-effort: on any LLM failure, falls back to hint-derived defaults (population_match='unknown',
 * so nothing is accepted) — rows still persist for the audit trail.
 * @returns {Promise<Array<citationRow>>}
 */
async function classifyCitations(citations, { dp, optionALabel, optionBLabel, claims, patientContext, decisionType, population, llm }) {
  let byRef = new Map();
  try {
    const model = llm || getClassifierLLM();
    const structured = model.withStructuredOutput(ClassificationSchema, { name: 'evidence_classification' });
    const invocation = structured.invoke([
      {
        role: 'system',
        content: [{ type: 'text', text: SYSTEM_INSTRUCTIONS, cache_control: { type: 'ephemeral' } }],
      },
      { role: 'user', content: renderUserMessage(dp, optionALabel, optionBLabel, claims, patientContext, citations, decisionType, population) },
    ]);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`evidence-classifier timeout after ${CLASSIFIER_TIMEOUT_MS}ms`)), CLASSIFIER_TIMEOUT_MS)
    );
    const result = await Promise.race([invocation, timeout]);
    for (const c of result?.classifications || []) {
      const refNum = Number(c?.ref);
      if (Number.isFinite(refNum)) byRef.set(refNum, c);
    }
  } catch (error) {
    logger.warn(`evidence-research: classification failed, persisting with defaults — ${error.message}`);
    byRef = new Map();
  }

  // Normalize an LLM token onto the canonical snake_case vocabulary ("Meta-Analysis" → "meta_analysis",
  // "Option A" → "option_a") before the membership checks below.
  const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase().replace(/[\s-]+/g, '_') : x);

  return citations.map((citation, i) => {
    const cls = byRef.get(i + 1) || {};
    const clsStudyType = norm(cls.studyType);
    const studyType = STUDY_TYPE_ENUM.includes(clsStudyType)
      ? clsStudyType
      : STUDY_TYPE_HINT[citation.studyType] || 'expert_opinion';
    const clsGrade = norm(cls.evidenceGrade);
    const evidenceGrade = ['high', 'moderate', 'low', 'very_low'].includes(clsGrade)
      ? clsGrade
      : gradeFromStudyType(studyType);
    const clsPop = norm(cls.populationMatch);
    const populationMatch = ['match', 'partial', 'mismatch', 'unknown'].includes(clsPop)
      ? clsPop
      : 'unknown';
    const clsStance = norm(cls.supportsStance);
    const supportsStance = clsStance === 'option_a' || clsStance === 'option_b' ? clsStance : 'abstain';
    const claimText = supportsStance !== 'abstain' && claims[supportsStance] ? claims[supportsStance].claimText : dp.question;
    const accepted = isAccepted({ evidenceGrade, populationMatch, studyType });
    return {
      pmid: citation.pmid ?? null,
      title: citation.title ?? null,
      supportsStance,
      claimText,
      studyType,
      evidenceGrade,
      populationMatch,
      accepted,
      rationale: typeof cls.rationale === 'string' ? cls.rationale : null,
    };
  });
}

/**
 * Build the evidence citation rows for one production panel. Retrieves PubMed evidence (reusing the
 * ResearchAgent), then claim-grounds + classifies each citation. Returns [] when research is
 * unavailable or finds nothing. NEVER throws.
 * @param {Object} researchAgent - the shared ResearchAgent (curateRelevantStudies)
 * @param {Object} params
 * @param {Object} params.perDP - coordination-conference perDecisionPoint entry
 * @param {Object} [params.patientContext] - de-identified {ageBracket, demandLevel, bodyRegion}
 * @param {Object} [params.caseData] - consult case data (for query building only; not stored)
 * @param {string} [params.decisionType] - curated slug's decision_type (drives population strictness)
 * @param {boolean} [params.population] - panel elicited at population level → lenient population_match
 * @param {Object} [params.llm] - injectable classifier LLM (tests stub it)
 * @returns {Promise<Array<citationRow>>}
 */
export async function buildEvidenceForPanel(researchAgent, { perDP, patientContext = {}, caseData = {}, decisionType = null, population = false, llm = null } = {}) {
  if (!researchAgent || typeof researchAgent.curateRelevantStudies !== 'function') return [];
  const dp = perDP?.decisionPoint;
  if (!dp?.question) return [];

  try {
    const clinicalQuery = buildClinicalQuery(dp, caseData, patientContext);
    const research = await researchAgent.curateRelevantStudies(clinicalQuery, 'premium');
    const citations = research?.citations || [];
    if (citations.length === 0) return [];

    const { optionALabel, optionBLabel, claims } = deriveClaims(perDP);
    return await classifyCitations(citations, { dp, optionALabel, optionBLabel, claims, patientContext, decisionType, population, llm });
  } catch (error) {
    logger.error('evidence-research: buildEvidenceForPanel failed', { error: error.message });
    return [];
  }
}

/** Accepted citation rows → card_json.evidenceLedger entries (the card shows accepted only). */
export function toLedgerEntries(rows) {
  return (rows || [])
    .filter((r) => r.accepted)
    .map((r) => ({
      pmid: r.pmid,
      title: r.title,
      studyType: r.studyType,
      evidenceGrade: r.evidenceGrade,
      populationMatch: r.populationMatch,
      supportsStance: r.supportsStance,
      claimText: r.claimText,
      rationale: r.rationale,
    }));
}

/**
 * Persist evidence citation rows (accepted AND rejected) for one panel_run. Best-effort: no-op when
 * sql is null or rows empty; never throws (logs + returns the count stored so far).
 * @param {import('@neondatabase/serverless').NeonQueryFunction<any,any>} sql
 * @param {number|string} panelRunId
 * @param {Array<citationRow>} rows
 * @returns {Promise<number>} number of rows stored
 */
export async function storeEvidenceCitations(sql, panelRunId, rows) {
  if (!sql || panelRunId == null || !Array.isArray(rows) || rows.length === 0) return 0;
  let stored = 0;
  try {
    for (const r of rows) {
      await sql`
        INSERT INTO evidence_citations
          (panel_run_id, supports_stance, claim_text, pmid, title, study_type, evidence_grade,
           population_match, accepted, rationale)
        VALUES
          (${panelRunId}, ${r.supportsStance ?? null}::stance, ${r.claimText ?? '(unspecified)'},
           ${r.pmid ?? null}, ${r.title ?? null}, ${r.studyType ?? null}::study_type,
           ${r.evidenceGrade ?? null}::evidence_grade, ${r.populationMatch ?? 'unknown'}::population_match,
           ${r.accepted ?? false}, ${r.rationale ?? null})
      `;
      stored++;
    }
    return stored;
  } catch (error) {
    logger.error('evidence-research: storeEvidenceCitations failed', { panelRunId, error: error.message });
    return stored;
  }
}

export default buildEvidenceForPanel;
