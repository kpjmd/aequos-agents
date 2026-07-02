#!/usr/bin/env node

/**
 * Interactive Test Scenarios - AequOs Agents
 * 
 * This script demonstrates real patient recovery scenarios and multi-agent consultations
 */

import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const API_BASE = 'http://localhost:3000';

class AequOsScenarios {
  constructor() {
    this.patientId = `patient_${Date.now()}`;
  }

  async log(title, data = null) {
    console.log(`\n🏥 ${title}`);
    console.log('=' * 60);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  async logStep(step, description) {
    console.log(`\n📋 Step ${step}: ${description}`);
  }

  async runCompletePatientScenario() {
    console.log('\n🎯 COMPLETE PATIENT RECOVERY SCENARIO');
    console.log('This demonstrates a full patient journey from injury to recovery');
    console.log('=' * 80);

    // Step 1: Initial Triage
    await this.logStep(1, 'Emergency Triage - Lower Back Injury');
    
    const triageData = {
      symptoms: [
        "Severe lower back pain after lifting heavy box",
        "Pain radiates down right leg to knee", 
        "Difficulty standing upright",
        "Numbness in right foot",
        "Pain level 8/10"
      ],
      severity: "severe",
      duration: "2 hours",
      patientAge: 35,
      activityLevel: "very active",
      previousInjuries: ["minor back strain 2 years ago"],
      currentMedications: [],
      urgency: "urgent"
    };

    const triageResponse = await fetch(`${API_BASE}/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(triageData)
    });
    
    const triageResult = await triageResponse.json();
    await this.log('TRIAGE ASSESSMENT RESULT', {
      urgency: triageResult.triage?.urgency || 'Not classified',
      recommendedSpecialists: triageResult.triage?.recommendedSpecialists?.slice(0, 3) || [],
      immediateActions: triageResult.triage?.immediateActions || 'Assessment pending'
    });

    // Step 2: Multi-Specialist Consultation  
    await this.logStep(2, 'Multi-Specialist Team Consultation');
    
    const consultationData = {
      caseData: {
        patientId: this.patientId,
        diagnosis: "Suspected lumbar disc herniation with radiculopathy",
        symptoms: triageData.symptoms,
        urgency: "high",
        complexity: "moderate"
      },
      requiredSpecialists: ["painWhisperer", "movementDetective", "mindMender"]
    };

    const consultationResponse = await fetch(`${API_BASE}/consultation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(consultationData)
    });
    
    const consultationResult = await consultationResponse.json();
    await this.log('MULTI-SPECIALIST CONSULTATION', {
      specialistsConsulted: Object.keys(consultationResult.consultation?.specialistAssessments || {}),
      coordinatedPlan: consultationResult.consultation?.coordinatedPlan || 'Plan being developed',
      consensus: consultationResult.consultation?.consensus || 'Assessment in progress'
    });

    // Step 3: Individual Specialist Assessments
    await this.logStep(3, 'Detailed Pain Assessment');
    
    const painAssessment = {
      symptoms: ["Sharp burning pain", "Radiating leg pain", "Morning stiffness"],
      painLevel: 8,
      duration: "acute - 2 hours",
      triggers: ["lifting", "bending forward", "coughing"],
      currentTreatments: ["ice pack"],
      functionalImpact: {
        walking: "severely limited",
        sitting: "impossible",
        sleeping: "disrupted"
      }
    };

    const painResponse = await fetch(`${API_BASE}/agents/painWhisperer/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(painAssessment)
    });
    
    const painResult = await painResponse.json();
    await this.log('PAIN SPECIALIST ASSESSMENT', {
      agent: painResult.agent,
      hasDetailedAssessment: !!painResult.assessment,
      assessmentLength: painResult.assessment?.length || 0
    });

    // Step 4: Movement Analysis
    await this.logStep(4, 'Biomechanical Movement Analysis');
    
    const movementData = {
      gaitPattern: "antalgic gait - favoring right leg",
      rangeOfMotion: {
        lumbar_flexion: 10, // severely limited
        hip_flexion: 45,
        knee_extension: 0
      },
      postureAnalysis: "forward lean, guarded movement",
      functionalTests: {
        straight_leg_raise: "positive at 30 degrees",
        sitting_tolerance: "less than 5 minutes"
      }
    };

    const movementResponse = await fetch(`${API_BASE}/agents/movementDetective/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(movementData)
    });
    
