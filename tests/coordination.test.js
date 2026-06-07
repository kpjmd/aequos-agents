import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock external dependencies
jest.unstable_mockModule('../src/config/agent-config.js', () => ({
  agentConfig: {
    agent: {
      maxSpecialistsPerCase: 5
    },
    claude: {
      apiKey: 'test_claude_key'
    },
    cdp: {
      apiKeyName: 'test_key',
      privateKey: 'test_private_key'
    },
    network: {
      id: 'base-sepolia'
    },
    environment: {
      nodeEnv: 'test',
      logLevel: 'error'
    }
  }
}));

jest.unstable_mockModule('@coinbase/cdp-agentkit-core', () => ({
  default: {},
  CdpAgentkit: jest.fn()
}));

jest.unstable_mockModule('@langchain/anthropic', () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({ content: 'Mock response' })
  }))
}));

// Import after mocking
const { default: AgentCoordinator } = await import('../src/utils/agent-coordinator.js');
const { default: RecoveryMetrics } = await import('../src/utils/recovery-metrics.js');
const { TriageAgent } = await import('../src/agents/triage-agent.js');
const { PainWhispererAgent } = await import('../src/agents/pain-whisperer-agent.js');
const { MovementDetectiveAgent } = await import('../src/agents/movement-detective-agent.js');
const { StrengthSageAgent } = await import('../src/agents/strength-sage-agent.js');
const { MindMenderAgent } = await import('../src/agents/mind-mender-agent.js');

