#!/usr/bin/env node
/**
 * Equipoise benchmark probe (Phase 2a).
 *
 * Runs the existing, validated divergence detector against the curated decision_points benchmark
 * at the POPULATION level, persisting one panel_runs row (+ specialist_positions) per run with
 * run_kind='benchmark_probe', then prints a decision_type-segmented detector_hit_rate readout.
 * This populates v_benchmark_accuracy — the moat metric — and answers the which_operation
 * (technique-choice) detectability question.
 *
 * The detector_verdict is the AUTHORITATIVE initial structural divergence (the gate). The
 * dialogue round is opt-in (--dialogue) and only enriches split_summary / final stances.
 *
 * Usage:
 *   node scripts/benchmark-probe.js --dry-run [--limit 20]        # sample + mapping, no LLM/DB
 *   npm run benchmark:probe -- --limit 20 --n 1                    # live pilot
 *   npm run benchmark:probe -- --all --n 3 --dialogue             # full reproducibility sweep
 *
 * Detection mode (default = archetype-flip; population mode gave 0% sensitivity — see
 * docs/divergence-spike-findings.md): each DP is run across patient archetypes and labelled
 * CONTESTED if the panel's modal answer FLIPS across them (or any archetype is internally split).
 *
 * Flags:
 *   --limit N            cap total DPs sampled (default: the ~20-row stratified pilot)
 *   --decision-type T    restrict to decision_type T (repeatable)
 *   --all                run every active decision point (full sweep; ignores stratification)
 *   --n RUNS             reproducibility runs per DP (run_index 1..N; default 1)
 *   --population         use single population-level run instead of archetype-flip (legacy probe)
 *   --dialogue           (population mode only) run the Step-3 dialogue round
 *   --dry-run            print the sample + archetypes + stance mapping; no agents/DB/spend
 */
import dotenv from 'dotenv';

dotenv.config();

const POSITION_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const POPULATION_CASE = { population: true, note: 'equipoise benchmark probe — population-level' };

function parseArgs(argv) {
  const opts = { decisionTypes: [], n: 1, dialogue: false, dryRun: false, all: false, limit: null, population: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--dialogue') opts.dialogue = true;
    else if (a === '--population') opts.population = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10);
    else if (a === '--n') opts.n = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--decision-type') opts.decisionTypes.push(argv[++i]);
  }
  return opts;
}

