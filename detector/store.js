/**
 * Persist detector feature artifacts to detector_feature_runs (additive table; separate from
 * panel_runs — features carry NO verdict). Resolves decision_point_id by slug (the anchor case id ==
 * the legacy slug) and model_version_id by model string. Skips silently if no DB is configured.
 */
export async function storeFeatureRuns(artifacts, { modelVersion }) {
  const sql = (await import('../src/utils/db.js')).default;
  if (!sql) {
    console.warn('  (no DATABASE_URL — skipping detector_feature_runs persistence)');
    return 0;
  }
  const { runEquipoiseMigrations } = await import('../src/utils/equipoise-schema.js');
  const { resolveModelVersionId } = await import('../src/utils/equipoise-ingest.js');
  await runEquipoiseMigrations(sql);
  const modelVersionId = await resolveModelVersionId(sql, modelVersion);

  let n = 0;
  for (const art of artifacts) {
    const rows = await sql`SELECT id FROM decision_points WHERE slug = ${art.case_id}`;
    if (!rows.length) {
      console.warn(`  ! no decision_point for slug ${art.case_id} — skipped (seed:equipoise first?)`);
      continue;
    }
    await sql`
      INSERT INTO detector_feature_runs
        (decision_point_id, model_version_id, anchor_set_version, panel_composition,
         pseudo_replicated, replicate_count, data_completeness, features)
      VALUES
        (${rows[0].id}, ${modelVersionId}, ${art.anchor_set_version}, ${art.panel_composition},
         ${art.pseudo_replicated}, ${art.grid.replicates}, ${art.data_completeness},
         ${JSON.stringify(art.features)}::jsonb)
    `;
    n++;
  }
  return n;
}

export default storeFeatureRuns;
