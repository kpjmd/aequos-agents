#!/usr/bin/env node
/**
 * Project the anchor-set 4-class taxonomy onto the decision_points catalog (additive columns only).
 *
 * Files-first: anchor-set/cases/<slug>.json is the source of truth; this script is a one-way
 * PROJECTION onto the DB and never writes back to the files. It sets decision_points.anchor_label +
 * controversy_stratum by slug, leaving expected_equipoise (the legacy enum) and every production
 * path untouched. Idempotent — re-run after ratifying cases.
 *
 *   npm run seed:anchor-overlay
 *
 * Requires DATABASE_URL. Run `npm run seed:equipoise` first so the rows + columns exist.
 */
import dotenv from 'dotenv';
import { loadCases } from '../anchor-set/index.js';

dotenv.config();

const sql = (await import('../src/utils/db.js')).default;
if (!sql) {
  console.error('DATABASE_URL not set — cannot seed overlay.');
  process.exit(1);
}

const { runEquipoiseMigrations } = await import('../src/utils/equipoise-schema.js');

async function main() {
  console.log('› ensuring equipoise schema (anchor_label / controversy_stratum columns)…');
  await runEquipoiseMigrations(sql);

  // Clear first so slugs no longer in the anchor set (e.g. a merged duplicate) don't retain a stale
  // projection. Files are the source of truth; the DB projection mirrors exactly what's on disk.
  await sql`UPDATE decision_points SET anchor_label = NULL, controversy_stratum = NULL`;

  const cases = loadCases();
  let updated = 0;
  let missing = 0;
  for (const c of cases) {
    const slug = c.provenance?.legacy_slug || c.id;
    const rows = await sql`
      UPDATE decision_points
      SET anchor_label = ${c.label}, controversy_stratum = ${c.controversy_stratum}
      WHERE slug = ${slug}
      RETURNING id
    `;
    if (rows.length) updated++;
    else missing++;
  }
  console.log(`✓ anchor overlay: ${updated} decision_points updated${missing ? `, ${missing} slug(s) not found in DB (seed:equipoise first?)` : ''}`);

  const dist = await sql`
    SELECT anchor_label, COUNT(*)::int AS n
    FROM decision_points
    WHERE anchor_label IS NOT NULL
    GROUP BY anchor_label ORDER BY anchor_label
  `;
  console.log('\nanchor_label distribution (DB):');
  for (const r of dist) console.log(`  ${String(r.anchor_label).padEnd(20)} ${r.n}`);

  console.log('\nANCHOR OVERLAY OK ✅');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nANCHOR OVERLAY FAILED ❌', err);
  process.exit(1);
});