/** Build the sampler options from CLI flags. */
function samplerOpts(opts) {
  if (opts.all) return null; // signal: take everything
  if (opts.decisionTypes.length > 0) {
    const each = opts.limit ? Math.ceil(opts.limit / opts.decisionTypes.length) : 8;
    const perType = Object.fromEntries(opts.decisionTypes.map((t) => [t, each]));
    return { perType, limit: opts.limit ?? undefined };
  }
  return { limit: opts.limit ?? undefined };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { stratifiedSample } = await import('../src/utils/benchmark-sampler.js');
  const { toStanceEnum } = await import('../src/utils/equipoise-mappers.js');
  const { ARCHETYPES, computeArchetypeFlipVerdict } = await import('../src/utils/archetype-flip.js');

  // ---------- DRY RUN: sample from the CSV, print plan + mapping, no DB/LLM ----------
  if (opts.dryRun) {
    const { loadDecisionPoints } = await import('../db/seeds/load-decision-points.js');
    const rows = loadDecisionPoints();
    const sOpts = samplerOpts(opts);
    const sample = sOpts === null ? rows : stratifiedSample(rows, sOpts);

    console.log(`\n› DRY RUN — ${sample.length} decision point(s) sampled (of ${rows.length})\n`);
    const byType = {};
    for (const r of sample) byType[r.decision_type] = (byType[r.decision_type] || 0) + 1;
    console.log('decision_type breakdown:');
    for (const [t, n] of Object.entries(byType)) console.log(`  ${t.padEnd(28)} ${n}`);

    const byLabel = {};
    for (const r of sample) byLabel[r.expected_equipoise] = (byLabel[r.expected_equipoise] || 0) + 1;
    console.log('\nexpected_equipoise breakdown:');
    for (const [l, n] of Object.entries(byLabel)) console.log(`  ${l.padEnd(28)} ${n}`);

    console.log('\nsample (slug → stance-enum mapping):');
    for (const r of sample.slice(0, 8)) {
      console.log(`  ${r.slug}`);
      console.log(`    A "${r.option_a_label}" → ${toStanceEnum(r.option_a_label, r.option_a_label, r.option_b_label)}`);
      console.log(`    B "${r.option_b_label}" → ${toStanceEnum(r.option_b_label, r.option_a_label, r.option_b_label)}`);
      console.log(`    defer → ${toStanceEnum('defer', r.option_a_label, r.option_b_label)}`);
    }
    if (sample.length > 8) console.log(`  … and ${sample.length - 8} more`);

    if (!opts.population) {
      console.log(`\ndetection: archetype-flip across ${ARCHETYPES.length} archetypes ` +
        `(${ARCHETYPES.length}× panel cost/DP):`);
      for (const arch of ARCHETYPES) console.log(`  ${arch.key.padEnd(22)} ${arch.label}`);
    } else {
      console.log('\ndetection: population mode (single panel/DP)');
    }
    console.log('\nDRY RUN OK ✅  (re-run without --dry-run to execute the live probe)');
    process.exit(0);
  }

  // ---------- LIVE RUN ----------
  const sql = (await import('../src/utils/db.js')).default;
  if (!sql) {
    console.error('DATABASE_URL not set — cannot run the live probe. Add it to .env (or use --dry-run).');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — agents need it at construction. (or use --dry-run)');
    process.exit(1);
  }

  const { runEquipoiseMigrations } = await import('../src/utils/equipoise-schema.js');
  const { storePanelRun } = await import('../src/utils/panel-run-storage.js');
  const { CoordinationConference } = await import('../src/utils/coordination-conference.js');
  const { TriageAgent } = await import('../src/agents/triage-agent.js');
  const { PainWhispererAgent } = await import('../src/agents/pain-whisperer-agent.js');
  const { MovementDetectiveAgent } = await import('../src/agents/movement-detective-agent.js');
  const { StrengthSageAgent } = await import('../src/agents/strength-sage-agent.js');
  const { MindMenderAgent } = await import('../src/agents/mind-mender-agent.js');

  await runEquipoiseMigrations(sql);

  // Resolve the position model (positions stay on Sonnet per divergence-spike-findings).
  const mv = await sql`SELECT id FROM model_versions WHERE model_string = ${POSITION_MODEL} LIMIT 1`;
  if (mv.length === 0) {
    console.error(`model_versions has no row for "${POSITION_MODEL}" — run \`npm run seed:equipoise\` first.`);
    process.exit(1);
  }
  const modelVersionId = mv[0].id;

  // Load + sample the benchmark from the DB (need decision_points.id for the FK).
  const all = await sql`
    SELECT id, slug, title, decision_type, expected_equipoise,
           canonical_question, option_a_label, option_b_label
    FROM decision_points
    WHERE is_active = true
    ORDER BY id
  `;
  const sOpts = samplerOpts(opts);
  const sample = sOpts === null ? all : stratifiedSample(all, sOpts);

  const detection = opts.population ? 'population' : `archetype-flip (${ARCHETYPES.length} archetypes)`;
  console.log(`\n› LIVE PROBE — ${sample.length} DP(s) × ${opts.n} run(s), model=${POSITION_MODEL}, ` +
    `detection=${detection}\n`);

  // Construct the panel lightweight (no blockchain side effects; accountManager null).
  const specialists = new Map([
    ['triage', new TriageAgent('OrthoTriage Master')],
    ['painWhisperer', new PainWhispererAgent('Pain Whisperer')],
    ['movementDetective', new MovementDetectiveAgent('Movement Detective')],
    ['strengthSage', new StrengthSageAgent('Strength Sage')],
    ['mindMender', new MindMenderAgent('Mind Mender')],
  ]);
  const conference = new CoordinationConference();

  let runs = 0;
  for (const dp of sample) {
    // One benchmark query per DP (reused across reproducibility runs).
    const q = await sql`
      INSERT INTO queries (raw_text, is_benchmark) VALUES (${dp.canonical_question}, true) RETURNING id
    `;
    const queryId = q[0].id;
    await sql`
      INSERT INTO query_decision_points (query_id, decision_point_id, detected_by)
      VALUES (${queryId}, ${dp.id}, 'manual')
      ON CONFLICT (query_id, decision_point_id) DO NOTHING
    `;

    const decisionPoint = {
      id: dp.slug,
      question: dp.canonical_question,
      options: [dp.option_a_label, dp.option_b_label],
    };

    for (let runIndex = 1; runIndex <= opts.n; runIndex++) {
      let verdict, splitSummary, positions, detail;

      if (opts.population) {
        const result = await conference.runDecisionPoints(
          [decisionPoint], POPULATION_CASE, specialists,
          { mode: 'normal', population: true, dialogue: opts.dialogue }
        );
        const s = result.perDecisionPoint[0];
        verdict = s.verdict;
        splitSummary = s.splitSummary;
        positions = s.positions;
        detail = stanceLine(s.splitSummary);
      } else {
        // Archetype-flip: run the panel under each archetype, label contested if the modal
        // answer flips across them (or any archetype is internally split).
        const archetypeResults = [];
        for (const arch of ARCHETYPES) {
          const r = await conference.runDecisionPoints(
            [decisionPoint], { archetype: arch.label, ...arch.case }, specialists,
            { mode: 'normal', population: false, dialogue: false }
          );
          const s = r.perDecisionPoint[0];
          archetypeResults.push({
            key: arch.key, label: arch.label, verdict: s.verdict,
            stanceCounts: s.splitSummary.stanceCounts, deferredCount: s.splitSummary.deferredCount,
            positions: s.positions,
          });
        }
        const flip = computeArchetypeFlipVerdict(archetypeResults);
        verdict = flip.verdict;
        splitSummary = {
          method: 'archetype_flip',
          flipDetected: flip.flipDetected,
          internalContested: flip.internalContested,
          modalByArchetype: flip.modalByArchetype,
          distinctOptionModals: flip.distinctOptionModals,
          archetypes: archetypeResults.map(({ key, label, verdict: v, stanceCounts, deferredCount }) =>
            ({ key, label, verdict: v, stanceCounts, deferredCount })),
        };
        // Representative single-panel snapshot for specialist_positions = the 'average' archetype.
        positions = (archetypeResults.find(a => a.key === 'average') || archetypeResults[0]).positions;
        detail = Object.entries(flip.modalByArchetype)
          .map(([k, v]) => `${k}=${v === 'split' || v === 'abstain' ? v : toStanceEnum(v, dp.option_a_label, dp.option_b_label)}`)
          .join(' ') + (flip.flipDetected ? ' [FLIP]' : '');
      }

      await storePanelRun(sql, {
        queryId,
        decisionPointId: dp.id,
        modelVersionId,
        verdict,
        optionALabel: dp.option_a_label,
        optionBLabel: dp.option_b_label,
        runKind: 'benchmark_probe',
        runIndex,
        splitSummary,
        positions,
      });
      runs++;

      const hit = isHit(dp.expected_equipoise, verdict);
      console.log(`  [${runs}] ${dp.slug} (${dp.decision_type}/${dp.expected_equipoise}) ` +
        `→ ${verdict} ${hit ? '✓' : '✗'}  ${detail}`);
    }
  }

  console.log(`\n✓ stored ${runs} benchmark_probe run(s)\n`);
  await printReadout(sql);
  console.log('\nPROBE OK ✅');
  process.exit(0);
}

