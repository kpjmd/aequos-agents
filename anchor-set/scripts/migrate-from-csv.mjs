#!/usr/bin/env node
/**
 * Migrate the legacy curated benchmark (db/seeds/decision-points.csv + overlays) into the anchor set
 * (anchor-set/cases/<slug>.json), applying the deterministic label mapping and provisional judgment
 * proposals. Every emitted case is review_status:'provisional' — the MD ratifies later from the packet.
 *
 *   node anchor-set/scripts/migrate-from-csv.mjs               # DRY RUN — summarize, write nothing
 *   node anchor-set/scripts/migrate-from-csv.mjs --write       # write cases/ + refresh MANIFEST
 *   node anchor-set/scripts/migrate-from-csv.mjs --write --llm # use cached Haiku proposals if present
 *   node anchor-set/scripts/migrate-from-csv.mjs --write --llm --submit  # spend: run the Haiku batch
 *
 * Files-first: the cases/ files become the source of truth. The seeder later PROJECTS from them onto
 * the DB (additive columns) and never writes back here.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDecisionPoints } from '../../db/seeds/load-decision-points.js';
import { readFileSync } from 'node:fs';
import { rowToCase, deterministicLabel, heuristicOptionClass, heuristicStratum } from './lib/mapping.mjs';
import { resolveLlmJudgments } from './relabel-llm.mjs';
import { writeReviewPacket } from './review-packet.mjs';
import { SCHEMA_VERSION } from '../schema/case-schema.js';
import { CASES_DIR } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS = join(__dirname, '..', '..', 'db', 'seeds');
const REVIEWER = 'kpjohnsonmd';

const args = process.argv.slice(2);
const doWrite = args.includes('--write');
const useLlm = args.includes('--llm');
const submit = args.includes('--submit');

const rows = loadDecisionPoints();
const absolute = new Set(JSON.parse(readFileSync(join(SEEDS, 'absolute-indications.json'), 'utf8')));
const pediatric = new Set(JSON.parse(readFileSync(join(SEEDS, 'pediatric-indications.json'), 'utf8')));

// Heuristic judgments (always available, free). label/stratum for every row that needs one.
const heuristic = new Map();
for (const row of rows) {
  heuristic.set(row.slug, {
    label: heuristicOptionClass(row),
    stratum: heuristicStratum(row),
    proposedBy: 'deterministic',
    rationale: null,
    sourceCitations: [],
  });
}

// Optionally overlay LLM proposals (Haiku batch, cached/replayable). Falls back to heuristic per-field.
let judgments = heuristic;
if (useLlm) {
  const llm = await resolveLlmJudgments(rows, { submit });
  judgments = new Map();
  for (const row of rows) {
    const h = heuristic.get(row.slug);
    const l = llm.get(row.slug);
    judgments.set(row.slug, l ? { ...h, ...l } : h);
  }
}

const cases = rows.map((row) =>
  rowToCase(
    row,
    { absolute: absolute.has(row.slug), pediatric: pediatric.has(row.slug) },
    judgments.get(row.slug),
    { reviewer: REVIEWER, schemaVersion: SCHEMA_VERSION }
  )
);

// ---- summary ----
const byLabel = {};
const byStratum = {};
let needsJudgment = 0;
for (const c of cases) {
  byLabel[c.label] = (byLabel[c.label] || 0) + 1;
  byStratum[c.controversy_stratum] = (byStratum[c.controversy_stratum] || 0) + 1;
}
for (const row of rows) if (deterministicLabel(row).needsJudgment) needsJudgment++;

console.log(`migrate-from-csv: ${rows.length} rows -> ${cases.length} cases (${useLlm ? (submit ? 'LLM batch' : 'LLM cached') : 'heuristic'} judgments)`);
console.log('  label:', JSON.stringify(byLabel));
console.log('  stratum:', JSON.stringify(byStratum));
console.log(`  which-option cases needing evidence_split/equivalent_options judgment: ${needsJudgment}`);

if (!doWrite) {
  console.log('\nDRY RUN — no files written. Re-run with --write to populate anchor-set/cases/.');
  process.exit(0);
}

mkdirSync(CASES_DIR, { recursive: true });
for (const c of cases) {
  writeFileSync(join(CASES_DIR, `${c.id}.json`), JSON.stringify(c, null, 2) + '\n');
}
console.log(`\n✓ wrote ${cases.length} case files to anchor-set/cases/`);

// Refresh MANIFEST and emit the MD review packet.
const { anchor_set_version } = await import('../index.js').then((m) => m.loadManifest() || {});
writeReviewPacket(cases, { version: anchor_set_version || '0.1.0-provisional' });
console.log('  (run `node anchor-set/scripts/build-manifest.mjs` to refresh counts, then `npm run anchor-set:validate`)');
