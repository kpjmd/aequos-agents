import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { agentConfig } from '../config/agent-config.js';
import logger from './logger.js';

/**
 * Phase 2c — production decision-point slug-classifier.
 *
 * Maps a live consult's ad-hoc decision point ({id, question, options}) to its nearest CURATED
 * benchmark slug, so persistEquipoisePanels() can anchor the production panel_run to a real slug
 * instead of the single 'production-unclassified' sentinel — lighting up per-slug production
 * convergence in v_convergence_by_model over time. A null match keeps the sentinel.
 *
 * Design (co-designed with the surgeon, 2026-06-27 — STRICT, precision-first):
 *   A false match corrupts a curated slug's production signal (hard to un-corrupt); a false null is
 *   harmless (the consult still persists in full under the sentinel — today's baseline). So we
 *   anchor ONLY on an exact match and default to null on any doubt.
 *   - same anatomical CONDITION (incl. named severity/variant in the curated question) AND the same
 *     management FORK (operative-vs-nonop / which-operation / timing).
 *   - wording-tolerant, NOT literal: forks match through clinical synonymy (ORIF ≈ surgical
 *     fixation; PT ≈ structured rehab ≈ nonoperative). No option-string overlap required.
 *   - multi-option (3-4) consult DPs anchor only if the primary fork collapses cleanly to the
 *     curated binary fork; otherwise null.
 *   - the LLM returns matchQuality ∈ {exact, related, none}; we anchor only on 'exact'. 'related'
 *     (same condition/region, different fork) surfaces a nearMissSlug for the reversibility audit
 *     trail (persisted on queries.patient_context), so strict-vs-loose can be revisited from data.
 *
 * Best-effort: returns {slug:null, matchQuality:'none'} on any error/timeout — never throws.
 */

const CLASSIFIER_MODEL = process.env.FAST_MODEL || 'claude-haiku-4-5-20251001';
const CLASSIFIER_TIMEOUT_MS = parseInt(process.env.DP_CLASSIFIER_TIMEOUT_MS, 10) || 20000;

export const SENTINEL_SLUG = 'production-unclassified';

const ClassificationSchema = z.object({
  matchQuality: z
    .enum(['exact', 'related', 'none'])
    .describe(
      'exact = SAME condition (incl. severity/variant) AND same management fork as a curated slug. ' +
        'related = same body region/condition but a DIFFERENT fork (e.g. graft-choice vs operate-or-not), ' +
        'or a multi-option decision that does not collapse cleanly to a curated binary fork. ' +
        'none = no curated slug is about this decision.'
    ),
  slug: z
    .string()
    .nullable()
    .describe(
      'the curated slug from the menu: the matched slug when exact; the closest related slug when ' +
        'related; null when none. MUST be copied verbatim from the menu — never invent a slug.'
    ),
  reasoning: z
    .string()
    .describe('one sentence: the condition + fork you matched on, or why nothing matched.'),
});

const SYSTEM_INSTRUCTIONS = `You classify a live orthopedic consult's clinical DECISION POINT against a fixed CATALOG of curated benchmark decision points, returning the single best catalog slug or none.

You are matching the DECISION, not the patient. The catalog entries are population-level ("in an adult with X, is A or B preferred?"); the consult decision is for a specific patient. Ignore patient specifics (age, demand, comorbidity) — match on the underlying decision only.

A consult decision is an EXACT match to a catalog entry ONLY when BOTH hold:
1. SAME anatomical condition. A named severity, fracture pattern, or variant in the catalog question is PART of the condition's identity. A 2-part proximal humerus fracture is NOT the same condition as a "3-/4-part" entry; an ACL tear is not a PCL tear. Different severity/variant ⇒ NOT exact.
2. SAME management fork: operative-vs-nonoperative, OR which-operation (technique A vs B), OR timing-of-surgery. Match the fork through clinical SYNONYMY, not literal words — "ORIF" = "surgical fixation" = "operative stabilization"; "PT" = "structured rehab" = "nonoperative management". The same condition framed as a DIFFERENT fork (e.g. graft choice vs operate-or-not) is NOT exact.

Multi-option consult decisions (3-4 options): catalog forks are binary. Mark exact ONLY if the consult's primary fork collapses cleanly onto the catalog's binary fork (e.g. "rehab / early reconstruction / delayed reconstruction" → operative-vs-nonoperative). If it does not reduce cleanly, it is NOT exact.

When the consult shares the condition or region with a catalog entry but the fork differs, or it is a multi-option decision that does not collapse cleanly, return matchQuality="related" with that closest catalog slug. When no catalog entry is about this decision at all, return "none" with slug=null.

Be conservative: when in doubt between exact and related, choose related. Only "exact" causes anchoring. Always copy the slug verbatim from the catalog menu.`;

// ---- catalog cache (the curated menu changes only on reseed / deploy-restart) ----
let _catalog = null; // Array<{slug, decision_type, canonical_question, option_a_label, option_b_label}>
let _catalogSlugs = null; // Set<slug> for verbatim-copy validation
let _menuText = null; // rendered, cached menu string (the cache_control payload)
let _llm = null; // lazily-constructed Haiku classifier LLM

