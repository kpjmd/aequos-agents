#!/usr/bin/env node

/**
 * Divergence Spike (Step 0 of the real-inter-agent-dialogue plan)
 * ---------------------------------------------------------------
 * THROWAWAY validation harness. Question it answers:
 *   "Does the existing 5-specialist panel meaningfully diverge today, and where?"
 *
 * It runs the REAL coordinateMultiSpecialistConsultation path (real Anthropic calls,
 * no blockchain/DB/server) on a curated case set spanning clear-cut -> clinical
 * equipoise, then uses an LLM judge to classify each specialist's stance on an
 * authored central decision point. Divergence = >=2 distinct substantive stances
 * above a confidence floor.
 *
 * Design note (per plan constraints): we do NOT ask agents "do you disagree?".
 * We read their natural responses and detect divergence structurally via the judge.
 * A "doesn't address the decision" verdict is a first-class, informative outcome.
 *
 * Usage:
 *   node examples/divergence-spike.js          # run all cases
 *   node examples/divergence-spike.js 1        # run only the first case (cheap smoke test)
 *   node examples/divergence-spike.js 3-5      # run cases 3..5 (1-indexed)
 */

import dotenv from 'dotenv';
dotenv.config();

// Force blockchain OFF for the spike regardless of .env — we only want the LLM panel.
process.env.ENABLE_BLOCKCHAIN = 'false';

import { writeFileSync, mkdirSync } from 'fs';
import { ChatAnthropic } from '@langchain/anthropic';

import AgentCoordinator from '../src/utils/agent-coordinator.js';
import { TriageAgent } from '../src/agents/triage-agent.js';
import { PainWhispererAgent } from '../src/agents/pain-whisperer-agent.js';
import { MovementDetectiveAgent } from '../src/agents/movement-detective-agent.js';
import { StrengthSageAgent } from '../src/agents/strength-sage-agent.js';
import { MindMenderAgent } from '../src/agents/mind-mender-agent.js';

const SPECIALIST_TYPES = ['triage', 'painWhisperer', 'movementDetective', 'strengthSage', 'mindMender'];
const CONFIDENCE_FLOOR = 0.6; // a stance must clear this to count toward divergence

