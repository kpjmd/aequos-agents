#!/usr/bin/env node

/**
 * AequOs Agents - End-to-End Recovery Scenario Example
 * 
 * This example demonstrates a complete patient recovery journey
 * using the multi-agent system with token economics and blockchain integration.
 */

import dotenv from 'dotenv';
import logger from '../src/utils/logger.js';
import AgentCoordinator from '../src/utils/agent-coordinator.js';
import TokenManager from '../src/utils/token-manager.js';
import RecoveryMetrics from '../src/utils/recovery-metrics.js';
import BlockchainUtils from '../src/utils/blockchain-utils.js';

// Import all specialist agents
import { TriageAgent } from '../src/agents/triage-agent.js';
import { PainWhispererAgent } from '../src/agents/pain-whisperer-agent.js';
import { MovementDetectiveAgent } from '../src/agents/movement-detective-agent.js';
import { StrengthSageAgent } from '../src/agents/strength-sage-agent.js';
import { MindMenderAgent } from '../src/agents/mind-mender-agent.js';

// Load environment variables
dotenv.config();

class RecoveryScenarioDemo {
  constructor() {
    this.coordinator = new AgentCoordinator();
    this.tokenManager = new TokenManager();
    this.recoveryMetrics = new RecoveryMetrics();
    this.blockchainUtils = new BlockchainUtils();
    this.agents = {};
  }

  async initialize() {
    try {
      logger.info('🚀 Initializing AequOs Recovery Scenario Demo');
      
      // Initialize blockchain utilities
      await this.blockchainUtils.initialize();
      logger.info('✅ Blockchain utilities initialized');
      
      // Create and initialize agents
      await this.createAgents();
      
      // Initialize token manager with agents
      await this.initializeTokenEconomics();
      
      logger.info('🎯 Demo initialization complete');
      return true;
    } catch (error) {
      logger.error(`❌ Initialization failed: ${error.message}`);
      return false;
    }
  }

  async createAgents() {
    try {
      logger.info('👥 Creating specialist agents...');
      
      // Create all specialist agents
      this.agents = {
        triage: new TriageAgent('Dr. Coordinate'),
        painWhisperer: new PainWhispererAgent('Dr. PainAway'),
        movementDetective: new MovementDetectiveAgent('Dr. MoveWell'),
        strengthSage: new StrengthSageAgent('Dr. PowerUp'),
        mindMender: new MindMenderAgent('Dr. MindEase')
      };
      
      // Register agents with coordinator
      Object.entries(this.agents).forEach(([type, agent]) => {
        this.coordinator.registerSpecialist(type, agent);
        
        // Register triage specialist network
        if (type !== 'triage') {
          this.agents.triage.registerSpecialist(type, agent);
        }
        
        logger.info(`   ✓ ${agent.name} (${agent.subspecialty})`);
      });
      
      logger.info('✅ All agents created and registered');
    } catch (error) {
      logger.error(`❌ Agent creation failed: ${error.message}`);
      throw error;
    }
  }

  async initializeTokenEconomics() {
    try {
      logger.info('💰 Initializing token economics...');
      
      // Initialize wallets for all agents
      for (const [type, agent] of Object.entries(this.agents)) {
        await this.tokenManager.initializeAgentWallet(agent);
        logger.info(`   ✓ Wallet initialized for ${agent.name}`);
      }
      
      // Create agent token contract
      const tokenContract = await this.blockchainUtils.createAgentTokenContract();
      logger.info(`   ✓ Token contract created: ${tokenContract.tokenAddress}`);
      
      logger.info('✅ Token economics initialized');
    } catch (error) {
      logger.error(`❌ Token initialization failed: ${error.message}`);
      throw error;
    }
  }

  async runRecoveryScenario() {
    try {
      logger.info('\n🏥 === STARTING PATIENT RECOVERY SCENARIO ===\n');
      
      // Create patient case
      const patientCase = this.createPatientCase();
      logger.info(`📋 Patient Case: ${patientCase.patientName}`);
      logger.info(`   Condition: ${patientCase.condition}`);
      logger.info(`   Pain Level: ${patientCase.initialAssessment.painLevel}/10`);
      
      // Phase 1: Initial Triage and Assessment
      const triageResult = await this.performInitialTriage(patientCase);
      
      // Phase 2: Multi-Specialist Consultation
      const consultationResult = await this.coordinateSpecialistConsultation(
        patientCase,
        triageResult.specialistRecommendations
      );
      
      // Phase 3: Start Recovery Tracking
      const trackingResult = await this.startRecoveryTracking(patientCase);
      
      // Phase 4: Simulate Recovery Journey
      const recoveryJourney = await this.simulateRecoveryJourney(
        patientCase.patientId,
        consultationResult
      );
      
      // Phase 5: Complete Recovery and Analyze Outcomes
      const finalResult = await this.completeRecovery(
        patientCase.patientId,
        recoveryJourney
      );
      
      // Phase 6: Distribute Token Rewards
      await this.distributeTokenRewards(finalResult);
      
      // Phase 7: Generate Final Report
      await this.generateFinalReport(patientCase, finalResult);
      
      logger.info('\n🎉 === RECOVERY SCENARIO COMPLETED SUCCESSFULLY ===\n');
      
      return finalResult;
    } catch (error) {
      logger.error(`❌ Recovery scenario failed: ${error.message}`);
      throw error;
    }
  }

