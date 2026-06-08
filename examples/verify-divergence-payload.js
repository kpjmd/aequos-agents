#!/usr/bin/env node

/**
 * THROWAWAY verification: confirm the live consultation result exposes
 * result.synthesizedRecommendations.coordinationMetadata.divergences in the documented shape,
 * and dump a real sample payload (for frontend typing). Runs the REAL coordinator path on the
 * ACL equipoise case (normal mode, real Anthropic calls; no server/blockchain/DB).
 *
 * Retries up to 2 times to try to capture a POPULATED divergence (the gate is stochastic on ACL);
 * an empty array still validates the contract.
 *
 *   node examples/verify-divergence-payload.js
 */
import dotenv from 'dotenv';
dotenv.config();
process.env.ENABLE_BLOCKCHAIN = 'false';

import { writeFileSync, mkdirSync } from 'fs';
import AgentCoordinator from '../src/utils/agent-coordinator.js';
import { TriageAgent } from '../src/agents/triage-agent.js';
import { PainWhispererAgent } from '../src/agents/pain-whisperer-agent.js';
import { MovementDetectiveAgent } from '../src/agents/movement-detective-agent.js';
import { StrengthSageAgent } from '../src/agents/strength-sage-agent.js';
import { MindMenderAgent } from '../src/agents/mind-mender-agent.js';

const SPECIALIST_TYPES = ['triage', 'painWhisperer', 'movementDetective', 'strengthSage', 'mindMender'];

const CASE_DATA = {
  patientId: 'verify_acl', age: 28,
  primaryComplaint: 'Tore my ACL playing soccer; deciding about surgery',
  symptoms: 'complete ACL rupture confirmed on MRI, knee giving way, swelling resolved, wants to return to recreational soccer',
  painLevel: 3, duration: 'subacute', anxietyLevel: 6, movementDysfunction: true,
  functionalLimitations: ['cutting', 'pivoting', 'running'], strengthDeficits: true,
  rawQuery: 'I am 28 and tore my ACL playing recreational soccer. The swelling is gone but my knee feels unstable when I pivot. Should I get surgery soon or try rehab first and decide later?',
  enableDualTrack: true, urgency: 'routine',
};

function buildPanel() {
  const coordinator = new AgentCoordinator();
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

async function main() {
  const coordinator = buildPanel();
  let result, cm, attempt = 0;
  do {
    attempt++;
    console.log(`\n--- ACL consult attempt ${attempt} (normal mode, real LLM) ---`);
    result = await coordinator.coordinateMultiSpecialistConsultation(CASE_DATA, SPECIALIST_TYPES, { mode: 'normal' });
    cm = result?.synthesizedRecommendations?.coordinationMetadata;
    console.log(`  gateOpen=${cm?.gateOpen}  divergences=${cm?.divergences?.length}  decisionPoints=${cm?.decisionPoints?.length}`);
  } while (cm && cm.gateOpen === false && attempt < 2);

  // ---- Contract assertions ----
  const checks = [
    ['synthesizedRecommendations present', !!result?.synthesizedRecommendations],
    ['coordinationMetadata present', !!cm],
    ['divergences is an array', Array.isArray(cm?.divergences)],
    ['gateOpen is boolean', typeof cm?.gateOpen === 'boolean'],
    ['interAgentDialogue is an array', Array.isArray(cm?.interAgentDialogue)],
  ];
  console.log('\n=== CONTRACT CHECKS (result.synthesizedRecommendations.coordinationMetadata) ===');
  let ok = true;
  for (const [label, pass] of checks) { console.log(`  ${pass ? '✓' : '✗'} ${label}`); ok = ok && pass; }

  if (cm?.divergences?.length) {
    const d = cm.divergences[0];
    console.log('\n=== SAMPLE divergence[0] keys ===');
    console.log('  top-level:', Object.keys(d).join(', '));
    console.log('  decisionPoint:', JSON.stringify(d.decisionPoint));
    console.log('  sides[].stance:', (d.sides || []).map(s => `${s.stance} (${s.specialists.map(x => x.specialistType).join('+')})`).join('  |  '));
    console.log('  postDialogue:', JSON.stringify(d.postDialogue));
    console.log('  dialogue turns:', (d.dialogue || []).map(t => `${t.specialistType}:${t.originalStance}->${t.revisedStance}${t.changed ? '*' : ''}`).join(', '));
  } else {
    console.log('\n  (gate closed this run — divergences:[] — contract still satisfied; populated sample not captured)');
  }

  mkdirSync('artifacts', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = `artifacts/divergence-payload-sample-${stamp}.json`;
  writeFileSync(outPath, JSON.stringify({ coordinationMetadata: cm }, null, 2));
  console.log(`\n${ok ? 'CONTRACT OK' : 'CONTRACT FAILED'} — full coordinationMetadata written to ${outPath}\n`);
  if (!ok) process.exit(1);
}

main().catch(e => { console.error('verify crashed:', e); process.exit(1); });
