/**
 * Haiku-assisted provisional relabeling for the anchor-set migration (cached / replay-first).
 *
 * Two judgment calls the mechanical mapping can't make, proposed here for the MD to ratify:
 *   (a) evidence_split vs equivalent_options for the which-option genuine cases, and
 *   (b) controversy_stratum (editorialized vs quietly_contested) for every contested case.
 *
 * Cost: ~one Haiku call per contested case (~90), well under $1, via the Message Batches API (50% off).
 * REPLAY-FIRST: results are cached to artifacts/anchor-relabel/judgments.json (gitignored). Re-runs read
 * the cache for free; only `--submit` (submit:true) spends. Without a cache and without submit, returns
 * an EMPTY map so the migration falls back to the offline heuristic — nothing here ever blocks.
 *
 * proposed_by:'llm_haiku' is stamped on results so the packet flags these as model proposals.
 */
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deterministicLabel, OPTION_DECISION_TYPES } from './lib/mapping.mjs';

const CACHE_DIR = join(process.cwd(), 'artifacts', 'anchor-relabel');
const CACHE_FILE = join(CACHE_DIR, 'judgments.json');
const FAST_MODEL = process.env.FAST_MODEL || 'claude-haiku-4-5-20251001';
const TOOL_NAME = 'anchor_judgment';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function judgmentTool(isOptionCase) {
  const props = {
    controversy_stratum: {
      type: 'string',
      enum: ['editorialized', 'quietly_contested'],
      description:
        'Is this a FAMOUS/editorialized debate (named landmark trials, eponymous techniques, well-known public controversy) or a QUIETLY contested one (guideline discordance / practice variation with no famous debate)?',
    },
    rationale: { type: 'string', description: 'one sentence justifying the stratum (and label if asked)' },
  };
  const required = ['controversy_stratum', 'rationale'];
  if (isOptionCase) {
    props.label_choice = {
      type: 'string',
      enum: ['evidence_split', 'equivalent_options'],
      description:
        'evidence_split = the literature is genuinely CONFLICTING on which option is better (one may win, unknown which). equivalent_options = the options are genuinely EQUIVALENT (P(one superior to the other) ≈ 0.5; randomizing would be ethical) even though a forced pick would look confident.',
    };
    required.unshift('label_choice');
  }
  return {
    name: TOOL_NAME,
    description: 'Record the provisional equipoise sub-classification for this orthopedic decision.',
    input_schema: { type: 'object', properties: props, required },
  };
}

function contestedRows(rows) {
  return rows.filter((r) => deterministicLabel(r).label !== 'settled');
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return new Map();
  const obj = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  return new Map(Object.entries(obj));
}

function saveCache(map) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(map), null, 2) + '\n');
}

/**
 * @param {Array} rows - parsed CSV rows
 * @param {{submit?:boolean, pollMs?:number}} opts
 * @returns {Promise<Map<string,{label?:string, stratum:string, proposedBy:string, rationale:string}>>}
 */
export async function resolveLlmJudgments(rows, { submit = false, pollMs = 15000 } = {}) {
  const cache = loadCache();
  const contested = contestedRows(rows);
  const missing = contested.filter((r) => !cache.has(r.slug));

  if (missing.length === 0) {
    console.log(`  relabel-llm: all ${contested.length} contested cases served from cache (free)`);
    return cache;
  }
  if (!submit) {
    console.log(
      `  relabel-llm: ${missing.length}/${contested.length} contested cases NOT cached and --submit not set → falling back to heuristic for those. Re-run with --submit to spend (~$1).`
    );
    return cache;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const requests = missing.map((r) => {
    const isOption = OPTION_DECISION_TYPES.includes(r.decision_type);
    return {
      custom_id: `relabel-${r.slug}`.slice(0, 64),
      params: {
        model: FAST_MODEL,
        max_tokens: 400,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content:
              `Decision: ${r.canonical_question}\nOptions: (1) ${r.option_a_label}  (2) ${r.option_b_label}\n` +
              `Body region: ${r.body_region}. Rationale on file: ${r.equipoise_rationale || '(none)'}\n\n` +
              `Classify this contested orthopedic decision using the tool.`,
          },
        ],
        tools: [judgmentTool(isOption)],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      },
    };
  });

  console.log(`  relabel-llm: submitting ${requests.length} Haiku request(s)…`);
  const batch = await client.beta.messages.batches.create({ requests });
  for (;;) {
    const b = await client.beta.messages.batches.retrieve(batch.id);
    if (b.processing_status === 'ended') break;
    const c = b.request_counts || {};
    console.log(`  … ${b.processing_status}: succeeded=${c.succeeded ?? '?'} errored=${c.errored ?? '?'}`);
    await sleep(pollMs);
  }

  const bySlug = new Map();
  for await (const res of await client.beta.messages.batches.results(batch.id)) {
    const slug = res.custom_id.replace(/^relabel-/, '');
    if (res.result?.type !== 'succeeded') continue;
    const block = (res.result.message?.content || []).find((b) => b.type === 'tool_use');
    if (!block?.input) continue;
    bySlug.set(slug, block.input);
  }

  for (const r of missing) {
    const j = bySlug.get(r.slug);
    if (!j) continue; // errored request → leave uncached → heuristic fallback
    cache.set(r.slug, {
      label: j.label_choice || undefined,
      stratum: j.controversy_stratum,
      proposedBy: 'llm_haiku',
      rationale: j.rationale || '',
      sourceCitations: [],
    });
  }
  saveCache(cache);
  console.log(`  relabel-llm: cached ${bySlug.size} judgment(s) → ${CACHE_FILE}`);
  return cache;
}

export default resolveLlmJudgments;
