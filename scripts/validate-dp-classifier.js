#!/usr/bin/env node
/**
 * Phase 2c validation — measure the production slug-classifier's PRECISION and recall on a
 * hand-labeled set of realistic, consult-phrased decision points, against the live curated catalog.
 *
 * Precision is the metric that matters: a false EXACT match corrupts a curated slug's production
 * convergence signal (hard to un-corrupt), whereas a miss (null) is harmless — the consult still
 * persists under the sentinel. We target precision ≥ ~0.95 and accept lower recall.
 *
 * Reads the catalog + runs real Haiku classifications. Writes NOTHING. Dev branch only — it does NOT
 * load .env and HARD-REFUSES the live host as a backstop.
 *
 * Usage:
 *   DATABASE_URL='<dev branch>' ANTHROPIC_API_KEY=… node scripts/validate-dp-classifier.js
 *   …  --sweep        also run a full-catalog self-recall pass (121 classifications)
 */
const LIVE_HOST_MARKER = 'ep-solitary-queen';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — pass the Neon DEV branch inline (never live).');
  process.exit(1);
}
if (process.env.DATABASE_URL.includes(LIVE_HOST_MARKER)) {
  console.error(`Refusing to run: DATABASE_URL points at the LIVE branch (${LIVE_HOST_MARKER}).`);
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set — the classifier needs it.');
  process.exit(1);
}

const sweep = process.argv.includes('--sweep');

const { default: sql } = await import('../src/utils/db.js');
const { loadCatalog, classifyDecisionPoint } = await import('../src/utils/dp-classifier.js');

/**
 * Hand-labeled cases. `expect`: the slug for a recall positive (must match EXACTLY), or null for a
 * precision case (must NOT exact-match — same-fork-different-condition, same-condition-different-fork,
 * or out-of-catalog). All expected slugs are real rows in db/seeds/decision-points.csv.
 */
const CASES = [
  // ---- recall positives: same condition + same fork, reworded as a real consult ----
  { q: 'A 27-year-old recreational soccer player tore her ACL. Should she have early reconstruction or commit to a structured rehab program first?', o: ['Early reconstruction', 'Structured rehabilitation'], expect: 'acl-rupture-early-recon-vs-rehab' },
  { q: 'A 64-year-old with a chronic degenerative rotator cuff tear and night pain — should we repair it surgically or pursue physical therapy?', o: ['Surgical repair', 'Physical therapy'], expect: 'rotator-cuff-degenerative-repair-vs-pt' },
  { q: 'Patient with moderate carpal tunnel syndrome failing night splints. Surgical release or continue splinting and a steroid injection?', o: ['Surgical release', 'Splinting and injection'], expect: 'carpal-tunnel-syndrome-moderate-release-vs-splint' },
  { q: 'During ACL reconstruction, which graft should we use for this active patient?', o: ['BPTB autograft', 'Hamstring autograft'], expect: 'acl-graft-choice' },
  { q: 'Isolated medial-compartment knee arthritis in a 58-year-old — partial knee replacement or total knee replacement?', o: ['Partial knee replacement', 'Total knee replacement'], expect: 'medial-compartment-knee-oa-pkr-vs-tka' },
  { q: 'A 45-year-old with an acute Achilles tendon rupture. Operative repair or functional nonoperative bracing?', o: ['Operative repair', 'Functional nonoperative rehabilitation'], expect: 'achilles-rupture-op-vs-nonop' },
  { q: 'Endoscopic versus open release for this patient with carpal tunnel syndrome?', o: ['Endoscopic carpal tunnel release', 'Open carpal tunnel release'], expect: 'carpal-tunnel-endoscopic-vs-open-release' },
  { q: 'Displaced midshaft clavicle fracture in an active adult — plate fixation or sling and nonoperative care?', o: ['Open reduction internal fixation', 'Nonoperative management'], expect: 'clavicle-midshaft-displaced-op-vs-nonop' },
  { q: 'A 50-year-old laborer with a distal biceps tendon rupture at the elbow — surgical repair or nonoperative management?', o: ['Surgical repair', 'Nonoperative management'], expect: 'distal-biceps-rupture-op-vs-nonop' }, // real slug — same condition + operative-vs-nonop fork
  // MD-adjudicated (2026-06-27): "delayed ACL reconstruction" = rehab-first-then-reconstruct-if-needed,
  // i.e. the SAME operate-now-vs-rehab-first decision as recon-vs-rehab → a correct exact match.
  { q: 'For this ACL reconstruction, should we operate early or wait several weeks to delay the reconstruction?', o: ['Early reconstruction', 'Delayed reconstruction'], expect: 'acl-rupture-early-recon-vs-rehab' },

  // ---- precision: same condition, DIFFERENT fork (a curated slug exists for this condition,
  //      but on a different decision) → must NOT exact-match ----
  { q: 'Carpal tunnel release — should we do it under local or general anaesthetic?', o: ['Local anaesthetic', 'General anaesthetic'], expect: null }, // anaesthetic choice, not a curated fork

  // ---- precision: same region, DIFFERENT condition → must NOT match ----
  // (patellar tendon RUPTURE has no slug; catalog has tendinopathy / fracture / instability only)
  { q: 'Acute patellar tendon rupture in an athlete — primary surgical repair or nonoperative bracing?', o: ['Primary surgical repair', 'Nonoperative bracing'], expect: null },

  // ---- precision: out-of-catalog condition entirely → must NOT match ----
  { q: 'Chronic plantar fasciitis unresponsive to stretching — corticosteroid injection or extracorporeal shockwave therapy?', o: ['Corticosteroid injection', 'Shockwave therapy'], expect: null },
  { q: 'Adult trigger finger — corticosteroid injection or percutaneous release?', o: ['Corticosteroid injection', 'Percutaneous release'], expect: null },
];