    const movementResult = await movementResponse.json();
    await this.log('MOVEMENT ANALYSIS', {
      agent: movementResult.agent,
      hasAnalysis: !!movementResult.assessment
    });

    // Step 5: Start Recovery Tracking
    await this.logStep(5, 'Initialize Recovery Plan');
    
    const recoveryPlan = {
      patientId: this.patientId,
      initialAssessment: {
        condition: "lumbar_disc_herniation",
        severity: "severe",
        painLevel: 8,
        functionalScore: 15, // very low
        rangeOfMotion: { lumbar_flexion: 10 },
        strengthMetrics: { core: 30, back: 25 },
        activityLevel: "bedrest",
        qualityOfLife: {
          physical_health: 20,
          mental_health: 40,
          pain_interference: 90
        },
        goals: [
          "Reduce pain to manageable level (4/10)",
          "Return to basic daily activities",
          "Return to work in 6-8 weeks",
          "Prevent future injury"
        ]
      }
    };

    const recoveryResponse = await fetch(`${API_BASE}/recovery/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recoveryPlan)
    });
    
    const recoveryResult = await recoveryResponse.json();
    await this.log('RECOVERY PLAN INITIALIZED', {
      patientId: this.patientId,
      hasGoals: !!recoveryResult.tracking?.recoveryGoals,
      timeline: recoveryResult.tracking?.expectedTimeline || 'Being calculated',
      phase: 'acute'
    });

    // Step 6: Simulate Progress Update (2 weeks later)
    await this.logStep(6, 'Progress Update - 2 Weeks Later');
    
    const progressUpdate = {
      patientId: this.patientId,
      progressData: {
        painLevel: 5, // improvement from 8
        functionalScore: 35, // improvement from 15
        rangeOfMotion: { lumbar_flexion: 25 }, // improvement from 10
        notes: "Significant improvement with physical therapy and pain management",
        milestonesReached: [
          "Can sit for 30 minutes",
          "Walking without assistance",
          "Pain reduced by 40%"
        ],
        treatmentCompliance: "excellent",
        concerns: "Still some morning stiffness"
      }
    };

    const updateResponse = await fetch(`${API_BASE}/recovery/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progressUpdate)
    });
    
    const updateResult = await updateResponse.json();
    await this.log('PROGRESS UPDATE', {
      success: updateResult.success,
      improvementDetected: true,
      tokensAwarded: updateResult.rewards?.length || 0
    });

    // Step 7: Check System Status
    await this.logStep(7, 'System Status & Analytics');
    
    const statusResponse = await fetch(`${API_BASE}/status`);
    const statusResult = await statusResponse.json();
    
    await this.log('SYSTEM PERFORMANCE', {
      uptime: Math.round(statusResult.system?.uptime || 0),
      activeAgents: Object.keys(statusResult.agents || {}).length,
      blockchainConnected: statusResult.blockchain?.networkName || 'offline',
      tokenEconomics: statusResult.tokenEconomics?.totalTokensDistributed || 0
    });

    console.log('\n🎉 SCENARIO COMPLETE!');
    console.log('This patient has been successfully triaged, assessed by multiple specialists,');
    console.log('and is showing good progress in their recovery plan.');
  }

  async runQuickTests() {
    console.log('\n⚡ QUICK FEATURE TESTS');
    console.log('Testing individual features quickly');
    console.log('=' * 50);

    // Quick Triage Test
    console.log('\n1. Quick Triage Test:');
    const quickTriage = await fetch(`${API_BASE}/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symptoms: ["Knee pain", "Swelling"],
        severity: "moderate",
        urgency: "routine"
      })
    });
    const triageResult = await quickTriage.json();
    console.log(`   ✓ Triage: ${triageResult.success ? 'Working' : 'Failed'}`);

    // Quick Agent Test
    console.log('\n2. Quick Agent Assessment:');
    const quickAgent = await fetch(`${API_BASE}/agents/strengthSage/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strengthLevel: "weak",
        goals: ["Improve core strength"]
      })
    });
    const agentResult = await quickAgent.json();
    console.log(`   ✓ Strength Agent: ${agentResult.success ? 'Working' : 'Failed'}`);

    // Token Statistics
    console.log('\n3. Token Economics:');
    const tokenStats = await fetch(`${API_BASE}/tokens/statistics`);
    const tokenResult = await tokenStats.json();
    console.log(`   ✓ Tokens: ${tokenResult.success ? 'Working' : 'Failed'}`);

    console.log('\n⚡ Quick tests complete!');
  }

  async showCurlExamples() {
    console.log('\n📝 CURL COMMAND EXAMPLES');
    console.log('Copy and paste these commands to test manually:');
    console.log('=' * 60);

    console.log('\n1. Health Check:');
    console.log('curl http://localhost:3000/health');

    console.log('\n2. Triage a Patient:');
    console.log(`curl -X POST http://localhost:3000/triage \\
  -H "Content-Type: application/json" \\
  -d '{
    "symptoms": ["Back pain", "Leg numbness"],
    "severity": "moderate",
    "urgency": "routine"
  }'`);

    console.log('\n3. Pain Assessment:');
    console.log(`curl -X POST http://localhost:3000/agents/painWhisperer/assess \\
  -H "Content-Type: application/json" \\
  -d '{
    "painLevel": 6,
    "symptoms": ["Chronic back pain"],
    "duration": "3 months"
  }'`);

    console.log('\n4. Start Recovery Plan:');
    console.log(`curl -X POST http://localhost:3000/recovery/start \\
  -H "Content-Type: application/json" \\
  -d '{
    "patientId": "test123",
    "initialAssessment": {
      "condition": "knee_injury",
      "painLevel": 7,
      "functionalScore": 40
    }
  }'`);

    console.log('\n5. Multi-Agent Consultation:');
    console.log(`curl -X POST http://localhost:3000/consultation \\
  -H "Content-Type: application/json" \\
  -d '{
    "caseData": {
      "diagnosis": "shoulder impingement",
      "complexity": "moderate"
    },
    "requiredSpecialists": ["painWhisperer", "movementDetective"]
  }'`);

    console.log('\n📝 Try these commands in your terminal!');
  }
}

// Main execution
async function main() {
  const scenarios = new AequOsScenarios();
  
  console.log('🏥 AequOs Agent System - Interactive Test Scenarios');
  console.log('Choose what you want to test:');
  
  const args = process.argv.slice(2);
  
  if (args.includes('--quick') || args.includes('-q')) {
    await scenarios.runQuickTests();
  } else if (args.includes('--curl') || args.includes('-c')) {
    await scenarios.showCurlExamples();
  } else if (args.includes('--full') || args.includes('-f')) {
    await scenarios.runCompletePatientScenario();
  } else {
    console.log('\nUsage options:');
    console.log('  node examples/test-scenarios.js --full     # Complete patient scenario');
    console.log('  node examples/test-scenarios.js --quick    # Quick feature tests');
    console.log('  node examples/test-scenarios.js --curl     # Show curl examples');
    console.log('\nOr run without arguments to see this help.');
    
    console.log('\n🚀 For a full demo, run:');
    console.log('  node examples/test-scenarios.js --full');
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default AequOsScenarios;