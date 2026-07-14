/**
 * Emit the MD review packet — a git-tracked Markdown checklist the reviewer (the MD) ratifies from.
 * Grouped by label class and stratum so provisional proposals can be ratified in a sitting; ratifying
 * later just edits each case's reviews[] (review_status provisional -> ratified/corrected).
 *
 * Only cases with a NON-mechanical judgment need review: the which-option label choice and every
 * contested case's stratum. Settled cases (pure mechanical mapping) are summarized, not itemized.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REVIEW_PACKETS_DIR } from '../index.js';

/**
 * @param {Array<object>} cases - assembled anchor cases
 * @param {{version:string}} opts
 */
export function writeReviewPacket(cases, { version }) {
  const contested = cases.filter((c) => c.label !== 'settled');
  const settled = cases.filter((c) => c.label === 'settled');

  const lines = [];
  lines.push(`# Anchor-set review packet — ${version}`);
  lines.push('');
  lines.push(
    `All labels below are **provisional** (proposed by deterministic mapping or Haiku). Ratify by editing ` +
      `the case's \`reviews[]\` in anchor-set/cases/<id>.json: set \`review_status\` to \`ratified\` (or ` +
      `\`corrected\` + fix the field). ${contested.length} contested cases need review; ${settled.length} ` +
      `settled cases were mapped mechanically (not itemized).`
  );
  lines.push('');

  const byGroup = new Map();
  for (const c of contested) {
    const key = `${c.label} · ${c.controversy_stratum}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(c);
  }

  for (const [group, items] of [...byGroup.entries()].sort()) {
    lines.push(`## ${group} (${items.length})`);
    lines.push('');
    for (const c of items.sort((a, b) => a.id.localeCompare(b.id))) {
      const r = c.reviews[0];
      lines.push(`- [ ] **${c.id}** — _${r.proposed_by}_`);
      lines.push(`  - ${c.decision_point}`);
      lines.push(`  - options: ${c.options[0]} | ${c.options[1]}`);
      lines.push(`  - label: \`${c.label}\`  ·  stratum: \`${c.controversy_stratum}\``);
      if (r.notes) lines.push(`  - note: ${r.notes}`);
      if (c.provenance.absolute_indication) lines.push(`  - ⚠︎ absolute_indication (segmented, not scored as equipoise)`);
      if (c.provenance.is_pediatric) lines.push(`  - ⚠︎ pediatric (excluded from active adult benchmark)`);
    }
    lines.push('');
  }

  mkdirSync(REVIEW_PACKETS_DIR, { recursive: true });
  const out = join(REVIEW_PACKETS_DIR, `${version}-review.md`);
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`  ✓ review packet: ${out} (${contested.length} contested cases)`);
  return out;
}

export default writeReviewPacket;