  createPatientCase() {
    return {
      patientId: `patient_${Date.now()}`,
      patientName: 'Alex Recovery',
      age: 42,
      condition: 'post_surgical_knee_replacement',
      severity: 'moderate',
      initialAssessment: {
        painLevel: 7,
        functionalScore: 25,
        rangeOfMotion: { flexion: 45, extension: -10 },
        psychologicalWellbeing: 5,
        qualityOfLife: 4,
        anxietyLevel: 6,
        movementDysfunction: true,
        functionalLimitations: true,
        comorbidities: ['mild_diabetes', 'hypertension'],
        goals: [
          'Return to walking without assistance',
          'Achieve 90% knee flexion',
          'Return to recreational activities',
          'Manage pain effectively'
        ]
      },
      urgency: 'routine',
      timeline: new Date().toISOString()
    };
  }

  async performInitialTriage(patientCase) {
    try {
      logger.info('\n🔍 Phase 1: Initial Triage and Assessment');
      
      const triageAgent = this.agents.triage;
      const triageResult = await triageAgent.triageCase(patientCase);
      
      logger.info(`   ✓ Triage completed by ${triageAgent.name}`);
      logger.info(`   ✓ Urgency Level: ${triageResult.urgencyLevel}`);
      logger.info(`   ✓ Specialists recommended: ${triageResult.specialistRecommendations.join(', ')}`);
      
      // Award tokens for successful triage
      await this.tokenManager.distributeTokenReward(triageAgent.agentId, {
        success: true,
        reason: 'successful_triage',
        urgencyAccuracy: true
      });
      
      return triageResult;
    } catch (error) {
      logger.error(`❌ Triage failed: ${error.message}`);
      throw error;
    }
  }

  async coordinateSpecialistConsultation(patientCase, specialistTypes) {
    try {
      logger.info('\n👥 Phase 2: Multi-Specialist Consultation');
      
      const consultationResult = await this.coordinator.coordinateMultiSpecialistConsultation(
        patientCase,
        specialistTypes
      );
      
      logger.info(`   ✓ Consultation ID: ${consultationResult.consultationId}`);
      logger.info(`   ✓ Participating specialists: ${consultationResult.participatingSpecialists.length}`);
      
      // Display specialist responses
      for (const response of consultationResult.responses) {
        if (response.status === 'success') {
          logger.info(`   ✓ ${response.specialist}: Confidence ${Math.round(response.confidence * 100)}%`);
        }
      }
      
      logger.info(`   ✓ Recommendations synthesized successfully`);
      
      return consultationResult;
    } catch (error) {
      logger.error(`❌ Specialist consultation failed: ${error.message}`);
      throw error;
    }
  }

  async startRecoveryTracking(patientCase) {
    try {
      logger.info('\n📊 Phase 3: Starting Recovery Tracking');
      
      const trackingResult = await this.recoveryMetrics.trackPatientRecovery(
        patientCase.patientId,
        patientCase.initialAssessment
      );
      
      logger.info(`   ✓ Recovery tracking started for ${patientCase.patientName}`);
      logger.info(`   ✓ Expected timeline: ${trackingResult.expectedTimeline.total_weeks} weeks`);
      logger.info(`   ✓ Recovery goals established`);
      
      return trackingResult;
    } catch (error) {
      logger.error(`❌ Recovery tracking setup failed: ${error.message}`);
      throw error;
    }
  }

