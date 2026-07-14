#!/usr/bin/env node
/**
 * Equipoise vignette screener — will THIS candidate fire a contested card?
 *
 * Runs the EXACT validated archetype-flip sweep (src/utils/archetype-sweep.js) against one or more
 * candidate decision forks, WITHOUT touching the DB or the /consultation pipeline. It reuses the same
 * synchronous panel transport as the live production path and the benchmark probe
 * (conference.runDecisionPoints → OrthopedicSpecialist.statePosition), so a candidate that screens
 * CONTESTED here is one that will produce a contested equipoise card on /api/v1/consult, and one that
 * screens CONVERGED will reveal a card but not contest it.
 *
 * Use it to pre-screen kpjmd.com/ask "contested content" candidates so you discover convergence BEFORE
 * spending a full consult, not after.
 *
 * WHAT IT MEASURES: population equipoise. The sweep re-runs the fork across demand/risk archetypes
 * (high-demand/low-risk, average, low-demand/high-risk) holding your fixed clinical facts constant. It
 * is CONTESTED only if the panel's modal answer FLIPS across archetypes (or an archetype is internally
 * split). Your patient-specific "68yo, highly active" phrasing is intentionally OVERWRITTEN by the
 * archetypes — state the pathology neutrally and let the sweep vary demand/risk.
 *
 * Requires: ANTHROPIC_API_KEY (positions run on Sonnet). NO database.
 *
 * Usage:
 *   # Single fork, inline:
 *   node scripts/screen-vignette.js \
 *     --question "For a full-thickness supraspinatus tear from an acute fall, is early surgical repair or non-operative management the better initial approach?" \
 *     --a "early surgical repair" --b "non-operative management"
 *
 *   # Batch a library of candidates from a JSON file:
 *   node scripts/screen-vignette.js --file candidates.json
 *
 *   # Reproducibility (LLM is stochastic — 2-3 runs shows whether a borderline case is stable):
 *   node scripts/screen-vignette.js --file candidates.json --runs 3
 *
 *   # Machine-readable output:
 *   node scripts/screen-vignette.js --file candidates.json --json
 *
 * candidates.json format — an array of:
 *   {
 *     "id": "acute-cuff-tear",                 // optional label
 *     "question": "…the decision fork as a question…",
 *     "optionA": "early surgical repair",      // (aliases: "a")
 *     "optionB": "non-operative management",   // (aliases: "b")
 *     "decisionType": null                     // optional; see below
 *   }
 *
 * decisionType selects the flip axis (matches production's classifyDecisionPoint output):
 *   null / omitted / "conservative_vs_operative" / "which_intervention" → demand_risk axis (default)
 *   "which_operation"    → pathology × bone-quality × fracture-pattern axes (technique/implant choice)
 *   "timing_of_surgery"  → demand_risk + biological_window axes
 * A novel library vignette that doesn't match a curated benchmark slug gets null in production, so the
 * default here mirrors what you'll actually see on /api/v1/consult.
 */
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

// Capture a SHELL-provided LOG_LEVEL before dotenv loads the .env one, so `LOG_LEVEL=debug node …`
// still works while the .env default doesn't reintroduce the agents' chatter.
const shellLogLevel = process.env.LOG_LEVEL;
dotenv.config();

// Screening runs the panel only — no token economics. Force blockchain OFF so specialist
// construction skips CDP wallet init (its fire-and-forget analytics call can throw and crash
// the process). Must be set before the agent modules construct.
process.env.ENABLE_BLOCKCHAIN = 'false';
// Keep the screening readout clean — suppress the agents' info/debug chatter unless the caller
// explicitly set LOG_LEVEL in the shell.
process.env.LOG_LEVEL = shellLogLevel || 'error';

const POSITION_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

function parseArgs(argv) {
  const opts = { file: null, question: null, a: null, b: null, decisionType: null, runs: 1, limit: 2, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file') opts.file = argv[++i];
    else if (arg === '--question' || arg === '-q') opts.question = argv[++i];
    else if (arg === '--a' || arg === '--option-a') opts.a = argv[++i];
    else if (arg === '--b' || arg === '--option-b') opts.b = argv[++i];
    else if (arg === '--decision-type') opts.decisionType = argv[++i];
    else if (arg === '--runs' || arg === '--n') opts.runs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (arg === '--limit') opts.limit = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') { printUsage(); process.exit(0); }
  }
  return opts;
}

