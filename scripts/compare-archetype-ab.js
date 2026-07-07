#!/usr/bin/env node
/**
 * A/B comparison for the low_demand_high_risk archetype wording change (no LLM, no writes).
 *
 * Baseline verdicts live under run_kind='benchmark_probe'; the candidate re-probe (new archetype
 * wording) lands under run_kind='sham_control' for the SAME slugs. This prints, per slug, the
 * baseline vs candidate per-slug majority verdict, and rolls up the effect on the specificity arm
 * (settled non-absolute) and the sensitivity arm (genuine equipoise).
 *
 *   BENCH_URL=$DATABASE_URL node scripts/compare-archetype-ab.js
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const BENCH = process.env.BENCH_URL || process.env.DATABASE_URL;
const sql = neon(BENCH);
const majority = (vs) => (vs.filter((v) => v === 'contested').length * 2 >= vs.length ? 'contested' : 'converged');

const rows = await sql`
  SELECT dp.slug, dp.expected_equipoise AS label, COALESCE(dp.absolute_indication,false) AS abs,
         pr.run_kind AS kind, pr.detector_verdict AS v
  FROM decision_points dp
  JOIN panel_runs pr ON pr.decision_point_id = dp.id
  WHERE dp.is_active = true AND pr.run_kind IN ('benchmark_probe','sham_control')`;

const bySlug = new Map();
for (const r of rows) {
  if (!bySlug.has(r.slug)) bySlug.set(r.slug, { label: r.label, abs: r.abs, base: [], cand: [] });
  (r.kind === 'sham_control' ? bySlug.get(r.slug).cand : bySlug.get(r.slug).base).push(r.v);
}

// Only slugs that have candidate (sham_control) runs are in the validation set.
const val = [...bySlug.entries()].filter(([, d]) => d.cand.length > 0);

const wantOf = (label) => (label === 'genuine_equipoise' ? 'contested' : 'converged'); // the correct verdict
let specFixed = 0, specStill = 0, specRegressed = 0;
let sensHeld = 0, sensLost = 0, sensGained = 0;
const changes = [];
for (const [slug, d] of val) {
  const b = majority(d.base), c = majority(d.cand);
  const want = wantOf(d.label);
  const arm = d.label === 'genuine_equipoise' ? 'sens' : (d.abs ? 'abs' : 'spec');
  if (b !== c) changes.push({ slug, label: d.label, arm, base: b, cand: c, want });
  if (arm === 'spec') {
    if (c === want && b !== want) specFixed++;
    else if (c !== want && b !== want) specStill++;
    else if (c !== want && b === want) specRegressed++;
  } else if (arm === 'sens') {
    if (c === want && b === want) sensHeld++;
    else if (c !== want && b === want) sensLost++;
    else if (c === want && b !== want) sensGained++;
  }
}

console.log('validation slugs with candidate runs:', val.length, '\n');
console.log('SPECIFICITY arm (settled, non-absolute):');
console.log('  false-positives FIXED (contested→converged):', specFixed);
console.log('  still false-positive:', specStill);
console.log('  NEW regressions (converged→contested):', specRegressed);
console.log('\nSENSITIVITY arm (genuine equipoise):');
console.log('  retained (still contested):', sensHeld);
console.log('  LOST (contested→converged):', sensLost);
console.log('  gained (converged→contested):', sensGained);

console.log('\nper-slug changes (baseline → candidate):');
for (const c of changes.sort((a, b) => a.arm.localeCompare(b.arm) || a.slug.localeCompare(b.slug))) {
  const good = c.cand === c.want ? '✓ now-correct' : '✗ now-wrong';
  console.log(`  [${c.arm}/${c.label}] ${c.slug}: ${c.base} → ${c.cand}  ${good}`);
}
if (!changes.length) console.log('  (no per-slug verdict changes)');

// Projected full-benchmark specificity/sensitivity if we adopt the candidate for these slugs.
console.log('\nnote: run scripts/eval-flip-rules.js + equipoise-audit.js for full-benchmark roll-up once adopted.');