function fmt(n) { return (Math.round(n * 1000) / 1000).toFixed(3); }

const catalog = await loadCatalog(sql);
if (catalog.length === 0) {
  console.error('Catalog empty — run `npm run seed:equipoise` against this branch first.');
  process.exit(1);
}
console.log(`\n› classifier validation — ${catalog.length} curated slugs in the menu\n`);

let recallTotal = 0, recallHit = 0;
let precTotal = 0, precClean = 0;
const falseMatches = []; // the dangerous errors

for (const c of CASES) {
  const r = await classifyDecisionPoint({ question: c.q, options: c.o }, catalog);
  const anchored = r.slug;
  if (c.expect) {
    recallTotal++;
    const hit = anchored === c.expect;
    if (hit) recallHit++;
    else if (anchored) falseMatches.push({ q: c.q, got: anchored, wanted: c.expect });
    console.log(`  recall  ${hit ? '✓' : '✗'}  want=${c.expect}  got=${anchored ?? `null(${r.matchQuality})`}`);
  } else {
    precTotal++;
    const clean = !anchored; // must NOT exact-match
    if (clean) precClean++;
    else falseMatches.push({ q: c.q, got: anchored, wanted: 'null' });
    const near = r.nearMissSlug ? ` nearMiss=${r.nearMissSlug}` : '';
    console.log(`  prec    ${clean ? '✓' : '✗'}  want=null  got=${anchored ?? `null(${r.matchQuality})`}${near}`);
  }
}

// Precision over ALL emitted exact matches = correct / (correct + false).
const correctExact = recallHit;
const totalExact = correctExact + falseMatches.length;
console.log('\n── results ──');
console.log(`  recall (right slug / recall positives):  ${recallHit}/${recallTotal} = ${fmt(recallTotal ? recallHit / recallTotal : 0)}`);
console.log(`  precision-cases clean (null kept null):  ${precClean}/${precTotal} = ${fmt(precTotal ? precClean / precTotal : 0)}`);
console.log(`  PRECISION (correct exact / all exact):   ${correctExact}/${totalExact} = ${fmt(totalExact ? correctExact / totalExact : 1)}`);
if (falseMatches.length) {
  console.log('\n  ⚠ FALSE MATCHES (the dangerous error — these corrupt per-slug signal):');
  for (const f of falseMatches) console.log(`    got=${f.got} wanted=${f.wanted}  «${f.q.slice(0, 70)}…»`);
}

// ---- optional full-catalog self-recall: does each curated DP map back to its own slug? ----
if (sweep) {
  console.log('\n── full-catalog self-recall sweep ──');
  let n = 0, self = 0;
  const confusions = [];
  for (const dp of catalog) {
    const r = await classifyDecisionPoint(
      { question: dp.canonical_question, options: [dp.option_a_label, dp.option_b_label] },
      catalog
    );
    n++;
    if (r.slug === dp.slug) self++;
    else if (r.slug) confusions.push({ slug: dp.slug, got: r.slug });
  }
  console.log(`  self-recall: ${self}/${n} = ${fmt(n ? self / n : 0)}`);
  if (confusions.length) {
    console.log('  cross-slug confusions (mapped to the WRONG curated slug):');
    for (const c of confusions) console.log(`    ${c.slug} → ${c.got}`);
  }
}

const pass = falseMatches.length === 0;
console.log(pass ? '\nVALIDATE OK ✅ (zero false matches)' : `\nVALIDATE: ${falseMatches.length} false match(es) ❌`);
process.exit(pass ? 0 : 1);