function isHit(label, verdict) {
  if (label === 'genuine_equipoise') return verdict === 'contested';
  if (label === 'settled_conservative' || label === 'settled_operative') return verdict === 'converged';
  return false;
}

function stanceLine(splitSummary) {
  const counts = splitSummary?.stanceCounts || {};
  const parts = Object.entries(counts).map(([s, n]) => `${s}:${n}`);
  if (splitSummary?.deferredCount) parts.push(`abstain:${splitSummary.deferredCount}`);
  return parts.join(' ');
}

/** decision_type × expected_equipoise hit-rate — the which_operation reading + raw view. */
async function printReadout(sql) {
  const seg = await sql`
    SELECT dp.decision_type, dp.expected_equipoise,
           COUNT(*)::int AS n_runs,
           AVG(CASE
             WHEN dp.expected_equipoise = 'genuine_equipoise' AND pr.detector_verdict = 'contested' THEN 1
             WHEN dp.expected_equipoise IN ('settled_conservative','settled_operative') AND pr.detector_verdict = 'converged' THEN 1
             ELSE 0 END)::numeric(4,3) AS detector_hit_rate
    FROM panel_runs pr
    JOIN decision_points dp ON dp.id = pr.decision_point_id
    WHERE pr.run_kind = 'benchmark_probe'
    GROUP BY dp.decision_type, dp.expected_equipoise
    ORDER BY dp.decision_type, dp.expected_equipoise
  `;
  console.log('detector_hit_rate by decision_type × expected_equipoise (benchmark_probe):');
  console.log(`  ${'decision_type'.padEnd(28)} ${'expected'.padEnd(22)} n   hit_rate`);
  for (const r of seg) {
    console.log(`  ${r.decision_type.padEnd(28)} ${r.expected_equipoise.padEnd(22)} ${String(r.n_runs).padEnd(3)} ${r.detector_hit_rate}`);
  }
}

main().catch((err) => {
  console.error('\nPROBE FAILED ❌', err);
  process.exit(1);
});
