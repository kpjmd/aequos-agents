/**
 * Phase 2.5 validation — run the REAL evidence path (live PubMed retrieval + Haiku classification)
 * on a few representative decision points and print the per-stance ledger for MD eyeball review of
 * the acceptance + population_match calls. Spends a small amount of Haiku + PubMed quota; writes
 * NOTHING (no DB), so it is safe to run anywhere.
 *
 * Requires: ANTHROPIC_API_KEY (Haiku) + network (PubMed eutils). PUBMED_API_KEY optional (rate).
 * Usage:   ANTHROPIC_API_KEY=... node scripts/validate-evidence-research.js
 */
import { ResearchAgent } from '../src/agents/research-agent.js';
import { buildEvidenceForPanel } from '../src/utils/evidence-research.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set — the evidence classifier needs Haiku.');
  process.exit(1);
}

// Three representative fixtures: a contested operate-vs-nonop, a which_operation, and a converged
// settled-operative case. Each carries the panel stances/reasoning the ledger grounds claim_text in.
const FIXTURES = [
  {
    label: 'contested · operate-vs-nonop (ACL, young athlete)',
    decisionType: 'conservative_vs_operative',
    patientContext: { ageBracket: 'young adult', demandLevel: 'competitive', bodyRegion: 'knee' },
    caseData: { bodyPart: 'knee', diagnosis: 'ACL tear', symptoms: 'instability, giving way' },
    perDP: {
      decisionPoint: { id: 'v-acl', question: 'In an active adult with a complete ACL tear, is early reconstruction or structured rehab preferred?', options: ['Structured rehab', 'Early reconstruction'] },
      verdict: 'contested',
      positions: [
        { specialistType: 'strengthSage', finalStance: 'Early reconstruction', reasoning: 'high pivoting demand and recurrent giving-way favor reconstruction' },
        { specialistType: 'movementDetective', finalStance: 'Structured rehab', reasoning: 'a rehab trial identifies copers who do well without surgery' },
      ],
      splitSummary: {
        verdict: 'contested',
        distinctStances: ['Structured rehab', 'Early reconstruction'],
        sides: [
          { stance: 'Structured rehab', specialists: [{ reasoning: 'a rehab trial identifies copers who do well without surgery' }] },
          { stance: 'Early reconstruction', specialists: [{ reasoning: 'high pivoting demand and recurrent giving-way favor reconstruction' }] },
        ],
      },
    },
  },
  {
    label: 'contested · which_operation (ACL graft choice)',
    decisionType: 'which_operation',
    patientContext: { ageBracket: 'young adult', demandLevel: 'competitive', bodyRegion: 'knee' },
    caseData: { bodyPart: 'knee', procedure: 'ACL reconstruction', diagnosis: 'ACL tear' },
    perDP: {
      decisionPoint: { id: 'v-graft', question: 'In an adult undergoing ACL reconstruction, is bone-patellar tendon-bone or hamstring autograft preferred?', options: ['BTB autograft', 'Hamstring autograft'] },
      verdict: 'contested',
      positions: [
        { specialistType: 'strengthSage', finalStance: 'BTB autograft', reasoning: 'lower re-rupture rate in high-demand pivoting athletes' },
        { specialistType: 'painWhisperer', finalStance: 'Hamstring autograft', reasoning: 'less anterior knee pain and donor-site morbidity' },
      ],
      splitSummary: {
        verdict: 'contested',
        distinctStances: ['BTB autograft', 'Hamstring autograft'],
        sides: [
          { stance: 'BTB autograft', specialists: [{ reasoning: 'lower re-rupture rate in high-demand pivoting athletes' }] },
          { stance: 'Hamstring autograft', specialists: [{ reasoning: 'less anterior knee pain and donor-site morbidity' }] },
        ],
      },
    },
  },
  {
    label: 'converged · settled-operative (septic arthritis)',
    decisionType: 'conservative_vs_operative',
    patientContext: { ageBracket: 'older adult', demandLevel: 'low-demand', bodyRegion: 'knee' },
    caseData: { bodyPart: 'knee', diagnosis: 'septic arthritis' },
    perDP: {
      decisionPoint: { id: 'v-septic', question: 'In an adult with native-joint septic arthritis of the knee, is urgent surgical drainage or observation preferred?', options: ['Observation', 'Urgent surgical drainage'] },
      verdict: 'converged',
      positions: [
        { specialistType: 'movementDetective', finalStance: 'Urgent surgical drainage', reasoning: 'untreated septic arthritis destroys cartilage; urgent washout is standard of care' },
      ],
      splitSummary: { verdict: 'converged', distinctStances: ['Urgent surgical drainage'], sides: null },
    },
  },
];

const agent = new ResearchAgent('Research Pioneer', null);

const fmt = (r) =>
  `    [${r.accepted ? 'ACCEPT' : 'reject'}] PMID ${r.pmid ?? 'N/A'} | ${r.studyType}/${r.evidenceGrade} | pop=${r.populationMatch}\n` +
  `        ${String(r.title ?? '').slice(0, 90)}\n` +
  `        rationale: ${r.rationale ?? '(none)'}`;

for (const fx of FIXTURES) {
  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(`${fx.label}`);
  console.log(`Q: ${fx.perDP.decisionPoint.question}`);
  console.log(`patient: ${JSON.stringify(fx.patientContext)}`);
  const rows = await buildEvidenceForPanel(agent, { perDP: fx.perDP, patientContext: fx.patientContext, caseData: fx.caseData, decisionType: fx.decisionType });
  if (rows.length === 0) {
    console.log('  (no citations retrieved)');
    continue;
  }
  const byStance = { option_a: [], option_b: [], abstain: [] };
  for (const r of rows) (byStance[r.supportsStance] || byStance.abstain).push(r);
  const [optionA, optionB] = fx.perDP.decisionPoint.options;
  const groups = [
    [`option_a — ${optionA}`, byStance.option_a],
    [`option_b — ${optionB}`, byStance.option_b],
    ['neither / abstain', byStance.abstain],
  ];
  for (const [name, group] of groups) {
    if (group.length === 0) continue;
    console.log(`  ▸ ${name}  (claim: ${group[0].claimText.slice(0, 100)})`);
    for (const r of group) console.log(fmt(r));
  }
  const accepted = rows.filter((r) => r.accepted).length;
  console.log(`  → ${rows.length} retrieved, ${accepted} accepted, ${rows.length - accepted} rejected`);
}

console.log('\nDONE — eyeball the acceptance + population_match calls above.');
process.exit(0);
