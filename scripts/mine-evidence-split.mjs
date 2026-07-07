import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

// For adult which-option decisions (which_intervention + which_operation), measure WITHIN-PANEL
// stance disagreement from stored benchmark_probe split_summary: for each archetype panel, did the 4
// specialists split across both options (evidence disagreement) or agree? Aggregate per DP, compare
// genuine_equipoise vs settled. A within-panel split is an evidence-equipoise signal distinct from the
// cross-archetype (patient-dependent) flip the detector currently keys on.
const rows = await sql`
  SELECT dp.slug, dp.decision_type dt, dp.expected_equipoise lab, pr.split_summary ss
  FROM decision_points dp
  JOIN panel_runs pr ON pr.decision_point_id = dp.id AND pr.run_kind = 'benchmark_probe'
  WHERE dp.is_active AND dp.decision_type IN ('which_intervention','which_operation')`;

const bySlug = new Map();
for (const r of rows) {
  if (!bySlug.has(r.slug)) bySlug.set(r.slug, { lab: r.lab, dt: r.dt, panels: 0, split: 0 });
  const d = bySlug.get(r.slug);
  for (const g of r.ss?.groups || []) {
    for (const a of g.archetypes || []) {
      d.panels++;
      const opts = Object.entries(a.stanceCounts || {}).filter(([, n]) => n > 0);
      // within-panel split = at least 2 distinct substantive options each held by a specialist
      if (opts.length >= 2) d.split++;
    }
  }
}

const agg = {};
for (const [, d] of bySlug) {
  const key = d.lab;
  agg[key] ??= { dps: 0, splitRateSum: 0 };
  agg[key].dps++;
  agg[key].splitRateSum += d.panels ? d.split / d.panels : 0;
}
console.log('within-panel stance-split rate (specialists disagree on a SINGLE population), by label:\n');
console.log('label'.padEnd(24), 'DPs', ' mean within-panel split rate');
for (const [lab, a] of Object.entries(agg).sort()) {
  console.log('  ' + lab.padEnd(22), String(a.dps).padStart(3), '  ' + (a.splitRateSum / a.dps).toFixed(3));
}
// per-DP detail for the genuine which_intervention (non-surgical) cases of interest
console.log('\nper-DP within-panel split rate (which_intervention + notable):');
for (const [slug, d] of [...bySlug].sort((a, b) => (b[1].split / (b[1].panels || 1)) - (a[1].split / (a[1].panels || 1)))) {
  if (d.dt === 'which_intervention' || d.lab === 'genuine_equipoise')
    console.log('  ' + (d.split / (d.panels || 1)).toFixed(2) + '  [' + d.lab + '/' + d.dt + '] ' + slug);
}
