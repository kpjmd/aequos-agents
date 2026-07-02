/**
 * Batched panel path for the equipoise benchmark probe (Phase 2 cost lever).
 *
 * The live/synchronous probe obtains specialist positions one LLM call at a time via
 * conference.runDecisionPoints() -> OrthopedicSpecialist.statePosition() -> LangChain.
 * For the full 122-DP sweep that is thousands of small calls. This module moves the SAME
 * calls onto the Anthropic Message Batches API (flat 50% off all tokens) WITHOUT changing
 * detector semantics:
 *
 *   - The request body mirrors statePosition exactly — system = the specialist's
 *     getSystemPrompt(); user = the specialist's buildPositionPrompt() (single source of
 *     truth, called on the real agent instances); tool = makePositionSchema()'s shape with
 *     a forced tool_choice (replicating LangChain withStructuredOutput); same model,
 *     temperature, max_tokens as base-agent.js.
 *   - Parsed positions are fed through the conference's OWN detectDivergence() +
 *     summarizeDecisionPoint() and the existing archetype-flip aggregation, so the per-run
 *     verdict / split_summary / positions are byte-identical to the synchronous path given
 *     identical model responses.
 *
 * Only the transport changes. Caching is intentionally NOT used here: the specialist system
 * prompt is below Sonnet's cache floor and position calls have no large stable prefix, so
 * cache_control would cache ~0 tokens (see plan). Batch carries the savings.
 *
 * Scope: archetype-flip mode only (the validated default). Population mode is not batched.
 */
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import logger from './logger.js';
import { POSITION_SPECIALISTS, CoordinationConference } from './coordination-conference.js';
import {
  archetypeGroupsForDecisionType,
  computeArchetypeFlipVerdict,
} from './archetype-flip.js';
import { aggregateSweep } from './archetype-sweep.js';

const TOOL_NAME = 'specialist_position';

/**
 * Build the position tool whose input schema mirrors makePositionSchema(options) in
 * dialogue-schemas.js (field order reasoning -> stance -> confidence -> evidenceGrade is
 * load-bearing: think-then-commit). Descriptions are copied verbatim so the model sees the
 * same guidance LangChain's withStructuredOutput sends.
 */
