#!/usr/bin/env node
/**
 * Evidence-equipoise probe (which-option decisions: which_intervention + which_operation).
 *
 * These decisions ("which injection", "nail vs plate") are NOT patient-dependent equipoise — they are
 * EVIDENCE/OUTCOME equipoise: the literature is genuinely split for a typical patient. The archetype-
 * flip detector (patient-archetype variation) is the wrong tool. This probe runs ONE panel on a single
 * typical population and captures each specialist's stance + evidenceGrade + confidence (evidenceGrade
 * is NOT persisted by the normal pipeline), so we can test whether evidence-equipoise is detectable as
 * within-panel stance split and/or weak/low aggregate evidence grade — separating genuine from settled.
 *
 *   node scripts/evidence-equipoise-probe.js            # submit batch, save artifact, print id
 *   node scripts/evidence-equipoise-probe.js --analyze  # analyze the saved/ended batch
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import sql from '../src/utils/db.js';
import { POSITION_SPECIALISTS } from '../src/utils/coordination-conference.js';
import { DEMAND_RISK_ARCHETYPES } from '../src/utils/archetype-flip.js';
import { PainWhispererAgent } from '../src/agents/pain-whisperer-agent.js';
import { MovementDetectiveAgent } from '../src/agents/movement-detective-agent.js';
import { StrengthSageAgent } from '../src/agents/strength-sage-agent.js';
import { MindMenderAgent } from '../src/agents/mind-mender-agent.js';

const N = 3;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS, 10) || 2500;
const ARTIFACT = 'artifacts/evidence-equipoise.json';
const TOOL_NAME = 'specialist_position';
// Single neutral population: the validated 'average' demand/risk archetype (typical adult patient).
const TYPICAL = DEMAND_RISK_ARCHETYPES.find((a) => a.key === 'average');

function positionTool(options) {
  return {
    name: TOOL_NAME,
    description: 'Record your structured clinical position on this decision point.',
    input_schema: {
      type: 'object',
      properties: {
        reasoning: { type: 'string', description: 'FIRST reason through THIS case from your specialty lens — what does your expertise specifically weigh here, and which way does it point? Argue from your domain, not from generic caution. 2-4 sentences.' },
        stance: { type: 'string', enum: [...options, 'defer'], description: 'AFTER your reasoning, the option your reasoning leads you to, matching one provided option exactly; or "defer" only if this decision is genuinely outside your lens or the evidence is truly insufficient. Do not pick an option merely because it sounds safest.' },
        confidence: { type: 'number', description: 'your confidence in this stance, 0-1' },
        evidenceGrade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'none'], description: 'strength of evidence supporting your stance (A strongest; "none" if defer)' },
      },
      required: ['reasoning', 'stance', 'confidence', 'evidenceGrade'],
    },
  };
}

const specialists = new Map([
  ['painWhisperer', new PainWhispererAgent('Pain Whisperer')],
  ['movementDetective', new MovementDetectiveAgent('Movement Detective')],
  ['strengthSage', new StrengthSageAgent('Strength Sage')],
  ['mindMender', new MindMenderAgent('Mind Mender')],
]);
const agents = POSITION_SPECIALISTS.map((t) => [t, specialists.get(t)]).filter(([, a]) => a);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function loadDPs() {
  return sql`
    SELECT id, slug, decision_type, canonical_question, option_a_label, option_b_label, expected_equipoise
    FROM decision_points
    WHERE is_active AND decision_type IN ('which_intervention','which_operation')
    ORDER BY id`;
}

function buildRequests(dps) {
  const entries = [], requests = [];
  let i = 0;
  for (const dp of dps) {
    const decisionPoint = { id: dp.slug, question: dp.canonical_question, options: [dp.option_a_label, dp.option_b_label] };
    const tool = positionTool(decisionPoint.options);
    const caseData = { archetype: TYPICAL.label, ...TYPICAL.case };
    for (let run = 1; run <= N; run++) {
      for (const [type, agent] of agents) {
        const custom_id = `req-${i++}`;
        requests.push({ custom_id, params: {
          model: MODEL, max_tokens: MAX_TOKENS, temperature: 0.3,
          system: agent.getSystemPrompt(),
          messages: [{ role: 'user', content: agent.buildPositionPrompt(caseData, decisionPoint, { population: false }) }],
          tools: [tool], tool_choice: { type: 'tool', name: TOOL_NAME },
        } });
        entries.push({ custom_id, slug: dp.slug, lab: dp.expected_equipoise, dt: dp.decision_type, type, run });
      }
    }
  }
  return { entries, requests };
}

async function submit() {
  const dps = await loadDPs();
  const { entries, requests } = buildRequests(dps);
  const batch = await client.beta.messages.batches.create({ requests });
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(ARTIFACT, JSON.stringify({ batchId: batch.id, entries }, null, 2));
  console.log(`submitted evidence-equipoise batch ${batch.id}: ${requests.length} requests over ${dps.length} DPs (N=${N})`);
  console.log(`saved ${ARTIFACT}. Analyze with: node scripts/evidence-equipoise-probe.js --analyze`);
}

async function analyze() {
  const { batchId, entries } = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  const b = await client.beta.messages.batches.retrieve(batchId);
  if (b.processing_status !== 'ended') { console.log('batch not ended yet:', b.processing_status, JSON.stringify(b.request_counts)); return; }
  const byId = new Map();
  for await (const r of await client.beta.messages.batches.results(batchId)) byId.set(r.custom_id, r);

  const bySlug = new Map();
  for (const e of entries) {
    const res = byId.get(e.custom_id);
    const block = res?.result?.type === 'succeeded' ? (res.result.message?.content || []).find((c) => c.type === 'tool_use') : null;
    const inp = block?.input;
    if (!bySlug.has(e.slug)) bySlug.set(e.slug, { lab: e.lab, dt: e.dt, obs: [] });
    if (inp) bySlug.get(e.slug).obs.push({ stance: inp.stance, grade: inp.evidenceGrade, conf: inp.confidence });
  }

  // Per-DP signals: within-panel stance split (per run), weak-evidence share (C/D/none), mean confidence.
  const gradeWeak = (g) => g === 'C' || g === 'D' || g === 'none';
  const rows = [];
  for (const [slug, d] of bySlug) {
    const nonDefer = d.obs.filter((o) => o.stance !== 'defer');
    const stances = new Set(nonDefer.map((o) => o.stance)); // distinct substantive stances across the pooled panel
    const weakShare = d.obs.length ? d.obs.filter((o) => gradeWeak(o.grade)).length / d.obs.length : 0;
    const meanConf = d.obs.length ? d.obs.reduce((s, o) => s + (o.conf || 0), 0) / d.obs.length : 0;
    rows.push({ slug, lab: d.lab, dt: d.dt, split: stances.size, weakShare, meanConf, n: d.obs.length });
  }

  const agg = {};
  for (const r of rows) {
    agg[r.lab] ??= { dps: 0, splitSum: 0, weakSum: 0, confSum: 0 };
    agg[r.lab].dps++;
    agg[r.lab].splitSum += r.split >= 2 ? 1 : 0;
    agg[r.lab].weakSum += r.weakShare;
    agg[r.lab].confSum += r.meanConf;
  }
  console.log('\nEVIDENCE-EQUIPOISE SIGNALS on a single typical population, by label:\n');
  console.log('label'.padEnd(22), 'DPs', 'split-rate', 'weak-evidence-share', 'mean-conf');
  for (const [lab, a] of Object.entries(agg).sort()) {
    console.log('  ' + lab.padEnd(20), String(a.dps).padStart(3),
      '   ' + (a.splitSum / a.dps).toFixed(2).padStart(4),
      '        ' + (a.weakSum / a.dps).toFixed(2),
      '            ' + (a.confSum / a.dps).toFixed(2));
  }
  // Detection-rule sweep: which-option genuine = positive (want contested), settled = negative.
  const genuine = rows.filter((r) => r.lab === 'genuine_equipoise');
  const settled = rows.filter((r) => r.lab !== 'genuine_equipoise');
  const RULES = {
    'split>=2':                 (r) => r.split >= 2,
    'weak>=0.25':               (r) => r.weakShare >= 0.25,
    'conf<0.78':                (r) => r.meanConf < 0.78,
    'conf<0.80':                (r) => r.meanConf < 0.80,
    'split OR weak>=0.25':      (r) => r.split >= 2 || r.weakShare >= 0.25,
    'split OR weak>=.17 OR conf<.78': (r) => r.split >= 2 || r.weakShare >= 0.17 || r.meanConf < 0.78,
    'split OR weak>=.25 OR conf<.75': (r) => r.split >= 2 || r.weakShare >= 0.25 || r.meanConf < 0.75,
  };
  console.log('\nDETECTION-RULE SWEEP (evidence-equipoise detector for which-option decisions):');
  console.log('rule'.padEnd(34), 'sens(genuine)', ' spec(settled)');
  for (const [name, fn] of Object.entries(RULES)) {
    const sens = genuine.filter(fn).length / genuine.length;
    const spec = settled.filter((r) => !fn(r)).length / settled.length;
    console.log('  ' + name.padEnd(32), (genuine.filter(fn).length + '/' + genuine.length + '=' + sens.toFixed(2)).padEnd(14),
      settled.filter((r) => !fn(r)).length + '/' + settled.length + '=' + spec.toFixed(2));
  }
  console.log('\nper-DP (sorted by weak-evidence share):');
  for (const r of rows.sort((a, b) => b.weakShare - a.weakShare)) {
    console.log('  weak=' + r.weakShare.toFixed(2) + ' split=' + r.split + ' conf=' + r.meanConf.toFixed(2) +
      '  [' + r.lab + '/' + r.dt + '] ' + r.slug);
  }
}

if (process.argv.includes('--analyze')) await analyze();
else await submit();
process.exit(0);
