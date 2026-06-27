/**
 * Shared loader for the curated equipoise benchmark (db/seeds/decision-points.csv).
 *
 * The CSV is the domain expert's source-of-truth curation format (editable in any spreadsheet).
 * Both the seed runner (scripts/seed-equipoise.js) and the validation test
 * (tests/equipoise-seed.test.js) load through here so they validate the same parsed data.
 *
 * Columns map 1:1 onto the decision_points table. Unmapped table columns
 * (label_source_refs, is_active, id, timestamps) fall to schema defaults.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'csv-parse/sync';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CSV_PATH = join(__dirname, 'decision-points.csv');

/** The exact header the CSV must present, in order. */
export const EXPECTED_COLUMNS = [
  'slug',
  'title',
  'body_region',
  'decision_type',
  'is_operative',
  'canonical_question',
  'option_a_label',
  'option_b_label',
  'expected_equipoise',
  'equipoise_rationale',
  'label_provenance',
];

/**
 * Parse + lightly normalize the curated benchmark CSV.
 * @param {string} [csvPath] override path (defaults to the co-located CSV)
 * @returns {Array<Object>} one row object per decision point; `is_operative` coerced to boolean.
 */
export function loadDecisionPoints(csvPath = CSV_PATH) {
  const raw = readFileSync(csvPath, 'utf8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (records.length === 0) {
    throw new Error(`decision-points CSV is empty: ${csvPath}`);
  }

  // Header integrity: exact set of expected columns (order-independent on the parsed object,
  // but we assert presence so a renamed/dropped column fails loudly rather than silently nulling).
  const got = Object.keys(records[0]).sort();
  const want = [...EXPECTED_COLUMNS].sort();
  if (got.length !== want.length || got.some((c, i) => c !== want[i])) {
    throw new Error(
      `decision-points CSV header mismatch.\n  expected: ${want.join(', ')}\n  got:      ${got.join(', ')}`
    );
  }

  return records.map((r) => ({
    ...r,
    is_operative: coerceBool(r.is_operative),
  }));
}

/** Coerce a CSV cell to a strict boolean; throws on anything unexpected. */
function coerceBool(v) {
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 't' || s === '1') return true;
  if (s === 'false' || s === 'f' || s === '0') return false;
  throw new Error(`is_operative is not a boolean: "${v}"`);
}

export default loadDecisionPoints;