function positionTool(options) {
  const stanceValues = [...options, 'defer'];
  return {
    name: TOOL_NAME,
    description: 'Record your structured clinical position on this decision point.',
    input_schema: {
      type: 'object',
      properties: {
        reasoning: {
          type: 'string',
          description:
            'FIRST reason through THIS case from your specialty lens — what does your expertise specifically weigh here, and which way does it point? Argue from your domain, not from generic caution. 2-4 sentences.',
        },
        stance: {
          type: 'string',
          enum: stanceValues,
          description:
            'AFTER your reasoning, the option your reasoning leads you to, matching one provided option exactly; or "defer" only if this decision is genuinely outside your lens or the evidence is truly insufficient. Do not pick an option merely because it sounds safest.',
        },
        confidence: { type: 'number', description: 'your confidence in this stance, 0-1' },
        evidenceGrade: {
          type: 'string',
          enum: ['A', 'B', 'C', 'D', 'none'],
          description: 'strength of evidence supporting your stance (A strongest; "none" if defer)',
        },
      },
      required: ['reasoning', 'stance', 'confidence', 'evidenceGrade'],
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Deterministically enumerate every panel call for the sweep. Order depends only on
 * (sample, n) so a resume rebuilds identical custom_ids. custom_id is index-based
 * (`req-<i>`) to stay within Anthropic's 64-char limit regardless of slug length.
 *
 * @returns {{entries: Array, requests: Array}} entries carry the metadata to reassemble;
 *   requests are the batch payloads.
 */
function buildEntries(sample, n, specialists, { model, maxTokens }) {
  // Capture each position specialist's system prompt once (stable per specialist).
  const agents = POSITION_SPECIALISTS
    .map((type) => [type, specialists.get(type)])
    .filter(([, a]) => a && typeof a.buildPositionPrompt === 'function');

  const entries = [];
  const requests = [];
  let i = 0;

  for (const dp of sample) {
    const decisionPoint = {
      id: dp.slug,
      question: dp.canonical_question,
      options: [dp.option_a_label, dp.option_b_label],
    };
    const tool = positionTool(decisionPoint.options);
    const groups = archetypeGroupsForDecisionType(dp.decision_type);

    for (let runIndex = 1; runIndex <= n; runIndex++) {
      for (const group of groups) {
        for (const arch of group.set) {
          const caseData = { archetype: arch.label, ...arch.case };
          for (const [specialistType, agent] of agents) {
            const customId = `req-${i++}`;
            const params = {
              model,
              max_tokens: maxTokens,
              temperature: 0.3, // match base-agent.js this.llm
              system: agent.getSystemPrompt(),
              messages: [
                {
                  role: 'user',
                  content: agent.buildPositionPrompt(caseData, decisionPoint, { population: false }),
                },
              ],
              tools: [tool],
              tool_choice: { type: 'tool', name: TOOL_NAME },
            };
            entries.push({
              customId,
              slug: dp.slug,
              groupName: group.name,
              archKey: arch.key,
              archLabel: arch.label,
              specialistType,
              runIndex,
            });
            requests.push({ custom_id: customId, params });
          }
        }
      }
    }
  }
  return { entries, requests };
}

/** Parse one batch result into a position object (mirrors statePosition's success/catch shapes). */
function resultToPosition(slug, specialistType, result) {
  const base = { decisionPointId: slug, specialistType };
  if (!result || result.result?.type !== 'succeeded') {
    const why = result?.result?.type || 'no result';
    return {
      ...base,
      stance: 'defer',
      defer: true,
      confidence: 0,
      reasoning: `Position unavailable (${why})`,
      evidenceGrade: 'none',
      error: true,
    };
  }
  const block = (result.result.message?.content || []).find((b) => b.type === 'tool_use');
  const input = block?.input;
  if (!input || typeof input.stance !== 'string') {
    return {
      ...base,
      stance: 'defer',
      defer: true,
      confidence: 0,
      reasoning: 'Position unavailable (no tool_use in response)',
      evidenceGrade: 'none',
      error: true,
    };
  }
  return {
    ...base,
    stance: input.stance,
    defer: input.stance === 'defer',
    confidence: input.confidence,
    reasoning: input.reasoning,
    evidenceGrade: input.evidenceGrade,
  };
}

/**
 * Run the full sweep through the Batches API and return per-(slug, runIndex) verdicts in the
 * exact shape benchmark-probe.js persists (verdict, splitSummary, positions, detail).
 *
 * @param {Array} sample - DB decision_point rows (id, slug, decision_type, canonical_question,
 *   option_a_label, option_b_label)
 * @param {Object} opts - { n, pollMs, model, maxTokens, artifactDir, resumeBatchId }
 * @param {Object} ctx - { specialists: Map }
 * @returns {Promise<Array<{slug, runIndex, verdict, splitSummary, positions, detail}>>}
 */
export async function runBatchProbe(sample, opts, ctx) {
  const { n = 1, pollMs = 15000, model, maxTokens, artifactDir = 'artifacts', resumeBatchId = null } = opts;
  const { specialists } = ctx;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const conference = new CoordinationConference();

  const { entries, requests } = buildEntries(sample, n, specialists, { model, maxTokens });
  logger.info(`batch-probe: ${requests.length} request(s) across ${sample.length} DP(s) × ${n} run(s)`);

  let batchId = resumeBatchId;
  if (!batchId) {
    const batch = await client.beta.messages.batches.create({ requests });
    batchId = batch.id;
    try {
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(
        path.join(artifactDir, `batch-probe-${batchId}.json`),
        JSON.stringify({ batchId, n, count: requests.length, createdAt: batch.created_at }, null, 2)
      );
    } catch (e) {
      logger.warn(`batch-probe: could not persist batch artifact: ${e.message}`);
    }
    console.log(`  › batch submitted: ${batchId} (${requests.length} requests) — resume with --resume-batch ${batchId}`);
  } else {
    console.log(`  › resuming batch ${batchId}`);
  }

  // Poll until ended.
  for (;;) {
    const b = await client.beta.messages.batches.retrieve(batchId);
    const c = b.request_counts || {};
    if (b.processing_status === 'ended') break;
    console.log(
      `  … ${b.processing_status}: processing=${c.processing ?? '?'} succeeded=${c.succeeded ?? '?'} ` +
      `errored=${c.errored ?? '?'} canceled=${c.canceled ?? '?'} expired=${c.expired ?? '?'}`
    );
    await sleep(pollMs);
  }

  // Collect results keyed by custom_id (results arrive unordered).
  const byId = new Map();
  for await (const r of await client.beta.messages.batches.results(batchId)) {
    byId.set(r.custom_id, r);
  }

  // Reassemble: positions per (slug, runIndex, group, archetype) -> conference verdict logic.
  const entryKey = (slug, runIndex, groupName, archKey, specialistType) =>
    `${slug}|${runIndex}|${groupName}|${archKey}|${specialistType}`;
  const positionByKey = new Map();
  for (const e of entries) {
    const pos = resultToPosition(e.slug, e.specialistType, byId.get(e.customId));
    positionByKey.set(entryKey(e.slug, e.runIndex, e.groupName, e.archKey, e.specialistType), pos);
  }

  const out = [];
  for (const dp of sample) {
    const decisionPoint = {
      id: dp.slug,
      question: dp.canonical_question,
      options: [dp.option_a_label, dp.option_b_label],
    };
    const groups = archetypeGroupsForDecisionType(dp.decision_type);

    for (let runIndex = 1; runIndex <= n; runIndex++) {
      const groupResults = groups.map((group) => {
        const archetypeResults = group.set.map((arch) => {
          const positions = POSITION_SPECIALISTS
            .map((type) => positionByKey.get(entryKey(dp.slug, runIndex, group.name, arch.key, type)))
            .filter(Boolean);
          // Reuse the conference's exact divergence + summary logic.
          const divs = conference.detectDivergence([decisionPoint], positions);
          const summary = conference.summarizeDecisionPoint(
            decisionPoint,
            positions,
            divs.find((d) => d.decisionPoint.id === decisionPoint.id) || null
          );
          return {
            key: arch.key,
            label: arch.label,
            verdict: summary.verdict,
            stanceCounts: summary.splitSummary.stanceCounts,
            deferredCount: summary.splitSummary.deferredCount,
            positions: summary.positions,
          };
        });
        return { name: group.name, flip: computeArchetypeFlipVerdict(archetypeResults, { minModalSupport: group.minModalSupport }), archetypeResults };
      });

      // Aggregate via the SHARED combine (identical to the live production path + sync benchmark probe).
      const { verdict, splitSummary, positions, detail } = aggregateSweep(groupResults);

      out.push({ slug: dp.slug, runIndex, verdict, splitSummary, positions, detail });
    }
  }

  return out;
}

/** Count batch requests for a sample at N runs (for dry-run cost estimate; no DB/LLM). */
export function countBatchRequests(sample, n) {
  let total = 0;
  for (const dp of sample) {
    const groups = archetypeGroupsForDecisionType(dp.decision_type);
    const archetypesPerRun = groups.reduce((s, g) => s + g.set.length, 0);
    total += archetypesPerRun * POSITION_SPECIALISTS.length * n;
  }
  return total;
}

export default runBatchProbe;
