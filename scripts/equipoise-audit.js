#!/usr/bin/env node
/**
 * Equipoise benchmark AUDIT (adversarial-review findings F2 + F5). Read-only against a DB branch
 * holding the benchmark_probe panel_runs. No writes, no LLM.
 *
 *   BENCH_URL=postgres://... node scripts/equipoise-audit.js
 *
 * F2 (label circularity): re-score the SAME stored verdicts under the ORIGINAL Phase-1 labels
 *   (git 58e0560) vs the FINAL post-adjudication labels (current decision_points on the branch). The
 *   gap is the portion of the headline attributable to relabeling the model's own misses rather than
 *   to the model matching an independent ground truth.
 * F5 (no CI): hierarchical bootstrap over the per-slug × per-run verdict matrix → 95% CIs on each
 *   segment's per-slug-majority hit rate (captures BOTH benchmark-composition and run-to-run variance).
 *
 * Original labels come straight from git (no working-tree dependency); final labels + verdicts from
 * the branch DB. Deterministic seeded LCG so the CIs reproduce (Math.random is unavailable here).
 */
import { neon } from '@neondatabase/serverless';
import { execSync } from 'child_process';

const ORIGINAL_REV = '58e0560'; // Phase-1 curated benchmark, pre-adjudication
const N_BOOT = 10000;

function parseCSV(t) {
  const rows = []; let i = 0, f = '', row = [], q = false;
  while (i < t.length) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += c; i++; continue; }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(f); f = ''; i++; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += c; i++;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function originalLabelsFromGit() {
  const csv = execSync(`git show ${ORIGINAL_REV}:db/seeds/decision-points.csv`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = parseCSV(csv); const h = rows[0], si = h.indexOf('slug'), li = h.indexOf('expected_equipoise');
  const m = new Map();
  for (let r = 1; r < rows.length; r++) if (rows[r][si]) m.set(rows[r][si], rows[r][li]);
  return m;
}

const isHit = (label, verdict) =>
  label === 'genuine_equipoise' ? verdict === 'contested'
  : (label === 'settled_conservative' || label === 'settled_operative') ? verdict === 'converged'
  : null;
function segmentOf(label, absolute) {
  if (label === 'genuine_equipoise') return 'sensitivity';
  if (label === 'settled_conservative' || label === 'settled_operative') return absolute ? 'absolute' : 'specificity';
  return null;
}
const majorityOf = (runs) => (runs.filter(v => v === 'contested').length * 2 >= runs.length ? 'contested' : 'converged');
function makeRng(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }

function scoreByLabels(slugRuns, labelOf, absById) {
  const seg = {};
  for (const [slug, runs] of slugRuns) {
    const label = labelOf(slug); if (!label) continue;
    const s = segmentOf(label, absById.get(slug)); if (!s) continue;
    const hit = isHit(label, majorityOf(runs));
    seg[s] ??= { hits: 0, n: 0, misses: [] };
    seg[s].n++; if (hit) seg[s].hits++; else seg[s].misses.push(slug);
  }
  return seg;
}
function bootstrapCI(slugList, slugRuns, labelOf, absById, rng) {
  const rates = { sensitivity: [], specificity: [], absolute: [] };
  for (let b = 0; b < N_BOOT; b++) {
    const acc = {};
    for (let k = 0; k < slugList.length; k++) {
      const slug = slugList[Math.floor(rng() * slugList.length)];
      const s = segmentOf(labelOf(slug), absById.get(slug)); if (!s) continue;
      const runs = slugRuns.get(slug);
      let nC = 0; for (let r = 0; r < runs.length; r++) nC += (runs[Math.floor(rng() * runs.length)] === 'contested') ? 1 : 0;
      const majority = nC * 2 >= runs.length ? 'contested' : 'converged';
      acc[s] ??= { h: 0, n: 0 }; acc[s].n++; if (isHit(labelOf(slug), majority)) acc[s].h++;
    }
    for (const s of Object.keys(rates)) if (acc[s]?.n) rates[s].push(acc[s].h / acc[s].n);
  }
  const ci = {};
  for (const s of Object.keys(rates)) {
    const arr = rates[s].sort((a, b) => a - b);
    ci[s] = arr.length ? { lo: arr[Math.floor(0.025 * arr.length)], hi: arr[Math.floor(0.975 * arr.length)] } : null;
  }
  return ci;
}

async function main() {
  if (!process.env.BENCH_URL) { console.error('Set BENCH_URL to the branch holding benchmark_probe runs.'); process.exit(1); }
  const sql = neon(process.env.BENCH_URL);

  const rows = await sql`
    SELECT dp.slug, dp.absolute_indication, dp.expected_equipoise, pr.run_index, pr.detector_verdict
    FROM panel_runs pr JOIN decision_points dp ON dp.id = pr.decision_point_id
    WHERE pr.run_kind = 'benchmark_probe'`;
  if (rows.length === 0) {
    console.error('No benchmark_probe runs on this branch. Regenerate first:');
    console.error('  DATABASE_URL=$BENCH_URL npm run benchmark:probe -- --all --n 3 --batch');
    process.exit(2);
  }

  const slugRuns = new Map(), absById = new Map(), finalLabel = new Map();
  for (const r of rows) {
    if (!slugRuns.has(r.slug)) slugRuns.set(r.slug, []);
    slugRuns.get(r.slug).push(r.detector_verdict);
    absById.set(r.slug, r.absolute_indication);
    finalLabel.set(r.slug, r.expected_equipoise);
  }
  const perSlug = [...slugRuns.values()].map(v => v.length);
  console.log(`\nbenchmark_probe: ${slugRuns.size} slugs, ${rows.length} runs (per-slug N: ${Math.min(...perSlug)}..${Math.max(...perSlug)})\n`);

  const original = originalLabelsFromGit();
  const so = scoreByLabels(slugRuns, s => original.get(s), absById);
  const sf = scoreByLabels(slugRuns, s => finalLabel.get(s), absById);
  const pct = (o) => o ? `${o.hits}/${o.n} = ${(o.hits / o.n).toFixed(3)}` : '(none)';
  console.log(`F2 — SAME stored verdicts, scored under two label sets:`);
  console.log(`  segment        ORIGINAL (${ORIGINAL_REV})       FINAL (adjudicated)`);
  for (const s of ['sensitivity', 'specificity', 'absolute']) console.log(`  ${s.padEnd(13)} ${pct(so[s]).padEnd(24)} ${pct(sf[s])}`);
  console.log('  → the gap is accuracy produced by relabeling, not by the model.\n');

  const rng = makeRng(20260703);
  const finalSlugs = [...slugRuns.keys()].filter(s => segmentOf(finalLabel.get(s), absById.get(s)));
  const ci = bootstrapCI(finalSlugs, slugRuns, s => finalLabel.get(s), absById, rng);
  console.log(`F5 — 95% bootstrap CI (hierarchical over slugs + runs, ${N_BOOT} resamples), FINAL labels:`);
  for (const s of ['sensitivity', 'specificity', 'absolute']) {
    const point = sf[s] ? (sf[s].hits / sf[s].n).toFixed(3) : 'n/a';
    console.log(`  ${s.padEnd(13)} point ${point}   95% CI [${ci[s] ? ci[s].lo.toFixed(3) + ', ' + ci[s].hi.toFixed(3) : 'n/a'}]`);
  }
  console.log('');
  process.exit(0);
}
main().catch(e => { console.error('AUDIT FAILED', e); process.exit(1); });