// ---------------------------------------------------------------------------
// Curated cases: clear-cut (expect convergence) -> equipoise (divergence may surface)
// Each carries FLAT trigger fields so every specialist routes to its real
// assessment method (the coordinator routes on caseData.painLevel/symptoms/etc.,
// NOT nested initialAssessment), plus a rawQuery carrying the central decision.
// ---------------------------------------------------------------------------
const CASES = [
  {
    id: 'clear-ankle-sprain',
    tier: 'clear',
    title: 'Acute lateral ankle sprain, no red flags',
    decisionPoint: 'Initial management approach for an acute grade I lateral ankle sprain',
    options: [
      { key: 'conservative_rice_early_mobilize', label: 'Conservative: RICE + early protected weight-bearing/mobilization' },
      { key: 'immobilize_refer_imaging', label: 'Immobilize and refer for imaging/orthopedic eval' },
    ],
    caseData: {
      patientId: 'spike_ankle',
      age: 30,
      primaryComplaint: 'Rolled my ankle playing basketball yesterday, outer side is swollen and sore',
      symptoms: 'lateral ankle pain and swelling after inversion, painful to walk, no numbness',
      painLevel: 5,
      duration: 'acute',
      anxietyLevel: 3,
      movementDysfunction: true,
      functionalLimitations: ['walking', 'weight-bearing'],
      rawQuery: 'I rolled my ankle yesterday playing basketball. It is swollen on the outside and hurts to walk but I can bear some weight. What should I do?',
      enableDualTrack: true,
      urgency: 'routine',
    },
  },
  {
    id: 'clear-mechanical-lbp',
    tier: 'clear',
    title: 'Acute non-specific mechanical low back pain, no red flags',
    decisionPoint: 'Initial management for acute non-specific mechanical low back pain without red flags',
    options: [
      { key: 'stay_active_conservative', label: 'Stay active + conservative self-care, reassurance, avoid imaging' },
      { key: 'imaging_referral', label: 'Early imaging and/or specialist referral' },
    ],
    caseData: {
      patientId: 'spike_lbp',
      age: 38,
      primaryComplaint: 'Tweaked my lower back lifting a box 3 days ago',
      symptoms: 'lower back pain after lifting, stiff in the morning, no leg pain, no numbness or weakness',
      painLevel: 5,
      duration: 'acute',
      anxietyLevel: 4,
      movementDysfunction: true,
      functionalLimitations: ['bending', 'lifting'],
      rawQuery: 'I hurt my lower back lifting a box 3 days ago. No pain down my legs, no numbness. Should I rest, stay active, or get a scan?',
      enableDualTrack: true,
      urgency: 'routine',
    },
  },
  {
    id: 'equipoise-rotator-cuff',
    tier: 'equipoise',
    title: 'Partial-thickness rotator cuff tear, 54yo recreational tennis player',
    decisionPoint: 'Surgery vs. continued conservative management for a partial-thickness supraspinatus tear',
    options: [
      { key: 'surgical_repair', label: 'Proceed toward surgical repair' },
      { key: 'conservative_rehab', label: 'Continue structured conservative rehab' },
    ],
    caseData: {
      patientId: 'spike_cuff',
      age: 54,
      primaryComplaint: 'Shoulder pain limiting my tennis; MRI shows a partial rotator cuff tear',
      symptoms: 'chronic shoulder pain and weakness with overhead motion, partial-thickness supraspinatus tear on MRI, 4 months of physical therapy with partial improvement',
      painLevel: 5,
      duration: 'chronic',
      anxietyLevel: 5,
      movementDysfunction: true,
      functionalLimitations: ['overhead reaching', 'serving in tennis'],
      strengthDeficits: true,
      rawQuery: 'I am 54 and play recreational tennis. MRI shows a partial-thickness rotator cuff tear. I have done 4 months of PT with only partial improvement. Should I get surgery or keep doing conservative rehab?',
      enableDualTrack: true,
      urgency: 'routine',
    },
  },
  {
    id: 'equipoise-acl',
    tier: 'equipoise',
    title: 'ACL rupture, 28yo recreational soccer player',
    decisionPoint: 'Early ACL reconstruction vs. rehab-first/non-operative management',
    options: [
      { key: 'early_reconstruction', label: 'Early surgical ACL reconstruction' },
      { key: 'rehab_first_nonop', label: 'Structured rehab first / non-operative, reassess later' },
    ],
    caseData: {
      patientId: 'spike_acl',
      age: 28,
      primaryComplaint: 'Tore my ACL playing soccer; deciding about surgery',
      symptoms: 'complete ACL rupture confirmed on MRI, knee giving way, swelling resolved, wants to return to recreational soccer',
      painLevel: 3,
      duration: 'subacute',
      anxietyLevel: 6,
      movementDysfunction: true,
      functionalLimitations: ['cutting', 'pivoting', 'running'],
      strengthDeficits: true,
      rawQuery: 'I am 28 and tore my ACL playing recreational soccer. The swelling is gone but my knee feels unstable when I pivot. Should I get surgery soon or try rehab first and decide later?',
      enableDualTrack: true,
      urgency: 'routine',
    },
  },
  {
    id: 'equipoise-chronic-lbp-opioid',
    tier: 'equipoise',
    title: 'Chronic low back pain, patient requesting opioids',
    decisionPoint: 'Opioid analgesia vs. non-opioid multimodal management for chronic non-specific low back pain',
    options: [
      { key: 'opioid_trial', label: 'Trial of opioid analgesia' },
      { key: 'nonopioid_multimodal', label: 'Non-opioid multimodal management (decline opioids)' },
    ],
    caseData: {
      patientId: 'spike_chronic_lbp',
      age: 47,
      primaryComplaint: 'Chronic low back pain for 8 months; nothing works and I want stronger pain meds',
      symptoms: 'chronic non-specific low back pain 8 months, no red flags, sleep disruption and low mood, frustrated, requesting opioid medication',
      painLevel: 7,
      duration: 'chronic',
      anxietyLevel: 7,
      psychologicalFactors: 'frustration, low mood, sleep disruption',
      movementDysfunction: true,
      functionalLimitations: ['prolonged sitting', 'work'],
      rawQuery: 'I have had low back pain for 8 months and nothing helps. I am exhausted and want a prescription for something strong like an opioid. Can I get that?',
      enableDualTrack: true,
      urgency: 'routine',
    },
  },
  {
    id: 'equipoise-rtp-hamstring',
    tier: 'equipoise',
    title: 'Grade 2 hamstring strain, athlete wants to play in 10 days',
    decisionPoint: 'Clear the athlete to return to play in ~10 days vs. hold for a longer criteria-based timeline',
    options: [
      { key: 'aggressive_early_rtp', label: 'Support accelerated return (~10 days) with precautions' },
      { key: 'cautious_criteria_based', label: 'Hold for longer criteria-based return (reduce re-injury risk)' },
    ],
    caseData: {
      patientId: 'spike_hamstring',
      age: 22,
      primaryComplaint: 'Grade 2 hamstring strain; I have an important match in 10 days and want to play',
      symptoms: 'grade 2 hamstring strain 1 week ago, still tender, mild weakness on resisted knee flexion, competitive sprinter',
      painLevel: 3,
      duration: 'subacute',
      anxietyLevel: 6,
      movementDysfunction: true,
      functionalLimitations: ['sprinting', 'acceleration'],
      strengthDeficits: true,
      rawQuery: 'I strained my hamstring (grade 2) a week ago. I have an important competition in 10 days. It is still a bit tender. Can I be ready to compete in 10 days?',
      enableDualTrack: true,
      urgency: 'routine',
    },
  },
];