describe('AgentCoordinator', () => {
  let coordinator;
  let triageAgent;
  let painAgent;
  let movementAgent;
  let strengthAgent;
  let mindAgent;

  beforeEach(() => {
    coordinator = new AgentCoordinator();
    triageAgent = new TriageAgent();
    painAgent = new PainWhispererAgent();
    movementAgent = new MovementDetectiveAgent();
    strengthAgent = new StrengthSageAgent();
    mindAgent = new MindMenderAgent();

    // Register specialists
    coordinator.registerSpecialist('triage', triageAgent);
    coordinator.registerSpecialist('pain_whisperer', painAgent);
    coordinator.registerSpecialist('movement_detective', movementAgent);
    coordinator.registerSpecialist('strength_sage', strengthAgent);
    coordinator.registerSpecialist('mind_mender', mindAgent);
  });

  test('should register specialists correctly', () => {
    expect(coordinator.specialists.size).toBe(5);
    expect(coordinator.specialists.has('triage')).toBe(true);
    expect(coordinator.specialists.has('pain_whisperer')).toBe(true);
    expect(coordinator.performanceMetrics.size).toBe(5);
  });

  test('should validate specialist availability', () => {
    const requiredSpecialists = ['pain_whisperer', 'movement_detective', 'nonexistent'];
    const available = coordinator.validateSpecialistAvailability(requiredSpecialists);

    expect(available).toContain('pain_whisperer');
    expect(available).toContain('movement_detective');
    expect(available).not.toContain('nonexistent');
  });

  test('should calculate consensus level', () => {
    const responses = [
      { response: { recommendations: 'physical therapy and pain management' } },
      { response: { recommendations: 'physical therapy and movement training' } },
      { response: { recommendations: 'therapy and exercise program' } }
    ];

    const consensus = coordinator.calculateConsensusLevel(responses);
    expect(['high', 'medium', 'low']).toContain(consensus);
  });

  test('should calculate synthesis confidence', () => {
    const responses = [
      { confidence: 0.8 },
      { confidence: 0.9 },
      { confidence: 0.7 }
    ];

    const avgConfidence = coordinator.calculateSynthesisConfidence(responses);
    expect(avgConfidence).toBeCloseTo(0.8, 1);
  });

  test('should record specialist performance', () => {
    const response = {
      status: 'success',
      responseTime: 1500
    };

    coordinator.recordSpecialistPerformance('pain_whisperer', response);

    const metrics = coordinator.performanceMetrics.get('pain_whisperer');
    expect(metrics.consultations).toBe(1);
    expect(metrics.successRate).toBe(1);
    expect(metrics.averageResponseTime).toBe(1500);
  });

  test('should calculate duration correctly', () => {
    const startTime = '2023-01-01T10:00:00Z';
    const endTime = '2023-01-01T10:05:00Z';

    const duration = coordinator.calculateDuration(startTime, endTime);
    expect(duration).toBe(5 * 60 * 1000); // 5 minutes in milliseconds
  });

  test('should calculate quality score', () => {
    const consultation = {
      responses: new Map([
        ['agent1', { status: 'success', confidence: 0.8, responseTime: 2000 }],
        ['agent2', { status: 'success', confidence: 0.9, responseTime: 1500 }],
        ['agent3', { status: 'failed', confidence: 0.6, responseTime: 5000 }]
      ])
    };

    const score = coordinator.calculateQualityScore(consultation);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('should get coordination statistics', () => {
    // Add some mock consultation history
    coordinator.coordinationHistory.push({
      consultationId: 'test1',
      specialistsInvolved: ['triage', 'pain_whisperer'],
      duration: 300000,
      success: true
    });

    const stats = coordinator.getCoordinationStatistics();

    expect(stats.totalConsultations).toBe(1);
    expect(stats.successRate).toBe(100);
    expect(stats.specialistUsage['triage']).toBe(1);
    expect(stats.specialistUsage['pain_whisperer']).toBe(1);
  });
});

describe('RecoveryMetrics', () => {
  let recoveryMetrics;

  beforeEach(() => {
    recoveryMetrics = new RecoveryMetrics();
  });

  test('should initialize with benchmarks', () => {
    expect(recoveryMetrics.benchmarkData).toBeDefined();
    expect(recoveryMetrics.benchmarkData.painReduction.excellent).toBe(75);
    expect(recoveryMetrics.benchmarkData.functionalImprovement.good).toBe(70);
  });

  test('should track patient recovery', async () => {
    const initialAssessment = {
      condition: 'knee_surgery',
      severity: 'moderate',
      age: 45,
      painLevel: 8,
      functionalScore: 30,
      comorbidities: ['diabetes']
    };

    const result = await recoveryMetrics.trackPatientRecovery('patient123', initialAssessment);

    expect(result.patientId).toBe('patient123');
    expect(result.baselineMetrics).toBeDefined();
    expect(result.recoveryGoals).toBeDefined();
    expect(result.expectedTimeline).toBeDefined();

    // Check if patient record was stored
    const record = recoveryMetrics.patientRecords.get('patient123');
    expect(record).toBeDefined();
    expect(record.status).toBe('active');
  });

  test('should extract baseline metrics correctly', () => {
    const assessment = {
      painLevel: 7,
      functionalScore: 40,
      rangeOfMotion: { flexion: 90, extension: 10 },
      qualityOfLife: 4
    };

    const metrics = recoveryMetrics.extractBaselineMetrics(assessment);

    expect(metrics.painLevel).toBe(7);
    expect(metrics.functionalScore).toBe(40);
    expect(metrics.qualityOfLife).toBe(4);
    expect(metrics.timestamp).toBeDefined();
  });

  test('should calculate expected timeline', () => {
    const assessment = {
      condition: 'acl_reconstruction',
      severity: 'severe',
      age: 35,
      comorbidities: ['obesity']
    };

    const timeline = recoveryMetrics.calculateExpectedTimeline(assessment);

    expect(timeline.total_weeks).toBeGreaterThan(20); // ACL should be long
    expect(timeline.acute_phase).toBeGreaterThan(0);
    expect(timeline.inflammatory_phase).toBeGreaterThan(0);
    expect(timeline.proliferation_phase).toBeGreaterThan(0);
    expect(timeline.maturation_phase).toBeGreaterThan(0);
  });

  test('should calculate progress metrics', () => {
    const progressData = {
      painLevel: 3,
      functionalScore: 75,
      qualityOfLife: 8
    };

    const baselineMetrics = {
      painLevel: 8,
      functionalScore: 30,
      qualityOfLife: 4
    };

    const metrics = recoveryMetrics.calculateProgressMetrics(progressData, baselineMetrics);

    expect(metrics.painReduction).toBe(63); // (8-3)/8 * 100
    expect(metrics.functionalImprovement).toBe(64); // (75-30)/(100-30) * 100
    expect(metrics.qolImprovement).toBe(67); // (8-4)/(10-4) * 100
  });

  test('should determine recovery phase correctly', () => {
    const mockRecord = {
      startDate: new Date(Date.now() - 6 * 7 * 24 * 60 * 60 * 1000).toISOString(), // 6 weeks ago
      expectedTimeline: {
        acute_phase: 2,
        inflammatory_phase: 4,
        proliferation_phase: 8,
        total_weeks: 20
      }
    };

    const phase = recoveryMetrics.determineRecoveryPhase({}, mockRecord);
    expect(phase).toBe('inflammatory'); // 6 weeks should be in inflammatory phase
  });

  test('should check milestone achievement', () => {
    const progressUpdate = {
      metrics: {
        painReduction: 60,
        functionalImprovement: 80
      },
      data: {},
      timestamp: new Date().toISOString()
    };

    const record = {
      milestones: []
    };

    const milestone = recoveryMetrics.checkMilestoneAchievement(progressUpdate, record);

    if (milestone) {
      expect(milestone.type).toBeDefined();
      expect(milestone.significance).toBeDefined();
    }
  });

  test('should assess progress risk', () => {
    const record = {
      startDate: new Date(Date.now() - 10 * 7 * 24 * 60 * 60 * 1000).toISOString(), // 10 weeks ago
      progressUpdates: [{
        metrics: {
          painReduction: 20,
          functionalImprovement: 30
        }
      }]
    };

    const risk = recoveryMetrics.assessProgressRisk(record);

    expect(risk.risk).toBe('high'); // Poor progress after 10 weeks
    expect(risk.reason).toContain('pain reduction');
  });

  test('should calculate weeks elapsed', () => {
    const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days ago
    const weeks = recoveryMetrics.calculateWeeksElapsed(startDate);

    expect(weeks).toBe(2);
  });

  test('should determine overall success', () => {
    const finalMetrics = {
      totalPainReduction: 80,
      totalFunctionalImprovement: 85,
      patientSatisfaction: 9,
      returnToActivity: true,
      complications: 0
    };

    const goals = {
      painReduction: 70,
      functionalImprovement: 75
    };

    const success = recoveryMetrics.determineOverallSuccess(finalMetrics, goals);
    expect(success).toBe(true);
  });

  test('should compare to benchmarks', () => {
    const finalMetrics = {
      totalPainReduction: 80,
      totalFunctionalImprovement: 90,
      patientSatisfaction: 9
    };

    const comparison = recoveryMetrics.compareToBenchmarks(finalMetrics);

    expect(comparison.painReduction).toBe('excellent'); // 80% > 75%
    expect(comparison.functionalImprovement).toBe('excellent'); // 90% > 85%
    expect(comparison.satisfaction).toBe('excellent'); // 9 >= 9
  });

  test('should categorize benchmark correctly', () => {
    const benchmark = { excellent: 80, good: 60, fair: 40, poor: 0 };

    expect(recoveryMetrics.categorizeBenchmark(85, benchmark)).toBe('excellent');
    expect(recoveryMetrics.categorizeBenchmark(65, benchmark)).toBe('good');
    expect(recoveryMetrics.categorizeBenchmark(45, benchmark)).toBe('fair');
    expect(recoveryMetrics.categorizeBenchmark(25, benchmark)).toBe('poor');
  });

  test('should get recovery statistics', () => {
    // Add a completed record
    recoveryMetrics.patientRecords.set('patient1', {
      status: 'completed',
      finalMetrics: {
        totalPainReduction: 75,
        totalFunctionalImprovement: 80,
        patientSatisfaction: 8,
        returnToActivity: true
      },
      outcomeAnalysis: {
        overallSuccess: true
      },
      complications: [],
      totalDuration: 16
    });

    const stats = recoveryMetrics.getRecoveryStatistics();

    expect(stats.totalPatients).toBe(1);
    expect(stats.successRate).toBe(100);
    expect(stats.averagePainReduction).toBe(75);
    expect(stats.averageFunctionalImprovement).toBe(80);
    expect(stats.patientSatisfaction).toBe(8);
    expect(stats.returnToActivityRate).toBe(100);
  });
});

describe('Integration Tests', () => {
  let coordinator;
  let recoveryMetrics;
  let agents;

  beforeEach(() => {
    coordinator = new AgentCoordinator();
    recoveryMetrics = new RecoveryMetrics();

    // Create and register agents
    agents = {
      triage: new TriageAgent(),
      pain: new PainWhispererAgent(),
      movement: new MovementDetectiveAgent(),
      strength: new StrengthSageAgent(),
      mind: new MindMenderAgent()
    };

    Object.entries(agents).forEach(([type, agent]) => {
      coordinator.registerSpecialist(type, agent);
    });
  });

  test('should handle multi-specialist coordination', async () => {
    const caseData = {
      id: 'complex_case',
      painLevel: 8,
      movementDysfunction: true,
      functionalLimitations: true,
      anxietyLevel: 7,
      symptoms: ['chronic pain', 'limited mobility', 'anxiety']
    };

    // Mock the specialist response methods
    Object.values(agents).forEach(agent => {
      agent.processMessage = jest.fn().mockResolvedValue('Mock specialist response');
      agent.getConfidence = jest.fn().mockReturnValue(0.8);
    });

    const requiredSpecialists = ['pain', 'movement', 'strength', 'mind'];

    const consultationResult = await coordinator.coordinateMultiSpecialistConsultation(
      caseData,
      requiredSpecialists
    );

    expect(consultationResult.consultationId).toBeDefined();
    expect(consultationResult.participatingSpecialists.length).toBeGreaterThan(0);
    expect(consultationResult.synthesizedRecommendations).toBeDefined();
  });

  test('should track end-to-end recovery metrics', async () => {
    // Start tracking
    const patient = 'integration_patient';
    await recoveryMetrics.trackPatientRecovery(patient, {
      condition: 'knee_replacement',
      painLevel: 8,
      functionalScore: 25
    });

    // Multiple progress updates
    const progressUpdates = [
      { painLevel: 6, functionalScore: 45 },
      { painLevel: 4, functionalScore: 65 },
      { painLevel: 2, functionalScore: 85 }
    ];

    for (const update of progressUpdates) {
      await recoveryMetrics.updateRecoveryProgress(patient, update);
    }

    // Complete tracking
    const finalOutcome = {
      painLevel: 1,
      functionalScore: 90,
      patientSatisfaction: 9,
      returnToActivity: true
    };

    const completion = await recoveryMetrics.completeRecoveryTracking(
      patient,
      finalOutcome
    );

    expect(completion.success).toBe(true);
    expect(completion.finalMetrics.totalPainReduction).toBeGreaterThan(80);
  });
});
