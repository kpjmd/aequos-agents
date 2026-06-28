/**
 * One-shot verification of the Phase 2b PRODUCTION persistence round-trip against a real DB.
 * Replaces the retired verify-divergence-db.js (the old coordination_divergences round-trip).
 *
 * Exercises the exact production path WITHOUT spending LLM tokens: runs the equipoise migrations
 * (creating the sentinel anchor), then persists a synthetic contested panel + a red-flag panel via
 * the same helpers agent-coordinator.persistEquipoisePanels() uses, reads them back, and asserts the
 * routing truth table + that v_benchmark_accuracy EXCLUDES production rows. Cleans up after itself.
 *
 * Usage: DATABASE_URL='<dev branch>' node scripts/verify-equipoise-production.js
 * NEVER point this at live; it writes + deletes rows (tagged by a unique session id). It does NOT
 * load .env (which points at live), and HARD-REFUSES the live host as a backstop.
 */
const LIVE_HOST_MARKER = 'ep-solitary-queen'; // the live Neon branch — never write here

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — pass the Neon DEV branch inline (never live).');
  process.exit(1);
}
if (process.env.DATABASE_URL.includes(LIVE_HOST_MARKER)) {
  console.error(`Refusing to run: DATABASE_URL points at the LIVE branch (${LIVE_HOST_MARKER}).`);
  process.exit(1);
}

const { default: sql } = await import('../src/utils/db.js');
const { runEquipoiseMigrations } = await import('../src/utils/equipoise-schema.js');
const { resolveModelVersionId, createQuery, getSentinelDecisionPointId } = await import('../src/utils/equipoise-ingest.js');
const { storePanelRun } = await import('../src/utils/panel-run-storage.js');
const { buildSynthesizerOutput, storeSynthesizerOutput } = await import('../src/utils/synthesizer.js');
const { buildEvidenceForPanel, storeEvidenceCitations, toLedgerEntries, isAccepted } = await import('../src/utils/evidence-research.js');

const POSITION_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const SESSION = `verify_${Date.now()}`;
let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };

await runEquipoiseMigrations(sql);
console.log('✓ migrations applied (sentinel anchor present)');

const modelVersionId = await resolveModelVersionId(sql, POSITION_MODEL);
const decisionPointId = await getSentinelDecisionPointId(sql);
ok(modelVersionId != null, `model_versions row for ${POSITION_MODEL}`);
ok(decisionPointId != null, 'sentinel production-unclassified decision_point');
if (modelVersionId == null || decisionPointId == null) {
  console.error('Missing FK rows — run `npm run seed:equipoise` against this branch first.');
  process.exit(1);
}

// Two synthetic panels: a contested non-red-flag (surface) and a converged red-flag (route).
const contestedPerDP = {
  decisionPoint: { id: 'verify-d1', question: 'Early reconstruction vs structured rehab?', options: ['Early reconstruction', 'Structured rehab'] },
  verdict: 'contested',
  positions: [
    { specialistType: 'strengthSage', initialStance: 'Early reconstruction', finalStance: 'Early reconstruction', confidence: 0.8, reasoning: 'active giving-way', changeReason: null },
    { specialistType: 'movementDetective', initialStance: 'Structured rehab', finalStance: 'Structured rehab', confidence: 0.75, reasoning: 'rehab is the test', changeReason: null },
    { specialistType: 'painWhisperer', initialStance: 'Structured rehab', finalStance: 'Early reconstruction', confidence: 0.7, reasoning: 'persuaded', changeReason: 'giving-way' },
  ],
  splitSummary: {
    verdict: 'contested',
    stanceCounts: { 'Early reconstruction': 2, 'Structured rehab': 1 },
    sides: [
      { stance: 'Early reconstruction', specialists: [{ specialist: 'Strength Sage', confidence: 0.8, evidenceGrade: 'B', reasoning: 'active giving-way' }] },
      { stance: 'Structured rehab', specialists: [{ specialist: 'Movement Detective', confidence: 0.75, evidenceGrade: 'B', reasoning: 'rehab is the test' }] },
    ],
    postDialogue: { resolved: false, persisted: true, changedCount: 1, deltas: [{ specialist: 'Pain Whisperer', from: 'Structured rehab', to: 'Early reconstruction', reason: 'giving-way' }] },
  },
};
const redFlagPerDP = {
  decisionPoint: { id: 'verify-d2', question: 'Operative drainage vs observe?', options: ['Drainage', 'Observe'] },
  verdict: 'converged',
  positions: [{ specialistType: 'movementDetective', initialStance: 'Drainage', finalStance: 'Drainage', confidence: 0.9, reasoning: 'septic', changeReason: null }],
  splitSummary: { verdict: 'converged', stanceCounts: { Drainage: 4 }, sides: null, postDialogue: null },
};

