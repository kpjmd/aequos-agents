#!/usr/bin/env node
/**
 * One-shot verification of the coordination_divergences persistence round-trip against a real DB.
 * Requires DATABASE_URL (loaded from .env). Idempotent + self-cleaning:
 *   1. CREATE TABLE IF NOT EXISTS (additive — does not touch existing tables/data)
 *   2. store a synthetic divergence, read it back, assert
 *   3. DELETE the synthetic test row
 *
 * Usage: node scripts/verify-divergence-db.js
 */
import dotenv from 'dotenv';
dotenv.config();

const sql = (await import('../src/utils/db.js')).default;
if (!sql) {
  console.error('DATABASE_URL not set — cannot verify. Add it to .env and re-run.');
  process.exit(1);
}

const { storeCoordinationDivergences, getCoordinationDivergences } = await import('../src/utils/divergence-storage.js');

// 1. Migrate (same DDL as src/index.js runMigrations) — additive + idempotent.
await sql`CREATE TABLE IF NOT EXISTS coordination_divergences (
  id SERIAL PRIMARY KEY,
  consultation_id TEXT NOT NULL,
  decision_point_id TEXT,
  decision_question TEXT,
  decision_options JSONB,
  persisted BOOLEAN,
  resolved BOOLEAN,
  changed_count INTEGER DEFAULT 0,
  sides JSONB,
  dialogue JSONB,
  post_dialogue JSONB,
  created_at TIMESTAMP DEFAULT NOW()
)`;
await sql`CREATE INDEX IF NOT EXISTS idx_coord_div_consultation_id ON coordination_divergences(consultation_id)`;
await sql`CREATE INDEX IF NOT EXISTS idx_coord_div_persisted ON coordination_divergences(persisted)`;
console.log('✓ migration applied (coordination_divergences table present)');

// 2. Round-trip a synthetic divergence.
const cid = `verify-${Date.now()}`;
const meta = {
  gateOpen: true,
  divergences: [{
    decisionPoint: { id: 'd1', question: 'Surgery now or rehab first?', options: ['surgery', 'rehab'] },
    sides: [
      { stance: 'surgery', specialists: [{ specialist: 'Movement Detective', reasoning: 'active instability' }] },
      { stance: 'rehab', specialists: [{ specialist: 'Strength Sage', reasoning: 'prehab first' }] },
    ],
    dialogue: [{ specialist: 'Movement Detective', originalStance: 'surgery', revisedStance: 'surgery', changed: false, changeReason: 'hold' }],
    postDialogue: { persisted: true, resolved: false, changedCount: 0, deltas: [] },
  }],
};

const stored = await storeCoordinationDivergences(cid, meta);
const rows = await getCoordinationDivergences(cid);
console.log(`✓ stored ${stored} row(s); read back ${rows.length} row(s)`);

const r = rows[0];
const ok = stored === 1 && rows.length === 1 &&
  r.decision_question === 'Surgery now or rehab first?' &&
  r.persisted === true &&
  Array.isArray(r.sides) && r.sides.length === 2 &&
  Array.isArray(r.dialogue) && r.dialogue.length === 1;
console.log('  readback:', JSON.stringify({
  decision_question: r?.decision_question, persisted: r?.persisted,
  sides: r?.sides?.length, dialogue: r?.dialogue?.length, options: r?.decision_options,
}));

// 3. Clean up the synthetic test row.
await sql`DELETE FROM coordination_divergences WHERE consultation_id = ${cid}`;
console.log('✓ cleaned up synthetic test row');

console.log(ok ? '\nDB ROUND-TRIP OK ✅' : '\nDB ROUND-TRIP FAILED ❌');
process.exit(ok ? 0 : 1);