// ---------------------------------------------------------------------------
function buildPanel() {
  const coordinator = new AgentCoordinator(); // null tokenManager -> payments skipped
  const agents = {
    triage: new TriageAgent('Triage Coordinator'),
    painWhisperer: new PainWhispererAgent('Pain Whisperer'),
    movementDetective: new MovementDetectiveAgent('Movement Detective'),
    strengthSage: new StrengthSageAgent('Strength Sage'),
    mindMender: new MindMenderAgent('Mind Mender'),
  };
  for (const [type, agent] of Object.entries(agents)) {
    coordinator.registerSpecialist(type, agent);
    if (type !== 'triage') agents.triage.registerSpecialist(type, agent);
  }
  return coordinator;
}

function extractText(inner) {
  if (!inner) return '';
  if (typeof inner === 'string') return inner;
  if (inner.rawResponse) return inner.rawResponse;
  if (typeof inner.response === 'string') return inner.response;
  return JSON.stringify(inner);
}

function makeJudge() {
  const judge = new ChatAnthropic({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    modelName: process.env.FAST_MODEL || 'claude-haiku-4-5-20251001',
    temperature: 0,
    maxTokens: 500,
  });
  judge.topP = undefined;
  return judge;
}

function parseJudgeJson(text) {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON object in judge output: ${cleaned.slice(0, 120)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function judgeStance(judge, theCase, specialistName, responseText) {
  const optionLines = theCase.options.map(o => `  - "${o.key}": ${o.label}`).join('\n');
  const prompt = `You are an impartial clinical reviewer. Read ONE specialist's response to a patient case and classify the position it supports on a SPECIFIC decision point. Do not inject your own clinical opinion — report only what THIS specialist's text supports.

CASE: ${theCase.title}
DECISION POINT: ${theCase.decisionPoint}

ALLOWED STANCES:
${optionLines}
  - "defer": the specialist explicitly defers / says there is insufficient evidence / says a physician must decide
  - "not_addressed": the response does not take a position on THIS decision point (e.g. only discusses its own domain without bearing on the decision)

SPECIALIST: ${specialistName}
SPECIALIST RESPONSE:
"""
${(responseText || '').slice(0, 6000)}
"""

Return ONLY a JSON object: {"stance": "<one allowed stance key>", "confidence": <0-1 how clearly the text supports that stance>, "rationale": "<one sentence quoting/paraphrasing the relevant part>"}`;

  const res = await judge.invoke(prompt);
  const content = typeof res?.content === 'string'
    ? res.content
    : Array.isArray(res?.content) ? res.content.map(c => c.text || '').join('') : String(res?.content ?? '');
  return parseJudgeJson(content);
}

function computeDivergence(judgments) {
  const substantive = judgments.filter(j => j.stance && j.stance !== 'defer' && j.stance !== 'not_addressed' && (j.confidence ?? 0) >= CONFIDENCE_FLOOR);
  const distinct = new Set(substantive.map(j => j.stance));
  return {
    divergent: distinct.size >= 2,
    distinctStances: [...distinct],
    substantiveCount: substantive.length,
    deferCount: judgments.filter(j => j.stance === 'defer').length,
    notAddressedCount: judgments.filter(j => j.stance === 'not_addressed').length,
  };
}

function parseSelector(arg, n) {
  if (!arg) return CASES.map((_, i) => i);
  const m = String(arg).match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return CASES.map((_, i) => i);
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : start;
  const idx = [];
  for (let i = start; i <= end; i++) if (i >= 1 && i <= n) idx.push(i - 1);
  return idx;
}

async function main() {
  const selected = parseSelector(process.argv[2], CASES.length);
  console.log(`\n=== Divergence Spike — running ${selected.length}/${CASES.length} case(s) (normal mode, real LLM calls) ===\n`);

  const coordinator = buildPanel();
  const judge = makeJudge();
  const results = [];

  for (const idx of selected) {
    const theCase = CASES[idx];
    console.log(`\n--- [${idx + 1}] ${theCase.tier.toUpperCase()}: ${theCase.title} ---`);
    const started = Date.now();
    try {
      const consult = await coordinator.coordinateMultiSpecialistConsultation(
        theCase.caseData,
        SPECIALIST_TYPES,
        { mode: 'normal' }
      );

      const perSpecialist = [];
      for (const w of consult.responses) {
        const text = extractText(w.response);
        const entry = {
          specialist: w.specialist,
          status: w.status,
          clinicalImportance: w?.response?.assessment?.clinicalImportance ?? null,
          agreementWithTriage: w?.response?.agreementWithTriage ?? null,
          textChars: text.length,
        };
        if (w.status === 'success' && text) {
          try {
            const j = await judgeStance(judge, theCase, w.specialist, text);
            entry.stance = j.stance;
            entry.confidence = j.confidence;
            entry.rationale = j.rationale;
          } catch (e) {
            entry.stance = 'judge_error';
            entry.judgeError = e.message;
          }
        } else {
          entry.stance = 'no_response';
        }
        perSpecialist.push(entry);
        console.log(`    ${entry.specialist.padEnd(20)} ${String(entry.stance).padEnd(28)} conf=${entry.confidence ?? '-'}`);
      }

      const divergence = computeDivergence(perSpecialist.filter(e => e.stance && !['judge_error', 'no_response'].includes(e.stance)));
      console.log(`    => ${divergence.divergent ? 'DIVERGENT' : 'converged'} | distinct=[${divergence.distinctStances.join(', ')}] defer=${divergence.deferCount} notAddressed=${divergence.notAddressedCount}`);

      results.push({
        caseId: theCase.id,
        tier: theCase.tier,
        title: theCase.title,
        decisionPoint: theCase.decisionPoint,
        options: theCase.options,
        durationMs: Date.now() - started,
        consultationId: consult.consultationId,
        coordinationMetadata: consult.synthesizedRecommendations?.coordinationMetadata ?? null,
        perSpecialist,
        divergence,
      });
    } catch (e) {
      console.error(`    !! case failed: ${e.message}`);
      results.push({ caseId: theCase.id, tier: theCase.tier, title: theCase.title, error: e.message });
    }
  }

  mkdirSync('artifacts', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = `artifacts/divergence-spike-${stamp}.json`;
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), confidenceFloor: CONFIDENCE_FLOOR, results }, null, 2));

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    if (r.error) { console.log(`  [${r.tier}] ${r.title}: ERROR ${r.error}`); continue; }
    console.log(`  [${r.tier}] ${r.title}: ${r.divergence.divergent ? 'DIVERGENT' : 'converged'} (${r.divergence.distinctStances.join(' vs ') || 'no substantive stances'}; defer=${r.divergence.deferCount}, notAddressed=${r.divergence.notAddressedCount})`);
  }
  console.log(`\nArtifact: ${outPath}\n`);
}

main().catch(e => { console.error('Spike crashed:', e); process.exit(1); });
