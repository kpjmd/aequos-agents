#!/usr/bin/env node
/**
 * Validate the anchor set: schema conformance + stratum completeness + coverage report.
 *
 * Pure — no DB, no LLM. Exits non-zero (loudly) on any failure so it can gate CI / the seed pipeline.
 *
 *   npm run anchor-set:validate
 *
 * The heavy lifting (per-case schema + the settled<->stratum invariant) lives in
 * anchor-set/schema/case-schema.js so the jest suite checks the exact same rules. This script adds
 * the SET-level checks a single case can't express: all four label classes present, both contested
 * strata represented, and MANIFEST.case_count matching the files on disk.
 */
import { validateCase, LABELS, CONTESTED_LABELS } from '../schema/case-schema.js';
import { runSetValidation } from './validate-lib.mjs';
import { loadCases, loadManifest } from '../index.js';

const cases = loadCases();
const manifest = loadManifest();
const report = runSetValidation(cases, manifest, { validateCase, LABELS, CONTESTED_LABELS });

// ---- report ----
console.log(`anchor-set validation — ${cases.length} case file(s)\n`);

if (report.schemaErrors.length) {
  console.log(`✗ ${report.schemaErrors.length} case(s) failed schema:`);
  for (const e of report.schemaErrors.slice(0, 40)) {
    console.log(`   ${e.id}: ${e.errors.join('; ')}`);
  }
  if (report.schemaErrors.length > 40) console.log(`   … and ${report.schemaErrors.length - 40} more`);
  console.log('');
}

console.log('label coverage:');
for (const l of LABELS) console.log(`  ${l.padEnd(20)} ${report.labelCounts[l] || 0}`);
console.log('');
console.log('controversy stratum (contested cases):');
for (const [k, v] of Object.entries(report.stratumCounts)) console.log(`  ${k.padEnd(20)} ${v}`);
console.log('');
console.log(`active (adult): ${report.activeCount}   pediatric-excluded: ${report.pediatricCount}`);
console.log('');

if (report.errors.length) {
  console.log('✗ SET-LEVEL FAILURES:');
  for (const e of report.errors) console.log(`   ${e}`);
}

if (report.ok) {
  console.log('\nANCHOR SET OK ✅');
  process.exit(0);
} else {
  console.log('\nANCHOR SET INVALID ❌');
  process.exit(1);
}
