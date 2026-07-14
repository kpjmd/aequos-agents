#!/usr/bin/env node
/**
 * Apply a human ratification packet back into anchor-set/cases/.
 *
 * Parses the auditor's `<version>-ratified-review.md` (Sections 1-4) and, per case:
 *   - Section 1: final label + controversy_stratum come from the `### <label> · <stratum>` header the
 *     case is listed under (the header is the FINAL disposition; the inline "was …" is history).
 *   - Section 2: moved to `settled` · `n_a` (removed from the active contested benchmark).
 *   - Section 3: merged duplicate → the case FILE IS DELETED (its twin absorbs it in Section 1).
 *   - Section 4: a completeness echo of the ratified-unchanged cases — ignored (Section 1 is authoritative).
 * A new review entry (reviewer, date, review_status ratified|corrected, proposed_by 'human') is APPENDED
 * to reviews[] (the provisional entry is kept as history), carrying the auditor reasoning + Claude
 * second-opinion note.
 *
 *   node anchor-set/scripts/apply-ratification.mjs <packet.md> --reviewer kpjohnsonmd --date 2026-07-09          # dry run
 *   node anchor-set/scripts/apply-ratification.mjs <packet.md> --reviewer kpjohnsonmd --date 2026-07-09 --write
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CASES_DIR } from '../index.js';

const args = process.argv.slice(2);
const packetPath = args.find((a) => !a.startsWith('--'));
const write = args.includes('--write');
const reviewer = args.includes('--reviewer') ? args[args.indexOf('--reviewer') + 1] : 'kpjohnsonmd';
const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
if (!packetPath || !date) {
  console.error('usage: apply-ratification.mjs <packet.md> --reviewer <name> --date <YYYY-MM-DD> [--write]');
  process.exit(1);
}

const lines = readFileSync(packetPath, 'utf8').split('\n');
const HEADER_RE = /^###\s+([a-z_]+)\s+·\s+([a-z_]+)\s+\(/;
const CASE_RE = /^-\s+\[[ x]\]\s+\*\*([a-z0-9-]+)\*\*\s+—\s+`([a-z_]+)`/;
const MERGE_TARGET_RE = /into\s+\*\*([a-z0-9-]+)\*\*/;

let section = 0;
let header = null; // {label, stratum}
const plan = new Map(); // slug -> {label, stratum, disposition, note, mergeInto?}
let current = null;

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  const sec = line.match(/^##\s+Section\s+(\d)/);
  if (sec) { section = parseInt(sec[1], 10); header = null; current = null; continue; }
  const h = line.match(HEADER_RE);
  if (h) { header = { label: h[1], stratum: h[2] }; continue; }

  const cm = line.match(CASE_RE);
  if (cm && section >= 1 && section <= 3) {
    const slug = cm[1];
    const disposition = cm[2]; // ratified | corrected | merged
    if (section === 3 || disposition === 'merged') {
      const target = line.match(MERGE_TARGET_RE);
      plan.set(slug, { disposition: 'merged', mergeInto: target ? target[1] : null, note: '' });
      current = plan.get(slug);
    } else if (section === 2) {
      plan.set(slug, { disposition: 'corrected', label: 'settled', stratum: 'n_a', note: '' });
      current = plan.get(slug);
    } else {
      if (!header) throw new Error(`case ${slug} in Section 1 has no preceding ### header`);
      plan.set(slug, { disposition, label: header.label, stratum: header.stratum, note: '' });
      current = plan.get(slug);
    }
    continue;
  }

  // capture reasoning / second-opinion bullets into the current case's note
  const note = line.match(/^\s+-\s+(auditor reasoning|Claude second opinion):\s*(.+)$/);
  if (note && current) current.note += (current.note ? ' | ' : '') + `${note[1]}: ${note[2]}`;
  if (section === 4) current = null; // ignore Section 4 echo
}

// ---- apply ----
const counts = { ratified: 0, corrected: 0, settled: 0, merged: 0, missing: 0 };
const finalLabels = {};
for (const [slug, p] of plan) {
  const file = join(CASES_DIR, `${slug}.json`);
  if (!existsSync(file)) { console.warn(`  ! case file missing: ${slug}`); counts.missing++; continue; }

  if (p.disposition === 'merged') {
    counts.merged++;
    console.log(`  merged  ${slug}  → ${p.mergeInto} (DELETE file)`);
    if (write) rmSync(file);
    continue;
  }

  const c = JSON.parse(readFileSync(file, 'utf8'));
  const changed = c.label !== p.label || c.controversy_stratum !== p.stratum;
  const movedToSettled = p.label === 'settled' && c.label !== 'settled';
  c.label = p.label;
  c.controversy_stratum = p.stratum;
  c.reviews.push({
    reviewer,
    review_date: date,
    review_status: p.disposition === 'ratified' ? 'ratified' : 'corrected',
    proposed_by: 'human',
    notes: p.disposition === 'ratified' ? 'ratified as proposed' : (p.note || 'corrected'),
  });

  if (movedToSettled) counts.settled++;
  else if (p.disposition === 'corrected') counts.corrected++;
  else counts.ratified++;

  finalLabels[p.label] = (finalLabels[p.label] || 0) + 1;
  const tag = movedToSettled ? 'SETTLED ' : p.disposition === 'corrected' ? 'corrected' : 'ratified';
  if (changed || p.disposition !== 'ratified') console.log(`  ${tag} ${slug}  → ${p.label} · ${p.stratum}`);
  if (write) writeFileSync(file, JSON.stringify(c, null, 2) + '\n');
}

console.log(`\nplan: ${plan.size} cases parsed`);
console.log(`  ratified=${counts.ratified} corrected=${counts.corrected} moved-to-settled=${counts.settled} merged/deleted=${counts.merged}${counts.missing ? ` missing=${counts.missing}` : ''}`);
console.log(`  final contested label spread:`, JSON.stringify(finalLabels));
console.log(write ? '\n✓ WROTE changes. Next: build-manifest --version, validate, seed:anchor-overlay.' : '\nDRY RUN — re-run with --write to apply.');
