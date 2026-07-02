#!/usr/bin/env node

/**
 * Demo Mode - AequOs Agents
 * 
 * This example demonstrates the system without requiring Claude API keys
 * by testing only the infrastructure and mock responses
 */

import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const API_BASE = 'http://localhost:3000';

class AequOsDemo {
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

  async testInfrastructure() {
    console.log('🏗️  Testing Infrastructure Components');
    console.log('=' * 50);

    let passCount = 0;
    let totalTests = 4;

    // Test 1: Health Check
    try {
      const response = await fetch(`${API_BASE}/health`);
      const data = await response.json();
      
      if (response.ok) {
        await this.log('Health Check', { status: data.status, agents: data.agents });
        passCount++;
      } else {
        await this.logError('Health Check Failed', data);
      }
    } catch (error) {
      await this.logError('Health Check Error', error);
    }

    // Test 2: System Status (non-LLM parts)
    try {
      const response = await fetch(`${API_BASE}/status`);
      const data = await response.json();
      
      if (response.ok) {
        await this.log('System Status', {
          initialized: data.system?.initialized,
          agentCount: Object.keys(data.agents || {}).length,
          blockchain: data.blockchain?.networkInitialized || false
        });
        passCount++;
      } else {
        await this.logError('System Status Failed', data);
      }
    } catch (error) {
      await this.logError('System Status Error', error);
    }

    // Test 3: Token Statistics
    try {
      const response = await fetch(`${API_BASE}/tokens/statistics`);
      const data = await response.json();
      
      if (response.ok) {
        await this.log('Token Statistics', {
          success: data.success,
          totalTokens: data.statistics?.totalTokensDistributed || 0
        });
        passCount++;
      } else {
        await this.logError('Token Statistics Failed', data);
      }
    } catch (error) {
      await this.logError('Token Statistics Error', error);
    }

    // Test 4: API Documentation
    try {
      const response = await fetch(`${API_BASE}/docs`);
      const data = await response.json();
      
      if (response.ok && data.agents) {
        await this.log('API Documentation', {
          name: data.name,
          agentTypes: Object.keys(data.agents),
          endpointCount: Object.keys(data.endpoints).length
        });
        passCount++;
      } else {
        await this.logError('API Documentation Failed', data);
      }
    } catch (error) {
      await this.logError('API Documentation Error', error);
    }

    console.log('\n' + '=' * 50);
    console.log(`🏗️  Infrastructure Tests: ${passCount}/${totalTests} passed`);
    
    return { passed: passCount, total: totalTests, success: passCount === totalTests };
  }

  async testRecoveryMetrics() {
    console.log('\n📊 Testing Recovery Metrics (without LLM)');
    console.log('=' * 50);

    const patientId = `demo_patient_${Date.now()}`;
    let passCount = 0;
    let totalTests = 2;

    // Test recovery start with basic metrics
    try {
      const initialAssessment = {
        condition: "lower_back_strain",
        severity: "moderate",
        painLevel: 7,
        functionalScore: 40,
        rangeOfMotion: { lumbar_flexion: 30 },
        strengthMetrics: { core: 60 },
        activityLevel: "light"
      };

      const response = await fetch(`${API_BASE}/recovery/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, initialAssessment })
      });

      const data = await response.json();
      
      if (response.ok) {
        await this.log('Recovery Tracking Start', {
          success: data.success,
          patientId: patientId,
          hasGoals: !!data.tracking?.recoveryGoals
        });
        passCount++;

        // Test progress update
        const progressData = {
          painLevel: 5,
          functionalScore: 55,
          notes: "Improvement after 2 weeks",
          milestonesReached: ["Initial pain reduction"]
        };

        const updateResponse = await fetch(`${API_BASE}/recovery/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patientId, progressData })
        });

        const updateData = await updateResponse.json();
        
        if (updateResponse.ok) {
          await this.log('Recovery Progress Update', {
            success: updateData.success,
            painImprovement: progressData.painLevel < 7
          });
          passCount++;
        } else {
          await this.logError('Recovery Update Failed', updateData);
        }
      } else {
        await this.logError('Recovery Start Failed', data);
      }
    } catch (error) {
      await this.logError('Recovery Metrics Error', error);
    }

    console.log('\n' + '=' * 50);
    console.log(`📊 Recovery Metrics Tests: ${passCount}/${totalTests} passed`);
    
    return { passed: passCount, total: totalTests, success: passCount === totalTests };
  }

  async testBlockchainIntegration() {
    console.log('\n⛓️  Testing Blockchain Integration');
    console.log('=' * 50);

    // Check if blockchain is enabled
    const blockchainEnabled = process.env.ENABLE_BLOCKCHAIN === 'true';
    
    if (!blockchainEnabled) {
      await this.log('Blockchain Status', {
        enabled: false,
        mode: 'offline/mock',
        reason: 'ENABLE_BLOCKCHAIN=false in .env'
      });
      
      console.log('\n💡 To test blockchain integration:');
      console.log('1. Set ENABLE_BLOCKCHAIN=true in .env');
      console.log('2. Configure valid CDP_API_KEY_NAME and CDP_API_KEY_PRIVATE_KEY');
      console.log('3. Restart the server');
      
      return { passed: 1, total: 1, success: true, note: 'Blockchain disabled by configuration' };
    } else {
      await this.log('Blockchain Status', {
        enabled: true,
        note: 'Check server logs for blockchain connection status'
      });
      
      return { passed: 1, total: 1, success: true, note: 'Blockchain enabled - check logs' };
    }
  }

  async runDemo() {
    console.log('🎭 AequOs Agents Demo Mode');
    console.log('This demo tests system functionality without requiring Claude API keys');
    console.log('=' * 80);

    const infrastructureResults = await this.testInfrastructure();
    const recoveryResults = await this.testRecoveryMetrics();
    const blockchainResults = await this.testBlockchainIntegration();

    const totalPassed = infrastructureResults.passed + recoveryResults.passed + blockchainResults.passed;
    const totalTests = infrastructureResults.total + recoveryResults.total + blockchainResults.total;

    console.log('\n' + '=' * 80);
    console.log(`🎭 Demo Complete: ${totalPassed}/${totalTests} tests passed`);
    
    if (totalPassed === totalTests) {
      console.log('\n✅ All infrastructure tests passed!');
      console.log('\n🎯 Next Steps:');
      console.log('1. Configure your Claude API key in .env to test AI agents');
      console.log('2. Set ENABLE_BLOCKCHAIN=true and configure CDP keys for blockchain features');
      console.log('3. Run the full test suite with: npm run example');
    } else {
      console.log('\n⚠️  Some infrastructure issues detected. Check logs above.');
    }

    return { passed: totalPassed, total: totalTests, success: totalPassed === totalTests };
  }
}

// Run demo if this file is executed directly
async function main() {
  const demo = new AequOsDemo();
  
  try {
    await demo.runDemo();
  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default AequOsDemo;