/**
 * Load the curated catalog (excluding the sentinel + inactive rows) and module-cache it. Mirrors the
 * _sentinelId caching in equipoise-ingest.js. Returns [] when sql is null (dev/tests) or on failure.
 * @param {import('@neondatabase/serverless').NeonQueryFunction<any,any>} sql
 * @returns {Promise<Array<Object>>}
 */
export async function loadCatalog(sql) {
  if (_catalog) return _catalog;
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT slug, decision_type, canonical_question, option_a_label, option_b_label
      FROM decision_points
      WHERE is_active = true AND slug <> ${SENTINEL_SLUG}
      ORDER BY slug
    `;
    _catalog = rows;
    _catalogSlugs = new Set(rows.map((r) => r.slug));
    _menuText = renderMenu(rows);
    return _catalog;
  } catch (error) {
    logger.error('dp-classifier: catalog load failed', { error: error.message });
    return [];
  }
}

/** Render the compact menu the model selects from. One block per curated DP. */
function renderMenu(rows) {
  return rows
    .map(
      (r) =>
        `- ${r.slug} (${r.decision_type})\n  Q: ${r.canonical_question}\n  A: ${r.option_a_label} | B: ${r.option_b_label}`
    )
    .join('\n');
}

/** Lazily construct the Haiku classifier LLM (mirrors base-agent's fastLLM). */
function getClassifierLLM() {
  if (_llm) return _llm;
  _llm = new ChatAnthropic({
    anthropicApiKey: agentConfig.claude.apiKey,
    modelName: CLASSIFIER_MODEL,
    temperature: 0, // deterministic classification
    maxTokens: 400,
  });
  _llm.topP = undefined; // newer models reject LangChain's default topP of -1
  return _llm;
}

/**
 * Classify one consult decision point against the curated catalog.
 * @param {{id?:string, question:string, options:string[]}} dp - the consult's ad-hoc decision point
 * @param {Array<Object>} catalog - rows from loadCatalog() (used to validate the returned slug)
 * @param {Object} [llm] - injectable LLM (withStructuredOutput); defaults to the module Haiku LLM (tests stub it)
 * @returns {Promise<{slug:string|null, matchQuality:'exact'|'related'|'none', nearMissSlug:string|null, reasoning:string|null}>}
 */
export async function classifyDecisionPoint(dp, catalog, llm = null) {
  const NONE = { slug: null, matchQuality: 'none', nearMissSlug: null, reasoning: null };
  if (!dp?.question || !Array.isArray(catalog) || catalog.length === 0) return NONE;

  const slugs = _catalogSlugs && _catalog === catalog ? _catalogSlugs : new Set(catalog.map((r) => r.slug));
  const menu = _menuText && _catalog === catalog ? _menuText : renderMenu(catalog);

  const userMessage =
    `CONSULT DECISION POINT — classify against the catalog in the system prompt.\n` +
    `Question: ${dp.question}\n` +
    `Options: ${(dp.options || []).map((o, i) => `${i + 1}. ${o}`).join('  ')}`;

  try {
    const model = llm || getClassifierLLM();
    const structured = model.withStructuredOutput(ClassificationSchema, { name: 'dp_classification' });
    const invocation = structured.invoke([
      {
        role: 'system',
        // The static menu rides in its own content block with cache_control so it is ~free after the
        // first call within the 5-min cache window (it is identical across consults). The varying
        // consult DP stays in the user message so the cached prefix is never invalidated.
        content: [
          { type: 'text', text: SYSTEM_INSTRUCTIONS },
          { type: 'text', text: `CATALOG MENU (choose at most one slug, copied verbatim):\n${menu}`, cache_control: { type: 'ephemeral' } },
        ],
      },
      { role: 'user', content: userMessage },
    ]);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`dp-classifier timeout after ${CLASSIFIER_TIMEOUT_MS}ms`)), CLASSIFIER_TIMEOUT_MS)
    );
    const result = await Promise.race([invocation, timeout]);

    return normalizeResult(result, slugs);
  } catch (error) {
    logger.error('dp-classifier: classification failed', { question: dp?.question?.slice(0, 80), error: error.message });
    return NONE;
  }
}

/**
 * Apply the anchoring rule to the raw LLM result: anchor ONLY on exact + a real catalog slug;
 * surface a nearMissSlug on related; everything else → null/none. Guards hallucinated slugs.
 */
export function normalizeResult(result, slugs) {
  const reasoning = result?.reasoning ?? null;
  const rawSlug = typeof result?.slug === 'string' ? result.slug : null;
  const known = rawSlug && slugs.has(rawSlug) ? rawSlug : null;

  if (result?.matchQuality === 'exact' && known) {
    return { slug: known, matchQuality: 'exact', nearMissSlug: null, reasoning };
  }
  if (result?.matchQuality === 'related') {
    // related never anchors; record the near-miss slug (if real) for the audit trail.
    return { slug: null, matchQuality: 'related', nearMissSlug: known, reasoning };
  }
  // 'none', or 'exact' with a hallucinated/unknown slug (downgraded → no anchor).
  return { slug: null, matchQuality: 'none', nearMissSlug: null, reasoning };
}

/** Test/CLI hook: reset the module caches (catalog menu + LLM). */
export function _resetClassifierCache() {
  _catalog = null;
  _catalogSlugs = null;
  _menuText = null;
  _llm = null;
}

export default classifyDecisionPoint;