  async simulateRecoveryJourney(patientId, consultationResult) {
    try {
      logger.info('\n🏃‍♂️ Phase 4: Simulating Recovery Journey');
      
      const recoveryStages = [
        {
          week: 2,
          description: 'Early Recovery - Pain management focus',
          metrics: { painLevel: 5, functionalScore: 35, psychologicalWellbeing: 6 }
        },
        {
          week: 6,
          description: 'Progressive Phase - Movement improvement',
          metrics: { painLevel: 4, functionalScore: 55, psychologicalWellbeing: 7, movementQuality: 60 }
        },
        {
          week: 10,
          description: 'Strengthening Phase - Functional gains',
          metrics: { painLevel: 3, functionalScore: 75, psychologicalWellbeing: 8, strengthGains: 70 }
        },
        {
          week: 14,
          description: 'Integration Phase - Activity return preparation',
          metrics: { painLevel: 2, functionalScore: 85, psychologicalWellbeing: 8, confidenceScores: { current: 8 } }
        }
      ];
      
      const progressResults = [];
      
      for (const stage of recoveryStages) {
        logger.info(`\n   📅 Week ${stage.week}: ${stage.description}`);
        
        const progressResult = await this.recoveryMetrics.updateRecoveryProgress(
          patientId,
          stage.metrics
        );
        
        progressResults.push(progressResult);
        
        // Log progress metrics
        const metrics = progressResult.progressUpdate.metrics;
        if (metrics.painReduction) {
          logger.info(`      🎯 Pain reduction: ${metrics.painReduction}%`);
        }
        if (metrics.functionalImprovement) {
          logger.info(`      🎯 Functional improvement: ${metrics.functionalImprovement}%`);
        }
        
        // Award tokens for significant progress
        if (metrics.painReduction >= 50 || metrics.functionalImprovement >= 70) {
          for (const specialist of consultationResult.participatingSpecialists) {
            const agent = Object.values(this.agents).find(a => a.name.includes(specialist) || specialist.includes(a.subspecialty.split(' ')[0]));
            if (agent) {
              await this.tokenManager.distributeTokenReward(agent.agentId, {
                success: true,
                reason: 'progress_milestone',
                painReduction: metrics.painReduction || 0,
                functionalImprovement: metrics.functionalImprovement >= 70,
                collaborationBonus: true
              });
            }
          }
        }
        
        // Check for milestones
        if (progressResult.milestonesReached > 0) {
          logger.info(`      🏆 Milestone achieved!`);
        }
        
        // Check for risk alerts
        if (progressResult.riskAssessment?.risk === 'high') {
          logger.warn(`      ⚠️  Risk alert: ${progressResult.riskAssessment.reason}`);
        }
      }
      
      return progressResults;
    } catch (error) {
      logger.error(`❌ Recovery simulation failed: ${error.message}`);
      throw error;
    }
  }

  async completeRecovery(patientId, recoveryJourney) {
    try {
      logger.info('\n🏁 Phase 5: Completing Recovery Assessment');
      
      const finalOutcome = {
        painLevel: 1,
        functionalScore: 90,
        rangeOfMotion: { flexion: 95, extension: 0 },
        psychologicalWellbeing: 9,
        qualityOfLife: 8,
        patientSatisfaction: 9,
        returnToActivity: true,
        adherenceRate: 95,
        complications: 0
      };
      
      const completionResult = await this.recoveryMetrics.completeRecoveryTracking(
        patientId,
        finalOutcome
      );
      
      logger.info(`   ✓ Recovery completed successfully`);
      logger.info(`   ✓ Overall success: ${completionResult.success ? 'YES' : 'NO'}`);
      logger.info(`   ✓ Total duration: ${Math.round(completionResult.totalDuration / (7 * 24 * 60 * 60 * 1000))} weeks`);
      logger.info(`   ✓ Pain reduction: ${completionResult.finalMetrics.totalPainReduction}%`);
      logger.info(`   ✓ Functional improvement: ${completionResult.finalMetrics.totalFunctionalImprovement}%`);
      logger.info(`   ✓ Patient satisfaction: ${completionResult.finalMetrics.patientSatisfaction}/10`);
      
      // Record outcome on blockchain
      const blockchainRecord = await this.blockchainUtils.recordMedicalOutcome(
        patientId,
        finalOutcome,
        'recovery_team'
      );
      
      logger.info(`   ✓ Outcome recorded on blockchain: ${blockchainRecord.transactionHash}`);
      
      return {
        ...completionResult,
        blockchainRecord,
        recoveryJourney
      };
    } catch (error) {
      logger.error(`❌ Recovery completion failed: ${error.message}`);
      throw error;
    }
  }

