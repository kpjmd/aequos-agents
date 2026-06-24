#!/usr/bin/env node
/**
 * Seed the equipoise moat data: model_versions + the curated decision_points benchmark.
 *
 * Idempotent: ensures the schema (runEquipoiseMigrations), then UPSERTs both seed sets so the
 * domain expert can edit db/seeds/decision-points.csv and re-run safely. Requires DATABASE_URL
 * (loaded from .env).
 *
 * Usage: npm run seed:equipoise   (or: node scripts/seed-equipoise.js)
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

dotenv.config();

const sql = (await import('../src/utils/db.js')).default;
if (!sql) {
  console.error('DATABASE_URL not set — cannot seed. Add it to .env and re-run.');
  process.exit(1);
}

const { runEquipoiseMigrations } = await import('../src/utils/equipoise-schema.js');
const { loadDecisionPoints } = await import('../db/seeds/load-decision-points.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelVersions = JSON.parse(
  readFileSync(join(__dirname, '..', 'db', 'seeds', 'model-versions.json'), 'utf8')
);

/** Empty string -> null (optional columns); leave everything else intact. */
const nz = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : v);

async function main() {
  console.log('› ensuring equipoise schema…');
  await runEquipoiseMigrations(sql);

  // ---- model_versions ----
  for (const m of modelVersions) {
    await sql`
      INSERT INTO model_versions (provider, model_string, display_name, released_at, notes)
      VALUES (${m.provider}, ${m.model_string}, ${nz(m.display_name)}, ${nz(m.released_at)}::timestamptz, ${nz(m.notes)})
      ON CONFLICT (provider, model_string) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        released_at  = EXCLUDED.released_at,
        notes        = EXCLUDED.notes
    `;
  }
  console.log(`✓ model_versions: ${modelVersions.length} upserted`);

  // ---- decision_points (curated benchmark) ----
  const rows = loadDecisionPoints();
  for (const d of rows) {
    await sql`
      INSERT INTO decision_points
        (slug, title, body_region, decision_type, is_operative, canonical_question,
         option_a_label, option_b_label, expected_equipoise, equipoise_rationale, label_provenance)
      VALUES
        (${d.slug}, ${d.title}, ${d.body_region}, ${d.decision_type}, ${d.is_operative},
         ${d.canonical_question}, ${d.option_a_label}, ${d.option_b_label},
         ${d.expected_equipoise}::equipoise_label, ${nz(d.equipoise_rationale)},
         ${nz(d.label_provenance)}::label_provenance)
      ON CONFLICT (slug) DO UPDATE SET
        title              = EXCLUDED.title,
        body_region        = EXCLUDED.body_region,
        decision_type      = EXCLUDED.decision_type,
        is_operative       = EXCLUDED.is_operative,
        canonical_question = EXCLUDED.canonical_question,
        option_a_label     = EXCLUDED.option_a_label,
        option_b_label     = EXCLUDED.option_b_label,
        expected_equipoise = EXCLUDED.expected_equipoise,
        equipoise_rationale = EXCLUDED.equipoise_rationale,
        label_provenance   = EXCLUDED.label_provenance,
        updated_at         = now()
    `;
  }
  console.log(`✓ decision_points: ${rows.length} upserted`);

  // ---- report the ground-truth distribution (moat sanity check) ----
  const dist = await sql`
    SELECT expected_equipoise, COUNT(*)::int AS n
    FROM decision_points
    GROUP BY expected_equipoise
    ORDER BY expected_equipoise
  `;
  console.log('\nexpected_equipoise distribution:');
  for (const r of dist) console.log(`  ${r.expected_equipoise.padEnd(22)} ${r.n}`);

  const total = await sql`SELECT COUNT(*)::int AS n FROM decision_points`;
  console.log(`  ${'TOTAL'.padEnd(22)} ${total[0].n}`);

  console.log('\nSEED OK ✅');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nSEED FAILED ❌', err);
  process.exit(1);
});