function printUsage() {
  console.log(`
Equipoise vignette screener — predicts whether a decision fork fires a contested card.

  node scripts/screen-vignette.js --question "…" --a "option A" --b "option B" [--decision-type T]
  node scripts/screen-vignette.js --file candidates.json [--runs N] [--limit N] [--json]

decision-type: (default) demand_risk | which_operation | timing_of_surgery
See the header of this file for the candidates.json format.`);
}

/** Normalize a raw candidate object (from file or CLI flags) into the canonical shape. */
function normalizeCandidate(raw, idx) {
  const question = raw.question || raw.q;
  const optionA = raw.optionA ?? raw.a ?? raw.option_a_label;
  const optionB = raw.optionB ?? raw.b ?? raw.option_b_label;
  const id = raw.id || raw.slug || `candidate-${idx + 1}`;
  const decisionType = raw.decisionType ?? raw.decision_type ?? null;
  if (!question || !optionA || !optionB) {
    throw new Error(`candidate "${id}" is missing question / optionA / optionB`);
  }
  return { id, question, optionA, optionB, decisionType };
}

function loadCandidates(opts) {
  if (opts.file) {
    const parsed = JSON.parse(readFileSync(opts.file, 'utf8'));
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(normalizeCandidate);
  }
  if (opts.question) {
    return [normalizeCandidate({ question: opts.question, a: opts.a, b: opts.b, decisionType: opts.decisionType }, 0)];
  }
  return [];
}

const AXIS_FOR = {
  which_operation: 'pathology × bone-quality × fracture-pattern',
  timing_of_surgery: 'demand_risk + biological_window',
};
const axisLabel = (dt) => AXIS_FOR[dt] || 'demand_risk';

/** One sweep of a candidate → the aggregateSweep result ({verdict, splitSummary, positions, detail}). */
async function sweepOnce(candidate, conference, specialists, runArchetypeFlipSweep, limit) {
  const decisionPoint = { id: candidate.id, question: candidate.question, options: [candidate.optionA, candidate.optionB] };
  // runPanel = one synchronous population panel for one archetype (identical to benchmark-probe.js's
  // live path and agent-coordinator.js's production sweep).
  const runPanel = async (dpArg, archetypeCase) => {
    const r = await conference.runDecisionPoints([dpArg], archetypeCase, specialists, { mode: 'normal', population: false, dialogue: false });
    return r.perDecisionPoint[0];
  };
  return runArchetypeFlipSweep(decisionPoint, candidate.decisionType, runPanel, { limit });
}

