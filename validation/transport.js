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

/** True for connection truncations the SDK surfaces as a 400 but are really network-transient. */
function isPrematureClose(e) {
  return /premature close|socket hang up|econnreset|terminated|network|fetch failed/i.test(e?.message || '');
}

/** List recent batch ids (best-effort; [] on failure so callers can still proceed). */
async function recentBatchIds(client) {
  try {
    const l = await client.beta.messages.batches.list({ limit: 20 });
    return l.data.map((b) => b.id);
  } catch {
    return [];
  }
}

/** A batch created since `beforeSet` whose request count matches — i.e. a phantom from a truncated create. */
async function findNewBatch(client, beforeSet, reqCount) {
  try {
    const l = await client.beta.messages.batches.list({ limit: 20 });
    for (const b of l.data) {
      if (beforeSet.has(b.id)) continue;
      const rc = b.request_counts || {};
      const total = (rc.processing ?? 0) + (rc.succeeded ?? 0) + (rc.errored ?? 0) + (rc.canceled ?? 0) + (rc.expired ?? 0);
      if (total === reqCount) return b.id;
    }
  } catch { /* ignore — treated as "no phantom found" */ }
  return null;
}

/**
 * Create a batch idempotently under a flaky endpoint. Batch creation is NOT idempotent server-side (no
 * idempotency key), and a "Premature close" can truncate the response AFTER the batch was created — so a
 * blind retry would spawn a duplicate. On any transport error we first LIST batches and ADOPT a newly
 * created one matching our request count; only if none exists do we retry create.
 * @returns {Promise<string>} batchId
 */
export async function createBatchIdempotent(client, requests, { tries = 6, baseMs = 3000 } = {}) {
  const before = new Set(await recentBatchIds(client));
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const batch = await client.beta.messages.batches.create({ requests });
      return batch.id;
    } catch (e) {
      last = e;
      const status = e?.status;
      const transient = isPrematureClose(e) || (status ? TRANSIENT_STATUS.has(status) : true);
      // A truncated create may have landed server-side — adopt it rather than re-create.
      const phantom = await findNewBatch(client, before, requests.length);
      if (phantom) { console.log(`  › adopted batch created despite transport error: ${phantom}`); return phantom; }
      if (!transient || i === tries - 1) throw e;
      const wait = baseMs * 2 ** i;
      console.log(`  ⚠︎ batch create failed (${status || e?.code || 'network'}${isPrematureClose(e) ? ' premature-close' : ''}), no phantom — retry ${i + 1}/${tries - 1} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

/** Submit + poll a validation batch; returns a Map custom_id -> raw result. */
export async function runValidationBatch(requests, { pollMs = 15000, resumeBatchId = null } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let batchId = resumeBatchId;
  if (!batchId) {
    batchId = await createBatchIdempotent(client, requests);
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