  async distributeTokenRewards(finalResult) {
    try {
      logger.info('\n💰 Phase 6: Distributing Token Rewards');
      
      const outcome = {
        success: finalResult.success,
        mdApproval: true,
        userSatisfaction: finalResult.finalMetrics.patientSatisfaction,
        functionalImprovement: finalResult.finalMetrics.totalFunctionalImprovement >= 80,
        painReduction: finalResult.finalMetrics.totalPainReduction,
        returnToActivity: finalResult.finalMetrics.returnToActivity,
        zeroComplications: finalResult.finalMetrics.complications === 0,
        exceptionalOutcome: finalResult.finalMetrics.patientSatisfaction >= 9,
        collaborationBonus: true
      };
      
      const rewardPromises = Object.entries(this.agents).map(async ([type, agent]) => {
        const reward = await this.tokenManager.distributeTokenReward(agent.agentId, outcome);
        logger.info(`   ✓ ${agent.name}: ${reward.amount} tokens (Balance: ${reward.newBalance})`);
        return reward;
      });
      
      const rewards = await Promise.all(rewardPromises);
      const totalRewards = rewards.reduce((sum, reward) => sum + reward.amount, 0);
      
      logger.info(`   💎 Total tokens distributed: ${totalRewards}`);
      
      return rewards;
    } catch (error) {
      logger.error(`❌ Token distribution failed: ${error.message}`);
      throw error;
    }
  }

  async generateFinalReport(patientCase, finalResult) {
    try {
      logger.info('\n📋 Phase 7: Generating Final Report');
      
      // Get statistics from all systems
      const recoveryStats = this.recoveryMetrics.getRecoveryStatistics();
      const coordinationStats = this.coordinator.getCoordinationStatistics();
      const networkStats = this.tokenManager.getNetworkStatistics();
      const blockchainStats = await this.blockchainUtils.getNetworkStatistics();
      
      const report = {
        patientCase: {
          name: patientCase.patientName,
          condition: patientCase.condition,
          duration: Math.round(finalResult.totalDuration / (7 * 24 * 60 * 60 * 1000))
        },
        outcomes: {
          success: finalResult.success,
          painReduction: finalResult.finalMetrics.totalPainReduction,
          functionalImprovement: finalResult.finalMetrics.totalFunctionalImprovement,
          patientSatisfaction: finalResult.finalMetrics.patientSatisfaction,
          returnToActivity: finalResult.finalMetrics.returnToActivity
        },
        systemPerformance: {
          agentCoordination: {
            totalConsultations: coordinationStats.totalConsultations,
            successRate: coordinationStats.successRate,
            averageDuration: Math.round(coordinationStats.averageDuration / 1000 / 60) // minutes
          },
          tokenEconomics: {
            totalTokensDistributed: networkStats.totalTokensIssued,
            totalAgents: networkStats.totalAgents,
            topPerformer: networkStats.topPerformers[0]?.name || 'N/A'
          },
          blockchain: {
            network: blockchainStats.networkName,
            transactionsRecorded: blockchainStats.totalTransactions
          }
        },
        qualityMetrics: finalResult.qualityIndicators
      };
      
      logger.info('\n📊 === FINAL RECOVERY REPORT ===');
      logger.info(`🏥 Patient: ${report.patientCase.name}`);
      logger.info(`📅 Duration: ${report.patientCase.duration} weeks`);
      logger.info(`✅ Success: ${report.outcomes.success ? 'YES' : 'NO'}`);
      logger.info(`😌 Pain Reduction: ${report.outcomes.painReduction}%`);
      logger.info(`💪 Functional Improvement: ${report.outcomes.functionalImprovement}%`);
      logger.info(`😊 Patient Satisfaction: ${report.outcomes.patientSatisfaction}/10`);
      logger.info(`🏃 Return to Activity: ${report.outcomes.returnToActivity ? 'YES' : 'NO'}`);
      logger.info(`\n🤖 System Performance:`);
      logger.info(`   Coordination Success Rate: ${report.systemPerformance.agentCoordination.successRate}%`);
      logger.info(`   Tokens Distributed: ${report.systemPerformance.tokenEconomics.totalTokensDistributed}`);
      logger.info(`   Top Performer: ${report.systemPerformance.tokenEconomics.topPerformer}`);
      logger.info(`   Blockchain Transactions: ${report.systemPerformance.blockchain.transactionsRecorded}`);
      
      return report;
    } catch (error) {
      logger.error(`❌ Report generation failed: ${error.message}`);
      throw error;
    }
  }
}

// Run the demo if this file is executed directly
async function runDemo() {
  const demo = new RecoveryScenarioDemo();
  
  try {
    const initialized = await demo.initialize();
    if (!initialized) {
      process.exit(1);
    }
    
    const result = await demo.runRecoveryScenario();
    
    logger.info('\n🎉 Demo completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error(`❌ Demo failed: ${error.message}`);
    process.exit(1);
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo();
}

export default RecoveryScenarioDemo;