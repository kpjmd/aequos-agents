/**
 * The four BEHAVIORAL features of the unified detector — pure functions, no I/O, no thresholds.
 *
 * Every case yields all four; the detector applies NO threshold and emits NO verdict (that is
 * /recalibration/'s job, later). Self-reported confidence is ONE feature among several, deliberately
 * never load-bearing.
 *
 * A "cell" is one panel member's answer at one grid point:
 *   { archetypeKey, replicate, order:'AB'|'BA', agent, stance:'A'|'B'|'defer'|'unknown',
 *     confidence:number, evidenceGrade:'A'|'B'|'C'|'D'|'none' }
 * stance is the CANONICAL option (see option-order.js) — 'A' = options[0], 'B' = options[1].
 *
 * The four signals and what they separate:
 *   - between_archetype_modal_variance → PATIENT-DEPENDENT (the modal answer flips across archetypes).
 *   - within_archetype_stance_entropy  → EVIDENCE-SPLIT (agents disagree WITHIN one archetype).
 *   - choice_lability_rate             → EQUIVALENT-OPTIONS (pick flips under option-order swap / redraw —
 *                                        indifference that a confidence threshold cannot see).
 *   - confidence (mean/stdev/by grade) → covariate only.
 */

// ---- numeric helpers ----
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const populationVariance = (xs) => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
};
const stdev = (xs) => Math.sqrt(populationVariance(xs));

// ---- stance helpers ----
const isSubstantive = (c) => c.stance === 'A' || c.stance === 'B';
const substantive = (cells) => cells.filter(isSubstantive);

function groupBy(cells, keyFn) {
  const m = new Map();
  for (const c of cells) {
    const k = keyFn(c);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return m;
}

/** Modal canonical option over substantive cells: 'A' | 'B' | null (null on empty OR a tie). */
export function poolModal(cells) {
  let a = 0;
  let b = 0;
  for (const c of cells) {
    if (c.stance === 'A') a++;
    else if (c.stance === 'B') b++;
  }
  if (a === 0 && b === 0) return null;
  if (a === b) return null; // tie is ambiguous for a modal (the entropy feature captures the split)
  return a > b ? 'A' : 'B';
}

/** Shannon entropy (base 2) over the binary substantive-stance distribution; 0 if empty. */
export function entropyBinary(cells) {
  let a = 0;
  let b = 0;
  for (const c of cells) {
    if (c.stance === 'A') a++;
    else if (c.stance === 'B') b++;
  }
  const total = a + b;
  if (total === 0) return 0;
  let h = 0;
  for (const p of [a / total, b / total]) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

const modalCode = (m) => (m === 'A' ? 0 : m === 'B' ? 1 : null);

/**
 * Feature 1 — between-archetype variance of the modal answer (patient-dependent signal).
 * @returns {{value:number, distinctModalCount:number, modalByArchetype:Object}}
 */
export function betweenArchetypeModalVariance(cells) {
  const byArch = groupBy(cells, (c) => c.archetypeKey);
  const modalByArchetype = {};
  const codes = [];
  for (const [k, cs] of byArch) {
    const m = poolModal(cs);
    modalByArchetype[k] = m || 'abstain';
    const code = modalCode(m);
    if (code !== null) codes.push(code);
  }
  const distinctModalCount = new Set(codes).size;
  return { value: populationVariance(codes), distinctModalCount, modalByArchetype };
}

/**
 * Feature 2 — mean within-archetype stance entropy (evidence-split signal).
 * @returns {{value:number, entropyByArchetype:Object}}
 */
export function withinArchetypeStanceEntropy(cells) {
  const byArch = groupBy(cells, (c) => c.archetypeKey);
  const entropyByArchetype = {};
  const hs = [];
  for (const [k, cs] of byArch) {
    const sub = substantive(cs);
    if (sub.length === 0) continue; // an all-defer archetype contributes no entropy
    const h = entropyBinary(sub);
    entropyByArchetype[k] = h;
    hs.push(h);
  }
  return { value: mean(hs), entropyByArchetype };
}

/**
 * Feature 3 — choice lability under option-order swap and replicate redraw (equivalent-options signal).
 * Order and replicate instability are averaged; a component with no eligible comparisons contributes 0.
 * @returns {{value:number, orderInstability:number, replicateInstability:number}}
 */
export function choiceLabilityRate(cells) {
  const byArch = groupBy(cells, (c) => c.archetypeKey);

  // Order instability: per archetype, modal under AB vs BA.
  let orderFlips = 0;
  let orderComparable = 0;
  // Replicate instability: per archetype, do per-replicate modals disagree?
  let repUnstable = 0;
  let repComparable = 0;

  for (const [, cs] of byArch) {
    const abModal = poolModal(cs.filter((c) => c.order === 'AB'));
    const baModal = poolModal(cs.filter((c) => c.order === 'BA'));
    if (abModal && baModal) {
      orderComparable++;
      if (abModal !== baModal) orderFlips++;
    }

    const byRep = groupBy(cs, (c) => c.replicate);
    const repModals = [...byRep.values()].map((rc) => poolModal(rc)).filter(Boolean);
    if (repModals.length >= 2) {
      repComparable++;
      if (new Set(repModals).size > 1) repUnstable++;
    }
  }

  const orderInstability = orderComparable ? orderFlips / orderComparable : 0;
  const replicateInstability = repComparable ? repUnstable / repComparable : 0;
  // Average only the components that had eligible comparisons; if neither did, lability is 0.
  const parts = [];
  if (orderComparable) parts.push(orderInstability);
  if (repComparable) parts.push(replicateInstability);
  return { value: mean(parts), orderInstability, replicateInstability };
}

/**
 * Feature 4 — raw self-reported confidence stats (covariate only).
 * Computed over SUBSTANTIVE cells (a defer's confidence is meaningless).
 * @returns {{mean:number, stdev:number, n:number, byGrade:Object}}
 */
export function confidenceStats(cells) {
  const sub = substantive(cells).filter((c) => typeof c.confidence === 'number');
  const vals = sub.map((c) => c.confidence);
  const byGradeCells = groupBy(sub, (c) => c.evidenceGrade || 'none');
  const byGrade = {};
  for (const [g, cs] of byGradeCells) byGrade[g] = mean(cs.map((c) => c.confidence));
  return { mean: mean(vals), stdev: stdev(vals), n: vals.length, byGrade };
}

/**
 * Compute the full feature vector for one case's cells. NO threshold, NO verdict.
 * @param {Array} cells
 * @returns {object} the `features` block of the detector artifact
 */
export function computeFeatures(cells) {
  const bmv = betweenArchetypeModalVariance(cells);
  const ent = withinArchetypeStanceEntropy(cells);
  const lab = choiceLabilityRate(cells);
  const conf = confidenceStats(cells);
  return {
    between_archetype_modal_variance: bmv.value,
    distinct_modal_count: bmv.distinctModalCount,
    modal_by_archetype: bmv.modalByArchetype,
    within_archetype_stance_entropy: ent.value,
    entropy_by_archetype: ent.entropyByArchetype,
    choice_lability_rate: lab.value,
    lability_detail: { order: lab.orderInstability, replicate: lab.replicateInstability },
    confidence: { mean: conf.mean, stdev: conf.stdev, n: conf.n, by_grade: conf.byGrade },
  };
}

export default computeFeatures;