/** Render one sweep's per-axis / per-archetype modal answers for human reading. */
function renderSweep(sweep) {
  const lines = [];
  for (const group of sweep.splitSummary.groups || []) {
    const state = group.verdict === 'contested' ? (group.flipDetected ? 'FLIP' : 'INTERNAL SPLIT') : 'stable';
    lines.push(`  ${group.name}: ${state}`);
    const labelByKey = Object.fromEntries((group.archetypes || []).map((a) => [a.key, a.label]));
    for (const [key, modal] of Object.entries(group.modalByArchetype || {})) {
      const label = labelByKey[key] || key;
      lines.push(`    ${label.padEnd(42)} → ${modal}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const candidates = loadCandidates(opts);
  if (candidates.length === 0) { printUsage(); process.exit(candidates.length === 0 ? 1 : 0); }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — the panel needs it at construction. Add it to .env.');
    process.exit(1);
  }

  const { runArchetypeFlipSweep } = await import('../src/utils/archetype-sweep.js');
  const { CoordinationConference, POSITION_SPECIALISTS } = await import('../src/utils/coordination-conference.js');
  const { TriageAgent } = await import('../src/agents/triage-agent.js');
  const { PainWhispererAgent } = await import('../src/agents/pain-whisperer-agent.js');
  const { MovementDetectiveAgent } = await import('../src/agents/movement-detective-agent.js');
  const { StrengthSageAgent } = await import('../src/agents/strength-sage-agent.js');
  const { MindMenderAgent } = await import('../src/agents/mind-mender-agent.js');

  // Lightweight panel — no blockchain side effects (accountManager omitted; ENABLE_BLOCKCHAIN off).
  const specialists = new Map([
    ['triage', new TriageAgent('OrthoTriage Master')],
    ['painWhisperer', new PainWhispererAgent('Pain Whisperer')],
    ['movementDetective', new MovementDetectiveAgent('Movement Detective')],
    ['strengthSage', new StrengthSageAgent('Strength Sage')],
    ['mindMender', new MindMenderAgent('Mind Mender')],
  ]);
  const conference = new CoordinationConference();

  const panelSize = POSITION_SPECIALISTS.length;
  if (!opts.json) {
    console.log(`\n› Equipoise vignette screener — ${candidates.length} candidate(s) × ${opts.runs} run(s), model=${POSITION_MODEL}`);
    console.log(`  (each run = axes × archetypes × ${panelSize} panelists Sonnet calls — demand_risk ≈ ${3 * panelSize}/run; which_operation ≈ ${9 * panelSize}/run)\n`);
  }

  const report = [];
  for (const candidate of candidates) {
    const runs = [];
    for (let r = 0; r < opts.runs; r++) {
      runs.push(await sweepOnce(candidate, conference, specialists, runArchetypeFlipSweep, opts.limit));
    }
    const contestedCount = runs.filter((s) => s.verdict === 'contested').length;
    const stable = contestedCount === 0 || contestedCount === opts.runs;
    const majority = contestedCount * 2 > opts.runs ? 'contested' : 'converged';

    report.push({ candidate, runs, contestedCount, stable, majority });

    if (opts.json) continue;

    console.log('═'.repeat(72));
    console.log(`CANDIDATE: ${candidate.id}`);
    console.log(`Q: ${candidate.question}`);
    console.log(`   A: ${candidate.optionA}   |   B: ${candidate.optionB}`);
    console.log(`   axis: ${axisLabel(candidate.decisionType)} (decision_type: ${candidate.decisionType || 'default'})`);
    console.log('─'.repeat(72));
    runs.forEach((sweep, i) => {
      const tag = sweep.verdict === 'contested' ? 'CONTESTED ✅' : 'CONVERGED ❌';
      console.log(`Run ${i + 1}: ${tag}`);
      console.log(renderSweep(sweep));
    });
    console.log('─'.repeat(72));
    if (majority === 'contested' && stable) {
      console.log(`VERDICT: CONTESTED in ${contestedCount}/${opts.runs} run(s)  →  ✅ WILL fire a contested equipoise card`);
    } else if (majority === 'converged' && stable) {
      console.log(`VERDICT: CONVERGED in ${opts.runs}/${opts.runs} run(s)  →  ❌ card reveals but does NOT contest`);
      console.log('  the panel agrees on the same answer across demand/risk archetypes (no population flip).');
    } else {
      console.log(`VERDICT: BORDERLINE — contested in ${contestedCount}/${opts.runs} run(s), majority=${majority}`);
      console.log('  stochastic near the flip threshold. Re-run with more --runs, or sharpen the fork so demand clearly flips it.');
    }
    console.log('');
  }

  if (opts.json) {
    const out = report.map(({ candidate, runs, contestedCount, stable, majority }) => ({
      id: candidate.id,
      question: candidate.question,
      optionA: candidate.optionA,
      optionB: candidate.optionB,
      decisionType: candidate.decisionType,
      axis: axisLabel(candidate.decisionType),
      runs: runs.length,
      contestedCount,
      majority,
      stable,
      willFire: majority === 'contested',
      perRun: runs.map((s) => ({
        verdict: s.verdict,
        contestedBy: s.splitSummary.contestedBy,
        groups: (s.splitSummary.groups || []).map((g) => ({
          name: g.name,
          verdict: g.verdict,
          flipDetected: g.flipDetected,
          internalContested: g.internalContested,
          modalByArchetype: g.modalByArchetype,
        })),
      })),
    }));
    console.log(JSON.stringify(out, null, 2));
  } else {
    const willFire = report.filter((r) => r.majority === 'contested').length;
    console.log('═'.repeat(72));
    console.log(`SUMMARY: ${willFire}/${report.length} candidate(s) will fire a contested card` +
      (report.some((r) => !r.stable) ? ` (${report.filter((r) => !r.stable).length} borderline — see above)` : ''));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\nSCREEN FAILED ❌', err);
  process.exit(1);
});
