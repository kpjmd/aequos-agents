/**
 * Shared batch transport for the validation harnesses (Anthropic Message Batches, 50% off). Both the
 * masked-evidence and cue-injection harnesses build (system, user, options) triples and run them here.
 * The position tool mirrors makePositionSchema so responses parse identically to the detector path.
 */
import Anthropic from '@anthropic-ai/sdk';
import { canonicalize } from '../detector/option-order.js';

const TOOL_NAME = 'specialist_position';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Transient HTTP statuses worth retrying (gateway/overload/rate-limit); network errors carry no status.
const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/**
 * Retry a call on transient failures with exponential backoff. Used around batch create/poll/results so
 * a single Cloudflare 502 or overload doesn't sink (or orphan) a submitted batch. A non-transient error
 * (4xx auth/validation) throws immediately.
 * @param {Function} fn
 * @param {{tries?:number, baseMs?:number, label?:string}} [opts]
 */
export async function withRetry(fn, { tries = 5, baseMs = 2000, label = 'request' } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const status = e?.status;
      const transient = status ? TRANSIENT_STATUS.has(status) : true; // no status → network/timeout → transient
      if (!transient || i === tries - 1) throw e;
      const wait = baseMs * 2 ** i;
      console.log(`  ⚠︎ ${label} failed (${status || e?.code || 'network'}), retry ${i + 1}/${tries - 1} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

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
    const batch = await withRetry(() => client.beta.messages.batches.create({ requests }), { label: 'batch create' });
    batchId = batch.id;
    console.log(`  › validation batch submitted: ${batchId} (${requests.length} requests)`);
  }
  for (;;) {
    const b = await withRetry(() => client.beta.messages.batches.retrieve(batchId), { label: 'batch poll' });
    if (b.processing_status === 'ended') break;
    const c = b.request_counts || {};
    console.log(`  … ${b.processing_status}: succeeded=${c.succeeded ?? '?'} errored=${c.errored ?? '?'}`);
    await sleep(pollMs);
  }
  const byId = new Map();
  const stream = await withRetry(() => client.beta.messages.batches.results(batchId), { label: 'batch results' });
  for await (const r of stream) byId.set(r.custom_id, r);
  return { byId, batchId };
}
