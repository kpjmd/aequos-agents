#!/usr/bin/env node
/**
 * Recompute anchor-set/MANIFEST.json from the current cases/ directory.
 *
 * MANIFEST is the version + count spine every downstream result is stamped against. The
 * anchor_set_version is bumped deliberately by the curator (append/relabel), NOT auto-incremented
 * here — this script only recomputes the derived fields (case_count, per-label breakdown, git rev)
 * and preserves the existing anchor_set_version unless --version is passed.
 *
 *   node anchor-set/scripts/build-manifest.mjs                 # refresh counts, keep version
 *   node anchor-set/scripts/build-manifest.mjs --version 0.2.0-provisional
 */
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadCases, loadManifest, MANIFEST_PATH } from '../index.js';
import { SCHEMA_VERSION, LABELS } from '../schema/case-schema.js';

const args = process.argv.slice(2);
const versionArg = args.includes('--version') ? args[args.indexOf('--version') + 1] : null;

function gitRev() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const cases = loadCases();
const prev = loadManifest();
const anchor_set_version = versionArg || prev?.anchor_set_version || '0.1.0-provisional';

const byLabel = Object.fromEntries(LABELS.map((l) => [l, 0]));
let active = 0;
let pediatric = 0;
for (const c of cases) {
  byLabel[c.label] = (byLabel[c.label] || 0) + 1;
  if (c.provenance?.is_pediatric) pediatric++;
  else active++;
}

const manifest = {
  anchor_set_version,
  schema_version: SCHEMA_VERSION,
  case_count: cases.length,
  active_case_count: active,
  pediatric_excluded_count: pediatric,
  label_breakdown: byLabel,
  source_git_rev: gitRev(),
  // generated_at intentionally omitted from the manifest body — a timestamp would make the file
  // churn on every rebuild and defeat the "immutable/append-mostly, clean git diffs" goal. Git
  // history IS the timestamp record.
};

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ MANIFEST.json written: ${anchor_set_version}, ${cases.length} cases (${active} active / ${pediatric} pediatric-excluded)`);
console.log('  labels:', JSON.stringify(byLabel));
