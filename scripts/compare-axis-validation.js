#!/usr/bin/env node
/**
 * Phase B validation: pediatric + non-surgical archetype axes (no LLM, no writes).
 *
 * Baseline verdicts (adult demand/surgical-risk axis) live under run_kind='benchmark_probe'; the
 * axis-routed re-probe (pediatric / non_surgical axes + low-demand wording) lands under
 * run_kind='reproducibility' for the same ~19 DPs. Prints per-slug baseline→candidate and whether the
 * new axis moved each toward its correct label.
 *
 *   BENCH_URL=$DATABASE_URL node scripts/compare-axis-validation.js
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.BENCH_URL || process.env.DATABASE_URL);
const majority = (vs) => (vs.filter((v) => v === 'contested').length * 2 >= vs.length ? 'contested' : 'converged');
const want = (label) => (label === 'genuine_equipoise' ? 'contested' : 'converged');

const rows = await sql`
  SELECT dp.slug, dp.expected_equipoise AS label, COALESCE(dp.absolute_indication,false) AS abs,
         dp.is_pediatric AS peds, dp.is_operative AS op, pr.run_kind AS kind, pr.detector_verdict AS v
  FROM decision_points dp
  JOIN panel_runs pr ON pr.decision_point_id = dp.id
  WHERE dp.is_active = true AND pr.run_kind IN ('benchmark_probe','reproducibility')`;

const bySlug = new Map();
for (const r of rows) {
  if (!bySlug.has(r.slug)) bySlug.set(r.slug, { ...r, base: [], cand: [] });
  (r.kind === 'reproducibility' ? bySlug.get(r.slug).cand : bySlug.get(r.slug).base).push(r.v);
}
const val = [...bySlug.entries()].filter(([, d]) => d.cand.length > 0);

let improved = 0, heldCorrect = 0, stillWrong = 0, regressed = 0;
const lines = [];
for (const [slug, d] of val) {
  if (d.label === 'evolving') continue;
  const b = majority(d.base), c = majority(d.cand), w = want(d.label);
  const axis = d.peds ? 'peds' : (d.op === false ? 'nonsurg' : 'adult');
  const bOk = b === w, cOk = c === w;
  let tag;
  if (!bOk && cOk) { tag = '✅ FIXED'; improved++; }
  else if (bOk && cOk) { tag = '·  held-correct'; heldCorrect++; }
  else if (!bOk && !cOk) { tag = '✗  still-wrong'; stillWrong++; }
  else { tag = '⚠️  REGRESSED'; regressed++; }
  lines.push(`  [${axis}/${d.label}] ${slug}: ${b}→${c} (want ${w})  ${tag}`);
}
console.log('axis-validation slugs (with candidate runs):', val.length, '\n');
console.log('FIXED (baseline wrong → candidate correct):', improved);
console.log('held-correct:', heldCorrect);
console.log('still-wrong:', stillWrong);
console.log('REGRESSED (baseline correct → candidate wrong):', regressed, '\n');
lines.sort();
lines.forEach((l) => console.log(l));
