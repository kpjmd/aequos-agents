/**
 * Recalibration Level 3 — per-agent confidence calibration (Platt + isotonic).
 *
 * A specialist's raw self-reported confidence does not mean the same thing across model versions, or
 * even across specialists on one version. Level 3 fits a mapping raw_confidence -> empirical_accuracy
 * PER AGENT, so downstream logic can read a calibrated probability instead of a raw number. Two fits
 * are produced: Platt (a 1-D logistic squash — smooth, robust at small n) and isotonic (a monotone
 * step function — non-parametric, tracks the empirical curve when there is enough data).
 *
 * This needs an OUTCOME signal (was the stance correct?) which the detector features do not carry.
 * The masked-evidence validation harness supplies it: there the causal evidence direction is known, so
 * correct = (stance === fabricated direction). See recalibration/outcome-from-masked.js. Until such a
 * run exists, recalibrate() leaves calibration_maps null — the machinery here is complete and tested,
 * but inert without data.
 *
 * The min-sample guard below is a statistical floor (not an operating-point threshold): agents with
 * too few outcome pairs are skipped with a recorded note rather than fit on noise.
 */

const MIN_PAIRS = 8; // statistical floor — fewer than this can't support a stable per-agent fit

const clamp01 = (x) => Math.min(1 - 1e-6, Math.max(1e-6, x));

/**
 * Platt scaling: fit the 1-D logistic  p = 1 / (1 + exp(-(A*x + B)))  predicting P(correct=1) on
 * (x=confidence, y∈{0,1}) via Newton/IRLS. In this standard-logistic convention p IS the calibrated
 * probability, so the gradient (p−y)·x and the Newton step θ ← θ − H⁻¹g carry consistent signs.
 * @param {Array<{x:number, y:number}>} pairs
 * @returns {{A:number, B:number, n:number}}
 */
export function fitPlatt(pairs) {
  const pts = pairs.filter((p) => typeof p.x === 'number' && (p.y === 0 || p.y === 1));
  const n = pts.length;
  if (n === 0) return { A: 0, B: 0, n: 0 };
  let A = 0;
  let B = 0;
  for (let iter = 0; iter < 100; iter++) {
    // Gradient + Hessian of the log-loss w.r.t. (A, B).
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const { x, y } of pts) {
      const p = clamp01(1 / (1 + Math.exp(-(A * x + B))));
      const d = p - y; // dLoss/du for u = A*x + B
      g0 += d * x;
      g1 += d;
      const w = p * (1 - p);
      h00 += w * x * x;
      h01 += w * x;
      h11 += w;
    }
    const lambda = 1e-6; // tiny ridge to keep the 2x2 invertible on degenerate data
    h00 += lambda;
    h11 += lambda;
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    const dA = (h11 * g0 - h01 * g1) / det;
    const dB = (h00 * g1 - h01 * g0) / det;
    A -= dA;
    B -= dB;
    if (Math.abs(dA) < 1e-9 && Math.abs(dB) < 1e-9) break;
  }
  return { A, B, n };
}

/** Apply a Platt fit to a raw confidence → calibrated probability. */
export function applyPlatt(map, x) {
  if (!map || typeof x !== 'number') return null;
  return 1 / (1 + Math.exp(-(map.A * x + map.B)));
}

/**
 * Isotonic regression via Pool-Adjacent-Violators — a non-decreasing step map from confidence to
 * empirical accuracy. Returns block boundaries so applyIsotonic can interpolate/lookup.
 * @param {Array<{x:number, y:number}>} pairs
 * @returns {{blocks:Array<{x:number, y:number, w:number}>, n:number}}
 */
export function fitIsotonic(pairs) {
  const pts = pairs
    .filter((p) => typeof p.x === 'number' && (p.y === 0 || p.y === 1))
    .sort((a, b) => a.x - b.x);
  const n = pts.length;
  if (n === 0) return { blocks: [], n: 0 };
  // Each point starts as its own block (value y, weight 1, anchored at x).
  const blocks = pts.map((p) => ({ x: p.x, y: p.y, w: 1 }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].y > blocks[i + 1].y) {
      // Pool the adjacent violating blocks (weighted mean), then back up to re-check.
      const a = blocks[i];
      const b = blocks[i + 1];
      const w = a.w + b.w;
      blocks[i] = { x: a.x, y: (a.y * a.w + b.y * b.w) / w, w };
      blocks.splice(i + 1, 1);
      if (i > 0) i--;
    } else {
      i++;
    }
  }
  return { blocks, n };
}

/** Apply an isotonic fit: piecewise-constant lookup by the block a confidence falls into. */
export function applyIsotonic(map, x) {
  if (!map || !map.blocks || map.blocks.length === 0 || typeof x !== 'number') return null;
  let y = map.blocks[0].y;
  for (const blk of map.blocks) {
    if (x >= blk.x) y = blk.y; else break;
  }
  return y;
}

/**
 * Fit both calibrations per agent from matched (feature, label) arrays.
 * @param {Array<{agent:string, confidence:number}>} features - per-row vectors (agent + raw confidence)
 * @param {Array<number>} labels - matched correctness (0/1)
 * @returns {{calibration_maps:{per_agent:object, skipped:object}}}
 */
export function level3(features, labels) {
  const byAgent = new Map();
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const y = labels[i];
    if (!f || typeof f.confidence !== 'number' || (y !== 0 && y !== 1)) continue;
    const agent = f.agent || 'unknown';
    if (!byAgent.has(agent)) byAgent.set(agent, []);
    byAgent.get(agent).push({ x: f.confidence, y });
  }
  const per_agent = {};
  const skipped = {};
  for (const [agent, pairs] of byAgent) {
    if (pairs.length < MIN_PAIRS) {
      skipped[agent] = { n: pairs.length, reason: `below min-sample floor (${MIN_PAIRS})` };
      continue;
    }
    // With no class variation (all correct or all wrong) a logistic/isotonic fit cannot discriminate —
    // it collapses to a constant. Fit it anyway for shape, but flag it so consumers don't trust the curve.
    const pos = pairs.filter((p) => p.y === 1).length;
    const accuracy = pos / pairs.length;
    const degenerate = pos === 0 || pos === pairs.length;
    per_agent[agent] = { platt: fitPlatt(pairs), isotonic: fitIsotonic(pairs), n: pairs.length, accuracy, degenerate };
  }
  return { calibration_maps: { per_agent, skipped } };
}

/**
 * Convenience bridge for recalibrate(): accept per-row outcome pairs {agent, confidence, correct} and
 * fit Level 3. Splits into the documented (features, labels) shape internally.
 * @param {Array<{agent:string, confidence:number, correct:0|1}>} outcomePairs
 */
export function level3FromOutcomePairs(outcomePairs) {
  const features = outcomePairs.map((p) => ({ agent: p.agent, confidence: p.confidence }));
  const labels = outcomePairs.map((p) => (p.correct ? 1 : 0));
  return level3(features, labels);
}

export default level3;
