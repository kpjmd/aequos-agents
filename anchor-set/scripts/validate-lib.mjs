/**
 * Pure set-level validation logic for the anchor set, factored out of validate.mjs so the jest
 * suite can exercise it without spawning a process / hitting process.exit.
 */

/**
 * @param {Array<object>} cases - loaded case objects
 * @param {object|null} manifest - loaded MANIFEST.json (or null)
 * @param {{validateCase: Function, LABELS: string[], CONTESTED_LABELS: string[]}} deps
 * @returns {{ok, errors, schemaErrors, labelCounts, stratumCounts, activeCount, pediatricCount}}
 */
export function runSetValidation(cases, manifest, { validateCase, LABELS, CONTESTED_LABELS }) {
  const errors = [];
  const schemaErrors = [];
  const labelCounts = Object.fromEntries(LABELS.map((l) => [l, 0]));
  const stratumCounts = { editorialized: 0, quietly_contested: 0 };
  const seenIds = new Set();
  let activeCount = 0;
  let pediatricCount = 0;

  for (const c of cases) {
    const { ok, errors: errs } = validateCase(c);
    if (!ok) schemaErrors.push({ id: c?.id || '(no id)', errors: errs });

    if (c?.id) {
      if (seenIds.has(c.id)) errors.push(`duplicate case id: ${c.id}`);
      seenIds.add(c.id);
    }
    if (c?.label != null) labelCounts[c.label] = (labelCounts[c.label] || 0) + 1;
    if (CONTESTED_LABELS.includes(c?.label) && c.controversy_stratum in stratumCounts) {
      stratumCounts[c.controversy_stratum]++;
    }
    if (c?.provenance?.is_pediatric) pediatricCount++;
    else activeCount++;
  }

  // Coverage: all four label classes must appear.
  for (const l of LABELS) {
    if ((labelCounts[l] || 0) === 0) errors.push(`label class not represented: ${l}`);
  }
  // Both contested strata must be represented (the stratum gap is only measurable if both exist).
  if (stratumCounts.editorialized === 0) errors.push('no editorialized contested cases');
  if (stratumCounts.quietly_contested === 0) errors.push('no quietly_contested contested cases');

  // MANIFEST count must match files on disk.
  if (manifest && manifest.case_count !== cases.length) {
    errors.push(`MANIFEST.case_count=${manifest.case_count} != ${cases.length} case files on disk (run build-manifest)`);
  }
  if (!manifest) errors.push('MANIFEST.json missing (run build-manifest)');

  const ok = errors.length === 0 && schemaErrors.length === 0;
  return { ok, errors, schemaErrors, labelCounts, stratumCounts, activeCount, pediatricCount };
}

export default runSetValidation;
