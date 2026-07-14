/**
 * Batch transport for the unified detector — Anthropic Message Batches (flat 50% off), mirroring
 * src/utils/batch-probe.js but over the unified grid (adds the option_order + replicate dimensions).
 *
 * Correctness: the position prompt + tool are built from the ORDERED options (so the model genuinely
 * sees A/B swapped), but every returned stance is normalized back to the CANONICAL option via
 * option-order.canonicalize — so lability reflects a real order effect, not a parsing artifact.
 *
 * Imports the DEMAND_RISK archetype DATA only (never archetypeGroupsForDecisionType — no router).
 */
import Anthropic from '@anthropic-ai/sdk';
import { AGENTS, buildGridPoints } from './grid.js';
import { orderedOptions, canonicalize } from './option-order.js';
import { modelForAgent, DEFAULT_COMPOSITION } from './panel-composition.js';

const TOOL_NAME = 'specialist_position';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Position tool whose enum mirrors makePositionSchema(options) — descriptions copied from batch-probe.js. */
function positionTool(options) {
  return {
    name: TOOL_NAME,
    description: 'Record your structured clinical position on this decision point.',
    input_schema: {
      type: 'object',
      properties: {
        reasoning: { type: 'string', description: 'FIRST reason through THIS case from your specialty lens — what does your expertise specifically weigh here, and which way does it point? Argue from your domain, not from generic caution. 2-4 sentences.' },
        stance: { type: 'string', enum: [...options, 'defer'], description: 'AFTER your reasoning, the option your reasoning leads you to, matching one provided option exactly; or "defer" only if this decision is genuinely outside your lens or the evidence is truly insufficient. Do not pick an option merely because it sounds safest.' },
        confidence: { type: 'number', description: 'your confidence in this stance, 0-1' },
        evidenceGrade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'none'], description: 'strength of evidence supporting your stance (A strongest; "none" if defer)' },
      },
      required: ['reasoning', 'stance', 'confidence', 'evidenceGrade'],
    },
  };
}

/** Agents that can build a position prompt (real agent instances, from the specialists Map). */
function usableAgents(specialists) {
  return AGENTS.map((type) => [type, specialists.get(type)]).filter(
    ([, a]) => a && typeof a.buildPositionPrompt === 'function'
  );
}

/**
 * Build all batch requests for a set of anchor cases.
 *
 * The per-request model is resolved per agent slot via the composition: personas_single_model (and
 * the not-yet-wired temperature/cross-provider rungs) use the single `model` for every slot, while
 * same_family_multi_version assigns a distinct Claude model per specialist. All models remain
 * Anthropic, so this is still ONE Message Batch.
 * @param {Array<{id, decision_point, options:string[]}>} cases
 * @param {{replicates, model, maxTokens, composition}} opts
 * @param {{specialists:Map}} ctx
 * @returns {{entries:Array, requests:Array}}
 */
export function buildRequests(cases, { replicates, model, maxTokens, composition = DEFAULT_COMPOSITION }, { specialists }) {
  const agents = usableAgents(specialists);
  const points = buildGridPoints(replicates);
  const entries = [];
  const requests = [];
  let i = 0;

  for (const c of cases) {
    for (const p of points) {
      const shown = orderedOptions(c.options, p.order); // options as the model will see them
      const decisionPoint = { id: c.id, question: c.decision_point, options: shown };
      const tool = positionTool(shown);
      const caseData = { archetype: p.archetype.label, ...p.archetype.case };
      for (const [agent, inst] of agents) {
        const customId = `req-${i++}`;
        const agentModel = modelForAgent(composition, agent, model);
        entries.push({ customId, caseId: c.id, archetypeKey: p.archetypeKey, replicate: p.replicate, order: p.order, agent, model: agentModel });
        requests.push({
          custom_id: customId,
          params: {
            model: agentModel,
            max_tokens: maxTokens,
            temperature: 0.3, // match base-agent.js this.llm — iid replicate draws (no API seed)
            system: inst.getSystemPrompt(),
            messages: [{ role: 'user', content: inst.buildPositionPrompt(caseData, decisionPoint, { population: false }) }],
            tools: [tool],
            tool_choice: { type: 'tool', name: TOOL_NAME },
          },
        });
      }
    }
  }
  return { entries, requests };
}

/** Total request count (dry-run cost estimate). */
export function countRequests(cases, replicates, specialists) {
  const nAgents = specialists ? usableAgents(specialists).length : AGENTS.length;
  return cases.length * buildGridPoints(replicates).length * nAgents;
}

function resultToCell(entry, canonicalOptions, result) {
  const base = { caseId: entry.caseId, archetypeKey: entry.archetypeKey, replicate: entry.replicate, order: entry.order, agent: entry.agent };
  if (!result || result.result?.type !== 'succeeded') {
    return { ...base, stance: 'defer', confidence: 0, evidenceGrade: 'none', error: true };
  }
  const block = (result.result.message?.content || []).find((b) => b.type === 'tool_use');
  const input = block?.input;
  if (!input || typeof input.stance !== 'string') {
    return { ...base, stance: 'defer', confidence: 0, evidenceGrade: 'none', error: true };
  }
  return {
    ...base,
    stance: canonicalize(input.stance, canonicalOptions), // 'A' | 'B' | 'defer' | 'unknown'
    confidence: typeof input.confidence === 'number' ? input.confidence : 0,
    evidenceGrade: input.evidenceGrade || 'none',
  };
}

/**
 * Submit the batch, poll, and return cells grouped by caseId.
 * @returns {Promise<{cellsByCase:Map<string,Array>, batchId:string}>}
 */
export async function runBatch(cases, opts, ctx) {
  const { replicates, model, maxTokens, composition = DEFAULT_COMPOSITION, pollMs = 15000, resumeBatchId = null } = opts;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { entries, requests } = buildRequests(cases, { replicates, model, maxTokens, composition }, ctx);

  let batchId = resumeBatchId;
  if (!batchId) {
    const batch = await client.beta.messages.batches.create({ requests });
    batchId = batch.id;
    console.log(`  › detector batch submitted: ${batchId} (${requests.length} requests) — resume with --resume-batch ${batchId}`);
  } else {
    console.log(`  › resuming detector batch ${batchId}`);
  }

  for (;;) {
    const b = await client.beta.messages.batches.retrieve(batchId);
    const c = b.request_counts || {};
    if (b.processing_status === 'ended') break;
    console.log(`  … ${b.processing_status}: succeeded=${c.succeeded ?? '?'} errored=${c.errored ?? '?'}`);
    await sleep(pollMs);
  }

  const byId = new Map();
  for await (const r of await client.beta.messages.batches.results(batchId)) byId.set(r.custom_id, r);

  const optionsByCase = new Map(cases.map((c) => [c.id, c.options]));
  const cellsByCase = new Map(cases.map((c) => [c.id, []]));
  for (const e of entries) {
    const cell = resultToCell(e, optionsByCase.get(e.caseId), byId.get(e.customId));
    cellsByCase.get(e.caseId).push(cell);
  }
  return { cellsByCase, batchId };
}
