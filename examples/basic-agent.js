#!/usr/bin/env node

/**
 * Basic Agent Example - AequOs Agents
 * 
 * This example demonstrates basic agent functionality and API testing
 */

import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const API_BASE = 'http://localhost:3000';

class AequOsTester {
  constructor() {
    this.results = [];
  }

  async log(message, data = null) {
    console.log(`\n✓ ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  async logError(message, error) {
    console.error(`\n❌ ${message}`);
    console.error(error.message || error);
  }

  async testHealthCheck() {
    try {
      const response = await fetch(`${API_BASE}/health`);
      const data = await response.json();
      
      if (response.ok) {
        await this.log('Health Check Passed', data);
        return true;
      } else {
        await this.logError('Health Check Failed', data);
        return false;
      }
    } catch (error) {
      await this.logError('Health Check Error', error);
      return false;
    }
  }

  async testSystemStatus() {
    try {
      const response = await fetch(`${API_BASE}/status`);
      const data = await response.json();
      
      if (response.ok) {
        await this.log('System Status Check Passed', {
          system: data.system,
          agentCount: Object.keys(data.agents).length,
          blockchain: data.blockchain
        });
        return data;
      } else {
        await this.logError('System Status Failed', data);
        return false;
      }
    } catch (error) {
      await this.logError('System Status Error', error);
      return false;
    }
  }

  async testTriageCase() {
    const caseData = {
      symptoms: [
        "Lower back pain for 3 weeks",
        "Pain radiates down left leg",
        "Difficulty walking more than 10 minutes",
        "Morning stiffness"
      ],
      severity: "moderate",
      duration: "3 weeks",
      patientAge: 45,
      activityLevel: "moderate",
      previousInjuries: [],
      currentMedications: ["ibuprofen"],
      urgency: "routine"
    };

    try {
      const response = await fetch(`${API_BASE}/triage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(caseData)
      });

      const data = await response.json();
      
      if (response.ok) {
        await this.log('Triage Test Passed', {
          success: data.success,
          urgency: data.triage?.urgency,
          recommendedSpecialists: data.triage?.recommendedSpecialists?.slice(0, 2) || []
        });
        return data;
      } else {
        await this.logError('Triage Test Failed', data);
        return false;
      }
    } catch (error) {
      await this.logError('Triage Test Error', error);
      return false;
    }
  }

  async testSpecialistConsultation() {
    const assessmentData = {
      symptoms: ["Chronic lower back pain", "Limited mobility"],
      painLevel: 7,
      duration: "6 months",
      triggers: ["sitting for long periods", "bending forward"],
      currentTreatments: ["physical therapy", "pain medication"]
    };

    try {
      const response = await fetch(`${API_BASE}/agents/painWhisperer/assess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(assessmentData)
      });

      const data = await response.json();
      
      if (response.ok) {
        await this.log('Pain Specialist Consultation Passed', {
          success: data.success,
          agent: data.agent,
          hasAssessment: !!data.assessment
        });
        return data;
      } else {
        await this.logError('Pain Specialist Consultation Failed', data);
        return false;
      }
    } catch (error) {
      await this.logError('Pain Specialist Consultation Error', error);
      return false;
    }
  }

  async testRecoveryTracking() {
    const patientId = `test_patient_${Date.now()}`;
    const initialAssessment = {
      condition: "Lower back strain",
      painLevel: 8,
      functionalLevel: 3,
      goals: ["Return to work", "Pain-free daily activities"],
      timeline: "8-12 weeks"
    };

    try {
      // Start recovery tracking
      const startResponse = await fetch(`${API_BASE}/recovery/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ patientId, initialAssessment })
      });

      const startData = await startResponse.json();
      
      if (startResponse.ok) {
        await this.log('Recovery Tracking Start Passed', {
          success: startData.success,
          patientId: patientId
        });

        // Update progress
        const progressData = {
          painLevel: 5,
          functionalLevel: 6,
          notes: "Significant improvement after 2 weeks of treatment",
          milestonesReached: ["Pain reduction", "Improved mobility"]
        };

        const updateResponse = await fetch(`${API_BASE}/recovery/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ patientId, progressData })
        });

        const updateData = await updateResponse.json();
        
        if (updateResponse.ok) {
          await this.log('Recovery Progress Update Passed', {
            success: updateData.success,
            improvementDetected: true
          });
          return { start: startData, update: updateData };
        } else {
          await this.logError('Recovery Progress Update Failed', updateData);
          return false;
        }
      } else {
        await this.logError('Recovery Tracking Start Failed', startData);
        return false;
      }
    } catch (error) {
      await this.logError('Recovery Tracking Error', error);
      return false;
    }
  }

  async testTokenStatistics() {
    try {
      const response = await fetch(`${API_BASE}/tokens/statistics`);
      const data = await response.json();
      
      if (response.ok) {
        await this.log('Token Statistics Test Passed', {
          success: data.success,
          totalTokens: data.statistics?.totalTokensDistributed || 0,
          activeAgents: data.statistics?.agentCount || 0
        });
        return data;
      } else {
        await this.logError('Token Statistics Test Failed', data);
        return false;
      }
    } catch (error) {
      await this.logError('Token Statistics Test Error', error);
      return false;
    }
  }

  async runAllTests() {
    console.log('🚀 Starting AequOs Agents Basic Testing Suite');
    console.log('=' * 50);

    let passCount = 0;
    let totalTests = 6;

    // Test 1: Health Check
    if (await this.testHealthCheck()) passCount++;

    // Test 2: System Status
    if (await this.testSystemStatus()) passCount++;

    // Test 3: Triage Case
    if (await this.testTriageCase()) passCount++;

    // Test 4: Specialist Consultation
    if (await this.testSpecialistConsultation()) passCount++;

    // Test 5: Recovery Tracking
    if (await this.testRecoveryTracking()) passCount++;

    // Test 6: Token Statistics
    if (await this.testTokenStatistics()) passCount++;

    console.log('\n' + '=' * 50);
    console.log(`🏁 Testing Complete: ${passCount}/${totalTests} tests passed`);
    
    if (passCount === totalTests) {
      console.log('✅ All tests passed! AequOs Agents system is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Check the logs above for details.');
    }

    return { passed: passCount, total: totalTests, success: passCount === totalTests };
  }
}

// Run tests if this file is executed directly
async function main() {
  const tester = new AequOsTester();
  
  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default AequOsTester;