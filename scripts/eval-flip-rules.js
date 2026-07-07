#!/usr/bin/env node
/**
 * OFFLINE replay harness for candidate archetype-flip calibration rules (no LLM, no writes).
 *
 * The equipoise instrument's verdict is a PURE function of the per-archetype stanceCounts, which are
 * persisted in panel_runs.split_summary.groups[].archetypes[]. So any candidate flip rule can be
 * re-derived over the stored benchmark_probe runs for free and scored exactly as equipoise-audit.js
 * does (per-slug majority over runs; sensitivity / specificity / absolute segments). This lets us pick
 * an operating point BEFORE changing the validated detector or spending a cent on a re-probe.
 *
 *   BENCH_URL=$DATABASE_URL node scripts/eval-flip-rules.js
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const BENCH = process.env.BENCH_URL || process.env.DATABASE_URL;
if (!BENCH) { console.error('set BENCH_URL or DATABASE_URL'); process.exit(1); }
const sql = neon(BENCH);

// ---- candidate rules ---------------------------------------------------------------------------
// Each rule maps one stored group {name, archetypes:[{key,verdict,stanceCounts}]} → 'converged'|'contested'.
// Baseline reproduces computeArchetypeFlipVerdict(minModalSupport per archetypeGroupsForDecisionType).
function modalOf(a, minSupport) {
  if (a.verdict === 'contested') return 'split';
  const entries = Object.entries(a.stanceCounts || {});
  if (!entries.length) return 'abstain';
  const top = entries.sort((x, y) => y[1] - x[1])[0];
  return top[1] >= minSupport ? top[0] : 'abstain';
}
function flipFromModals(archetypes, minSupport) {
  let internalContested = false;
  const modalByKey = {};
  for (const a of archetypes) {
    const m = modalOf(a, minSupport);
    if (m === 'split') internalContested = true;
    modalByKey[a.key] = m;
  }
  const opts = Object.values(modalByKey).filter((m) => m !== 'abstain' && m !== 'split');
  const distinct = [...new Set(opts)];
  return { contested: internalContested || distinct.length >= 2, modalByKey, distinct, internalContested };
}
// minSupport for baseline: biological_window=2, others=1 (matches archetypeGroupsForDecisionType).
const baseSupport = (name) => (name === 'biological_window' ? 2 : 1);

const RULES = {
  baseline: (g) => flipFromModals(g.archetypes, baseSupport(g.name)).contested,
  minSupport2: (g) => flipFromModals(g.archetypes, Math.max(2, baseSupport(g.name))).contested,
  minSupport3: (g) => flipFromModals(g.archetypes, Math.max(3, baseSupport(g.name))).contested,
  minSupport4: (g) => flipFromModals(g.archetypes, Math.max(4, baseSupport(g.name))).contested,
  // Directional: on the demand_risk axis, a flip driven SOLELY by the low_demand_high_risk archetype
  // diverging from a high_demand+average consensus is a risk-tolerance bailout, not population
  // equipoise — suppress it (treat that lone extreme as abstain). Other axes unchanged.
  riskBailout: (g) => {
    if (g.name !== 'demand_risk') return flipFromModals(g.archetypes, baseSupport(g.name)).contested;
    const { modalByKey, internalContested } = flipFromModals(g.archetypes, 1);
    const H = modalByKey['high_demand_low_risk'], A = modalByKey['average'], L = modalByKey['low_demand_high_risk'];
    const real = (m) => m && m !== 'abstain' && m !== 'split';
    const loneLowBailout = real(H) && real(A) && H === A && real(L) && L !== A
      && !real(modalByKey['average']) === false; // H==A consensus, L is the only divergent option
    if (loneLowBailout) {
      // rebuild modals with low_demand_high_risk suppressed
      const kept = g.archetypes.filter((a) => a.key !== 'low_demand_high_risk');
      return flipFromModals(kept, 1).contested || internalContested;
    }
    return flipFromModals(g.archetypes, 1).contested;
  },
  // Unanimous-gated bailout: suppress the low_demand_high_risk divergence ONLY when BOTH high_demand
  // and average are UNANIMOUS (4/4 non-deferring) for the SAME option — the "overwhelming-operative-
  // with-bailout" signature. Genuine frailty-driven equipoise, where the typical/high-demand panels are
  // less than unanimous, is untouched.
  riskBailout_unanimous: (g) => {
    if (g.name !== 'demand_risk') return flipFromModals(g.archetypes, baseSupport(g.name)).contested;
    const byKey = Object.fromEntries(g.archetypes.map((a) => [a.key, a]));
    const H = byKey['high_demand_low_risk'], A = byKey['average'], L = byKey['low_demand_high_risk'];
    const unanimous = (a, opt) => a && a.verdict !== 'contested' && (a.stanceCounts?.[opt] || 0) >= 4;
    const modH = modalOf(H || {}, 1), modA = modalOf(A || {}, 1), modL = modalOf(L || {}, 1);
    const real = (m) => m && m !== 'abstain' && m !== 'split';
    if (real(modH) && modH === modA && unanimous(H, modH) && unanimous(A, modA) && real(modL) && modL !== modA) {
      const kept = g.archetypes.filter((a) => a.key !== 'low_demand_high_risk');
      return flipFromModals(kept, 1).contested;
    }
    return flipFromModals(g.archetypes, 1).contested;
  },
  // Combo: risk-bailout suppression AND minSupport2 (drop thin flips too).
  riskBailout_ms2: (g) => {
    if (g.name !== 'demand_risk') return flipFromModals(g.archetypes, Math.max(2, baseSupport(g.name))).contested;
    const { modalByKey } = flipFromModals(g.archetypes, 2);
    const H = modalByKey['high_demand_low_risk'], A = modalByKey['average'], L = modalByKey['low_demand_high_risk'];
    const real = (m) => m && m !== 'abstain' && m !== 'split';
    if (real(H) && real(A) && H === A && real(L) && L !== A) {
      const kept = g.archetypes.filter((a) => a.key !== 'low_demand_high_risk');
      return flipFromModals(kept, 2).contested;
    }
    return flipFromModals(g.archetypes, 2).contested;
  },
};

function runVerdict(groups, rule) {
  // contested if ANY axis contested (combineGroupVerdicts).
  return groups.some((g) => rule(g)) ? 'contested' : 'converged';
}

// ---- scoring (mirrors equipoise-audit.js) ------------------------------------------------------
const isHit = (label, v) => label === 'genuine_equipoise' ? v === 'contested'
  : (label === 'settled_conservative' || label === 'settled_operative') ? v === 'converged' : null;
const segmentOf = (label, abs) => label === 'genuine_equipoise' ? 'sensitivity'
  : (label === 'settled_conservative' || label === 'settled_operative') ? (abs ? 'absolute' : 'specificity') : null;
const majority = (verds) => verds.filter((v) => v === 'contested').length * 2 >= verds.length ? 'contested' : 'converged';

const rows = await sql`
  SELECT dp.slug, dp.expected_equipoise AS label, COALESCE(dp.absolute_indication,false) AS abs,
         pr.run_index AS ri, pr.split_summary AS ss
  FROM decision_points dp
  JOIN panel_runs pr ON pr.decision_point_id = dp.id AND pr.run_kind = 'benchmark_probe'
  WHERE dp.is_active = true`;

// group stored runs by slug
const bySlug = new Map();
for (const r of rows) {
  if (!bySlug.has(r.slug)) bySlug.set(r.slug, { label: r.label, abs: r.abs, runs: [] });
  bySlug.get(r.slug).runs.push(r.ss?.groups || []);
}

function score(ruleName) {
  const rule = RULES[ruleName];
  const seg = { sensitivity: { h: 0, n: 0 }, specificity: { h: 0, n: 0, miss: [] }, absolute: { h: 0, n: 0 } };
  const flippedToConverged = [];
  for (const [slug, d] of bySlug) {
    const s = segmentOf(d.label, d.abs); if (!s) continue;
    const verds = d.runs.map((groups) => runVerdict(groups, rule));
    const maj = majority(verds);
    const hit = isHit(d.label, maj);
    seg[s].n++; if (hit) seg[s].h++;
    if (s === 'specificity' && !hit) seg[s].miss.push(slug);
  }
  return seg;
}

const order = ['baseline', 'minSupport2', 'minSupport3', 'minSupport4', 'riskBailout_unanimous', 'riskBailout', 'riskBailout_ms2'];
console.log('replay over', bySlug.size, 'slugs (', rows.length, 'runs)\n');
console.log('rule'.padEnd(18), 'sensitivity'.padEnd(16), 'specificity'.padEnd(16), 'absolute');
const base = score('baseline');
for (const name of order) {
  const s = score(name);
  const f = (o) => (o.h + '/' + o.n + '=' + (o.h / o.n).toFixed(3));
  console.log(name.padEnd(18), f(s.sensitivity).padEnd(16), f(s.specificity).padEnd(16), f(s.absolute));
}
// Detail: which specificity misses baseline has that the best rule fixes, and any NEW sensitivity misses.
console.log('\n--- riskBailout_unanimous vs baseline ---');
const best = score('riskBailout_unanimous');
const baseMiss = new Set(base.specificity.miss), bestMiss = new Set(best.specificity.miss);
console.log('specificity FPs fixed:', [...baseMiss].filter((x) => !bestMiss.has(x)).length,
  '| still-miss:', bestMiss.size, '| new FPs:', [...bestMiss].filter((x) => !baseMiss.has(x)).length);
console.log('sensitivity:', base.sensitivity.h + '→' + best.sensitivity.h, '/', best.sensitivity.n,
  '(genuine equipoise retained)');
console.log('still-missed specificity controls under riskBailout_ms2:');
for (const m of [...bestMiss].sort()) console.log('   ' + m);
