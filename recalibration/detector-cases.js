/**
 * Shared loader for detector feature artifacts joined to anchor-case labels.
 *
 * Extracted from recalibration/index.js so that both the recalibration loop and the validation
 * harnesses (e.g. stratum-gap) read the on-disk detector features the same way. This is the ONE
 * place that knows how artifacts/detector/*.json maps back to anchor cases.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases } from '../anchor-set/index.js';

/**
 * Load fresh detector artifacts and join each to its anchor case. One row per case, latest batch wins.
 * @param {string} [dir] - override the detector artifact directory (defaults to artifacts/detector).
 * @returns {Array<{id, label, controversy_stratum, absolute, pediatric, features}>}
 */
export function loadDetectorFeatureCases(dir = join(process.cwd(), 'artifacts', 'detector')) {
  if (!existsSync(dir)) return [];
  const byId = new Map(loadCases().map((c) => [c.id, c]));
  const cases = [];
  // Prefer the most recent artifact per case (files are <id>-<batch>.json; last write wins by sort).
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const art = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const c = byId.get(art.case_id);
    if (!c) continue;
    const row = {
      id: art.case_id,
      label: c.label,
      controversy_stratum: c.controversy_stratum,
      absolute: Boolean(c.provenance?.absolute_indication),
      pediatric: Boolean(c.provenance?.is_pediatric),
      features: art.features,
    };
    // Overwrite earlier entries for the same case (keeps the latest batch).
    const idx = cases.findIndex((x) => x.id === art.case_id);
    if (idx >= 0) cases[idx] = row; else cases.push(row);
  }
  return cases;
}

export default loadDetectorFeatureCases;
