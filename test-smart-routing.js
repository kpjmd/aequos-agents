#!/usr/bin/env node

/**
 * Test script for smart routing with varying data completeness
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

// Test cases with varying data completeness
const testCases = [
  {
    name: 'Complete Data Test',
    description: 'All specialist data fields present',
    caseData: {
      symptoms: 'severe knee pain when walking and climbing stairs',
      primaryComplaint: 'knee pain',
      painLevel: 7,
      duration: 'chronic',
      age: 42,
      location: 'right knee',
      history: 'post-surgical knee replacement',
      painData: {
        location: 'right knee',
        quality: 'sharp and throbbing',
        triggers: ['walking', 'stairs', 'standing'],
        relievers: ['rest', 'ice']
      },
      movementData: {
        restrictions: ['bending', 'squatting'],
        patterns: ['antalgic gait'],
        gaitProblems: true
      },
      functionalData: {
        limitations: ['climbing stairs', 'walking long distances'],
        goals: ['return to normal walking', 'climb stairs without pain'],
        strengthDeficits: true
      },
      psychData: {
        anxietyLevel: 6,
        fearAvoidance: true,
        copingStrategies: ['meditation', 'breathing exercises']
      }
    }
  },
  {
    name: 'Partial Data Test',
    description: 'Only core data and pain info',
    caseData: {
      symptoms: 'moderate back pain',
      primaryComplaint: 'lower back pain',
      painLevel: 6,
      duration: 'acute',
      age: 35,
      location: 'lower back'
    }
  },
  {
    name: 'Minimal Data Test',
    description: 'Only basic symptoms',
    caseData: {
      symptoms: 'knee hurts when walking',
      primaryComplaint: 'knee pain'
    }
  },
  {
    name: 'No Psych Data Test',
    description: 'Missing psychological data for mind mender',
    caseData: {
      symptoms: 'shoulder pain and limited range of motion',
      primaryComplaint: 'shoulder injury',
      painLevel: 5,
      movementDysfunction: true,
      functionalLimitations: true
    }
  }
];

async function testConsultation(testCase) {
  console.log('\n' + '='.repeat(60));
  console.log(`Test: ${testCase.name}`);
  console.log(`Description: ${testCase.description}`);
  console.log('='.repeat(60));
  
  try {
    const response = await fetch(`${API_BASE}/consultation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        caseData: testCase.caseData,
        mode: 'fast'
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Consultation successful');
      console.log(`Data Completeness: ${Math.round(result.consultation.dataCompleteness * 100)}%`);
      console.log(`Triage Confidence: ${Math.round(result.consultation.triageConfidence * 100)}%`);
      console.log(`Participating Specialists: ${result.consultation.participatingSpecialists.join(', ')}`);
      
      // Show specialist coverage
      if (result.consultation.specialistCoverage) {
        console.log('\nSpecialist Coverage:');
        for (const [specialist, covered] of Object.entries(result.consultation.specialistCoverage)) {
          console.log(`  ${specialist}: ${covered ? '✓' : '✗'}`);
        }
      }
      
      // Show suggested follow-up questions
      if (result.consultation.suggestedFollowUp && result.consultation.suggestedFollowUp.length > 0) {
        console.log('\nSuggested Follow-up Questions:');
        result.consultation.suggestedFollowUp.forEach((q, i) => {
          console.log(`  ${i + 1}. ${q}`);
        });
      }
      
      console.log(`\nResponse Time: ${result.responseTime}ms`);
    } else {
      console.log('❌ Consultation failed:', result.error);
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

async function testFeedback() {
  console.log('\n' + '='.repeat(60));
  console.log('Test: Feedback Endpoint');
  console.log('='.repeat(60));
  
  const feedbackData = {
    consultationId: 'consultation_test_123',
    patientId: 'patient_test_123',
    feedback: {
      userSatisfaction: 9,
      outcomeSuccess: true,
      mdReview: {
        approved: true,
        corrections: [],
        additionalNotes: 'Excellent comprehensive assessment',
        specialistAccuracy: {
          pain: 0.9,
          movement: 0.85,
          strength: 0.88
        }
      },
      followUpDataProvided: {
        painDescription: 'sharp, intermittent',
        triggerMovements: 'climbing stairs, prolonged sitting'
      }
    }
  };
  
  try {
    const response = await fetch(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(feedbackData)
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Feedback processed successfully');
      console.log(`Feedback ID: ${result.feedbackId}`);
      
      if (result.tokenRewards && result.tokenRewards.length > 0) {
        console.log('\nToken Rewards Distributed:');
        result.tokenRewards.forEach(reward => {
          console.log(`  ${reward.agent}: ${reward.reward} tokens (Accuracy: ${reward.accuracy})`);
        });
      }
    } else {
      console.log('❌ Feedback processing failed:', result.error);
    }
  } catch (error) {
    console.error('❌ Feedback test failed:', error.message);
  }
}

async function runAllTests() {
  console.log('🚀 Starting AequOs Smart Routing Tests\n');
  
  // Check if API is running
  try {
    const health = await fetch(`${API_BASE}/health`);
    const healthData = await health.json();
    console.log(`✅ API Status: ${healthData.status}`);
    console.log(`Agents Available: ${healthData.agents}`);
  } catch (error) {
    console.error('❌ API not available. Please ensure the server is running.');
    process.exit(1);
  }
  
  // Run consultation tests
  for (const testCase of testCases) {
    await testConsultation(testCase);
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Test feedback endpoint
  await testFeedback();
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests completed');
  console.log('='.repeat(60));
}

// Run tests
runAllTests().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});