const cases = [
  { perDP: contestedPerDP, ctx: { requiresImmediateMD: false, treatmentPlan: { phase1: 'prehab' } }, expect: { route: false, status: 'contested' } },
  { perDP: redFlagPerDP, ctx: { requiresImmediateMD: true, urgencyLevel: 'immediate' }, expect: { route: true, status: 'consensus' } },
];

const panelRunIds = [];
for (const c of cases) {
  const output = buildSynthesizerOutput(c.perDP, c.ctx);
  const [optionALabel, optionBLabel] = c.perDP.decisionPoint.options;
  const queryId = await createQuery(sql, { questionText: c.perDP.decisionPoint.question, decisionPointId, isBenchmark: false, detectedBy: 'classifier' });
  const panelRunId = await storePanelRun(sql, {
    queryId, decisionPointId, modelVersionId, verdict: c.perDP.verdict,
    optionALabel, optionBLabel, runKind: 'production', sessionId: SESSION,
    splitSummary: c.perDP.splitSummary, positions: c.perDP.positions,
  });
  const synthId = await storeSynthesizerOutput(sql, panelRunId, output);
  panelRunIds.push(panelRunId);

  const pr = (await sql`SELECT detector_verdict, run_kind FROM panel_runs WHERE id = ${panelRunId}`)[0];
  const sp = await sql`SELECT agent, initial_stance, final_stance, revised FROM specialist_positions WHERE panel_run_id = ${panelRunId} ORDER BY agent`;
  const so = (await sql`SELECT status, route_to_human, route_reason, collapsed FROM synthesizer_outputs WHERE id = ${synthId}`)[0];

  console.log(`\n[${c.perDP.decisionPoint.id}] verdict=${pr.detector_verdict} run_kind=${pr.run_kind}`);
  ok(pr.run_kind === 'production', "panel_runs.run_kind = 'production'");
  ok(sp.length === c.perDP.positions.length, `specialist_positions persisted (${sp.length})`);
  ok(sp.some(r => r.revised === true) === c.perDP.positions.some(p => p.initialStance !== p.finalStance), 'revised flag computed from initial≠final');
  ok(so.route_to_human === c.expect.route, `route_to_human = ${c.expect.route}`);
  ok(so.status === c.expect.status, `card status = ${c.expect.status}`);
  ok(so.route_reason === (c.expect.route ? 'risk_category' : 'none'), 'route_reason correct');
  ok(so.collapsed === false, 'collapsed = false (v1 never collapses)');
}

// ---- Phase 2.5: evidence_citations round-trip (PURE ANNOTATION; no LLM/PubMed spend — fake agent + stub LLM) ----
console.log('\n[evidence] claim-grounded evidence_citations round-trip');
const fakeResearchAgent = {
  curateRelevantStudies: async () => ({
    success: true,
    citations: [
      { pmid: 'EV1', title: 'RCT of rehab', studyType: 'Randomized Controlled Trial', abstract: 'a' },
      { pmid: 'EV2', title: 'Pediatric case series', studyType: 'Other', abstract: 'b' },
    ],
  }),
};
const stubClassifierLLM = {
  withStructuredOutput() {
    return {
      invoke: async () => ({
        classifications: [
          { ref: 1, supportsStance: 'option_a', studyType: 'rct', evidenceGrade: 'high', populationMatch: 'match', rationale: 'rehab non-inferior' },
          { ref: 2, supportsStance: 'option_b', studyType: 'case_series', evidenceGrade: 'low', populationMatch: 'mismatch', rationale: 'pediatric cohort' },
        ],
      }),
    };
  },
};
const evPanelRunId = panelRunIds[0]; // the contested panel
const beforeVerdict = (await sql`SELECT detector_verdict FROM panel_runs WHERE id = ${evPanelRunId}`)[0].detector_verdict;
const beforeSo = (await sql`SELECT status, route_to_human, route_reason FROM synthesizer_outputs WHERE panel_run_id = ${evPanelRunId}`)[0];

