/**
 * Shared batch transport for the validation harnesses (Anthropic Message Batches, 50% off). Both the
 * masked-evidence and cue-injection harnesses build (system, user, options) triples and run them here.
 * The position tool mirrors makePositionSchema so responses parse identically to the detector path.
 */
import Anthropic from '@anthropic-ai/sdk';
import { canonicalize } from '../detector/option-order.js';

const TOOL_NAME = 'specialist_position';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function positionTool(options) {
  return {
    name: TOOL_NAME,
    description: 'Record your structured clinical position on this decision point.',
    input_schema: {
      type: 'object',
      properties: {
        reasoning: { type: 'string', description: 'FIRST reason through this case, 2-4 sentences.' },
        stance: { type: 'string', enum: [...options, 'defer'], description: 'the option your reasoning leads you to, matching one provided option exactly; or "defer".' },
        confidence: { type: 'number', description: 'your confidence in this stance, 0-1' },
        evidenceGrade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'none'], description: 'strength of evidence supporting your stance' },
      },
      required: ['reasoning', 'stance', 'confidence', 'evidenceGrade'],
    },
  };
}

/**
 * @param {Array<{custom_id, system, user, options, model, maxTokens}>} specs
 * @returns {Array} batch request payloads
 */
export function toRequests(specs) {
  return specs.map((s) => ({
    custom_id: s.custom_id,
    params: {
      model: s.model,
      max_tokens: s.maxTokens,
      temperature: 0.3,
      system: s.system,
      messages: [{ role: 'user', content: s.user }],
      tools: [positionTool(s.options)],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    },
  }));
}

/** Parse one result to {stance('A'|'B'|'defer'|'unknown'), confidence, evidenceGrade}. */
export function parseResult(result, canonicalOptions) {
  if (!result || result.result?.type !== 'succeeded') return { stance: 'defer', confidence: 0, evidenceGrade: 'none', error: true };
  const block = (result.result.message?.content || []).find((b) => b.type === 'tool_use');
  const input = block?.input;
  if (!input || typeof input.stance !== 'string') return { stance: 'defer', confidence: 0, evidenceGrade: 'none', error: true };
  return {
    stance: canonicalize(input.stance, canonicalOptions),
    confidence: typeof input.confidence === 'number' ? input.confidence : 0,
    evidenceGrade: input.evidenceGrade || 'none',
  };
}

/** Submit + poll a validation batch; returns a Map custom_id -> raw result. */
export async function runValidationBatch(requests, { pollMs = 15000, resumeBatchId = null } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let batchId = resumeBatchId;
  if (!batchId) {
    const batch = await client.beta.messages.batches.create({ requests });
    batchId = batch.id;
    console.log(`  › validation batch submitted: ${batchId} (${requests.length} requests)`);
  }
  for (;;) {
    const b = await client.beta.messages.batches.retrieve(batchId);
    if (b.processing_status === 'ended') break;
    const c = b.request_counts || {};
    console.log(`  … ${b.processing_status}: succeeded=${c.succeeded ?? '?'} errored=${c.errored ?? '?'}`);
    await sleep(pollMs);
  }
  const byId = new Map();
  for await (const r of await client.beta.messages.batches.results(batchId)) byId.set(r.custom_id, r);
  return { byId, batchId };
}
