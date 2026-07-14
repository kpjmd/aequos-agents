/**
 * Anchor-set access layer — the ONE place that knows the on-disk layout of the durable benchmark.
 *
 * The anchor set is files-first and git-tracked: cases/<id>.json are the source of truth, MANIFEST.json
 * records the version + count, config/target_operating_point.json holds the targets the recalibration
 * gate must hit. Everything downstream (the migration/validation scripts, the detector, the
 * recalibration loop, the seed overlay) reads through here so there is a single loader.
 *
 * Append-mostly + immutable-ish: nothing here writes cases; only the migration and ratification
 * scripts mutate cases/. The seeder projects FROM these files onto the DB and never writes back.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ANCHOR_SET_ROOT = __dirname;
export const CASES_DIR = join(ANCHOR_SET_ROOT, 'cases');
export const MANIFEST_PATH = join(ANCHOR_SET_ROOT, 'MANIFEST.json');
export const TARGET_OP_PATH = join(ANCHOR_SET_ROOT, 'config', 'target_operating_point.json');
export const REVIEW_PACKETS_DIR = join(ANCHOR_SET_ROOT, 'review-packets');

/** List case files (sorted for deterministic order). */
export function listCaseFiles() {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(CASES_DIR, f));
}

/** Load every case object. Throws on malformed JSON (loud is correct for a moat asset). */
export function loadCases() {
  return listCaseFiles().map((p) => {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      throw new Error(`anchor-set: failed to parse ${p}: ${e.message}`);
    }
  });
}

/** Load MANIFEST.json (or null if the set has not been built yet). */
export function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

/** The anchor-set version string (from MANIFEST), or 'unbuilt' if absent — stamped on downstream results. */
export function anchorSetVersion() {
  return loadManifest()?.anchor_set_version || 'unbuilt';
}

/** Load the target operating point config the recalibration gate reads. */
export function loadTargetOperatingPoint() {
  return JSON.parse(readFileSync(TARGET_OP_PATH, 'utf8'));
}

/** Active-benchmark filter mirroring the seeder: pediatric cases are excluded from the adult set. */
export function isActive(c) {
  return !c.provenance?.is_pediatric;
}