const evRows = await buildEvidenceForPanel(fakeResearchAgent, {
  perDP: contestedPerDP,
  patientContext: { ageBracket: 'young adult', demandLevel: 'competitive', bodyRegion: 'knee' },
  llm: stubClassifierLLM,
});
ok(evRows.length === 2, `buildEvidenceForPanel produced ${evRows.length} rows`);
const accepted = evRows.filter(r => r.accepted);
ok(accepted.length === 1, 'exactly one row clears the strict bar (high/match/rct)');
const ev1 = evRows.find(r => r.pmid === 'EV1');
ok(ev1.claimText.startsWith('Early reconstruction') && ev1.claimText.includes('active giving-way'),
   'claim_text grounded in the panel option_a reasoning (not the LLM rationale)');

const evStored = await storeEvidenceCitations(sql, evPanelRunId, evRows);
ok(evStored === 2, `evidence_citations rows persisted (${evStored})`);
const back = await sql`SELECT supports_stance, study_type, evidence_grade, population_match, accepted FROM evidence_citations WHERE panel_run_id = ${evPanelRunId} ORDER BY pmid`;
ok(back.length === 2, 'two evidence rows read back');
const violators = back.filter(r => r.accepted && !isAccepted({ evidenceGrade: r.evidence_grade, populationMatch: r.population_match, studyType: r.study_type }));
ok(violators.length === 0, 'no accepted row violates the strict acceptance bar');
ok(toLedgerEntries(evRows).length === back.filter(r => r.accepted).length, 'card ledger == accepted rows');

// No-feedback: the evidence stage must NOT change verdict / status / routing.
const afterVerdict = (await sql`SELECT detector_verdict FROM panel_runs WHERE id = ${evPanelRunId}`)[0].detector_verdict;
const afterSo = (await sql`SELECT status, route_to_human, route_reason FROM synthesizer_outputs WHERE panel_run_id = ${evPanelRunId}`)[0];
ok(afterVerdict === beforeVerdict, 'detector_verdict unchanged by evidence stage');
ok(afterSo.status === beforeSo.status && afterSo.route_to_human === beforeSo.route_to_human && afterSo.route_reason === beforeSo.route_reason, 'card status + routing unchanged by evidence stage');

// Coverage view: counts sum to n_citations per slug.
const cov = await sql`SELECT n_citations, n_match, n_partial, n_mismatch, n_unknown FROM v_evidence_population_coverage WHERE slug = 'production-unclassified'`;
ok(cov.length > 0, 'v_evidence_population_coverage returns rows');
ok(cov.every(r => Number(r.n_match) + Number(r.n_partial) + Number(r.n_mismatch) + Number(r.n_unknown) === Number(r.n_citations)), 'coverage counts sum to n_citations');

// v_benchmark_accuracy must NOT include production rows (sentinel is 'evolving' + filter is benchmark_probe).
const inView = await sql`SELECT 1 FROM v_benchmark_accuracy WHERE slug = 'production-unclassified' LIMIT 1`;
console.log('');
ok(inView.length === 0, 'v_benchmark_accuracy EXCLUDES the sentinel/production rows');

// Cleanup: panel_runs cascade-deletes specialist_positions + synthesizer_outputs; remove the test queries too.
await sql`DELETE FROM panel_runs WHERE session_id = ${SESSION}`;
await sql`DELETE FROM queries WHERE raw_text IN (${contestedPerDP.decisionPoint.question}, ${redFlagPerDP.decisionPoint.question}) AND is_benchmark = false`;
console.log('\n✓ cleaned up test rows');

console.log(failures === 0 ? '\nVERIFY OK ✅' : `\nVERIFY FAILED ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
