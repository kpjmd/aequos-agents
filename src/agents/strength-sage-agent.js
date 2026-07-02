import { OrthopedicSpecialist } from './orthopedic-specialist.js';
import logger from '../utils/logger.js';
import { extractBodyPartFromQuery, extractSportActivity, extractTimeline, extractInjuryMechanism } from '../utils/body-part-extractor.js';

export class StrengthSageAgent extends OrthopedicSpecialist {
  constructor(name = 'Strength Sage', accountManager = null) {
    super(name, 'functional restoration and rehabilitation', accountManager, 'strengthSage');
    this.agentType = 'strength_sage';
    this.strengthAssessments = new Map();
    this.rehabilitationPrograms = new Map();
    this.functionalTests = [];
    this.returnToActivityProtocols = new Map();
  }

  getSystemPrompt() {
    return `You are ${this.name}, the functional restoration and rehabilitation specialist in the AequOs recovery ecosystem.
    
    Your expertise centers on rebuilding strength, power, endurance, and functional capacity through evidence-based rehabilitation and performance optimization strategies that restore patients to their highest possible level of function.
    
    CORE SPECIALIZATIONS:
    - Comprehensive strength and power assessment
    - Functional capacity evaluation
    - Progressive rehabilitation program design
    - Return-to-activity/sport protocols
    - Work conditioning and hardening
    - Therapeutic exercise prescription
    - Functional movement training
    - Performance optimization strategies
    
    ASSESSMENT FRAMEWORK:
    - Strength testing (manual, instrumented)
    - Power and rate of force development
    - Muscular endurance evaluation
    - Functional capacity assessment
    - Work-specific testing
    - Sport-specific evaluation
    - Balance and proprioception
    - Cardiovascular conditioning
    
    Experience level: ${this.experience} points
    Rehabilitation programs: ${this.rehabilitationPrograms.size}
    Wallet: ${this.walletAddress}
    
    EVIDENCE-BASED APPROACHES:
    - Progressive overload principles
    - Specificity of training adaptations
    - Periodization and program design
    - Neuromuscular facilitation techniques
    - Functional movement integration
    - Motor learning principles
    - Recovery and regeneration strategies
    
    TOKEN INCENTIVES:
    - Functional capacity improvements (>80% restoration)
    - Successful return to work/sport
    - Strength gains exceeding expectations
    - Injury recurrence prevention
    - Patient adherence and satisfaction
    - Collaboration effectiveness
    
    REHABILITATION PHILOSOPHY:
    - Function-first approach
    - Patient-centered goal setting
    - Progressive challenge and adaptation
    - Real-world application focus
    - Injury prevention integration
    - Long-term health optimization
    
    Your mission is to guide patients from injury to full functional restoration and beyond, building resilience and capacity that exceeds pre-injury levels while preventing future dysfunction.`;
  }

  async assessFunctionalCapacity(assessmentData, context = {}) {
    try {
      const startTime = Date.now();
      logger.info(`${this.name} conducting comprehensive functional capacity assessment`);

      // Extract dual-track data if present
      const { rawQuery, enableDualTrack } = assessmentData;

      // 🎯 PRE-EXTRACT body part and sport BEFORE building prompt
      const bodyPart = extractBodyPartFromQuery(rawQuery, assessmentData);
      const sport = extractSportActivity(rawQuery);
      const timeline = extractTimeline(rawQuery, assessmentData);
      const mechanism = extractInjuryMechanism(rawQuery, assessmentData);
      const age = assessmentData.age || 'unknown age';

      const assessmentPrompt = `
You are an expert in neuromuscular rehabilitation and functional restoration.

🎯 PATIENT'S QUESTION: "${rawQuery || 'Functional assessment requested'}"

📋 FUNCTIONAL CONTEXT:
- Body Part: ${bodyPart || 'Unspecified'}
- Timeline: ${timeline ? `${timeline.value} ${timeline.unit}s ago (${timeline.phase} phase, Day ${timeline.totalDays})` : 'Unknown'}
- Mechanism: ${mechanism || 'Unknown'}
- Age: ${age}
- Sport: ${sport || 'Not specified'}

🧠 THINK LIKE A STRENGTH SPECIALIST:
${bodyPart === 'Knee' && timeline && timeline.phase === 'Early Proliferation' ? `
- What arthrogenic muscle inhibition (AMI) is present? (VMO shutdown from effusion)
- What neuromuscular control is compromised?
- How do we progressively reload tissues at Week ${Math.floor(timeline.totalDays / 7)}?
- What functional benchmarks define readiness for next phase?
` : timeline ? `
- What muscle inhibition/atrophy has occurred at ${timeline.phase}?
- What neuromuscular patterns need restoration?
- What functional benchmarks define current recovery stage?
- How do we safely progress loading at this phase?
` : `
- What muscle inhibition/atrophy is present?
- What neuromuscular control deficits exist?
- What functional benchmarks are needed?
- How do we safely progress loading?
`}

⚠️ PROVIDE EXPERT-LEVEL STRENGTHENING PROTOCOL:

1. **Neuromuscular Reasoning**:
   ${bodyPart === 'Knee' && timeline && timeline.phase === 'Early Proliferation' ?
   `Example: "Joint effusion at ${timeline.phase} causes arthrogenic muscle inhibition (AMI), particularly affecting the vastus medialis oblique (VMO). This quadriceps shutdown limits functional capacity to ~70% and increases re-injury risk. Neural drive must be restored before progressive loading."` :
   `Explain neuromuscular inhibition: What muscles are inhibited? What's the mechanism? What's the functional impact? NOT generic "progressive strength training"`}

2. **Specific Strengthening Protocol** (${timeline ? timeline.phase : 'Current phase'}):
   ${bodyPart === 'Knee' && timeline && timeline.phase === 'Early Proliferation' ? `
   Daily Exercises:
   - Quad sets: 100 reps/day (sets of 10), 5-second holds
     Rationale: Restore neural drive to inhibited VMO
     Progression: Add ankle weight (2-5 lbs) when pain-free

   - Straight leg raises: 3 sets of 15, twice daily
     Form: Quad locked, lift to 45°, control descent
     Progression: Add weight when easy (start 2 lbs)

   - Terminal knee extension with band: 3 sets of 15 daily
     Focus: Final 30° of extension for VMO activation
     Progression: Increase band resistance weekly
   ` : `
   Provide EXACT exercises with:
   - Sets, reps, frequency (e.g., "3 sets of 15, twice daily")
   - Form cues and rationale
   - Progression criteria (when and how to advance)
   - NOT: "Progressive strength training program"
   `}

3. **Load Progression Strategy**:
   - Increase load 10% per week IF swelling stable
   - Monitor morning vs evening swelling differential
   - Reduce 50% if next-day swelling increases >5mm
   - Objective measures guide progression, not time alone

4. **Functional Milestones** (Objective):
   ${bodyPart === 'Knee' ? `
   - Advance when quad strength >80% of opposite leg (manual or handheld dynamometry)
   - Single-leg squat without valgus collapse
   - Gait symmetric, no antalgic pattern
   ${sport === 'Football' ? `\n   Football-Specific:\n   - Progress to agility when strength >90% opposite leg\n   - Return to contact when passing all tests + sport-specific drills pain-free` : ''}
   ` : `
   - Define specific, measurable functional benchmarks
   - Compare to opposite side or normative data
   - Include activity-specific criteria
   `}

Assessment Data: ${JSON.stringify(assessmentData)}

        ${enableDualTrack && rawQuery ? `
🎯 REMEMBER: Your PRIMARY task is answering: "${rawQuery}"
${sport ? `🏈 INCLUDE: ${sport}-specific return-to-play criteria and readiness` : ''}
        ` : ''}

        Provide your response as readable prose with markdown headers (## for sections).
        Write naturally as a strength and rehabilitation specialist explaining your analysis and recommendations.
        Use bullet points for exercise lists, but write in clear, clinical narrative format.

        At the very end of your response add a single machine-readable tag on its own line (required):
        PREDICTED_RECOVERY_DAYS: <integer 1-730, or null if the available information is insufficient to estimate>
      `;
      
      const assessment = await this.processMessage(assessmentPrompt, context);
      const responseTime = Date.now() - startTime;

      // Parse functional metrics
      const functionalLevel = this.extractFunctionalLevel(assessment);
      const strengthDeficits = this.extractStrengthDeficits(assessment);
      const restorationPotential = this.assessRestorePotential(assessment);
      const predictedRecoveryDays = this.extractPredictedRecoveryDays(assessment);

      // Build structured response per Task 1.2
      const functionalAssessment = {
        // Standard fields
        specialist: this.name,
        specialistType: 'strengthSage',

        // Structured assessment
        assessment: {
          primaryFindings: [
            `Functional capacity: ${functionalLevel}%`,
            `Strength deficits identified: ${strengthDeficits.length > 0 ? strengthDeficits[0] : 'None'}`,
            `Restoration potential: ${restorationPotential}`,
            assessmentData.limitations ? `Primary limitations: ${assessmentData.limitations.join(', ')}` : 'Limitations unspecified'
          ],
          confidence: this.getConfidence('functional_assessment'),
          dataQuality: assessmentData.limitations ? 0.8 : 0.5,
          clinicalImportance: functionalLevel < 50 ? 'high' : functionalLevel < 75 ? 'medium' : 'low'
        },

        // Raw LLM response for reference
        rawResponse: assessment,

        // Recommendations come from LLM rawResponse, not hardcoded
        recommendations: [],

        // Key findings with metadata
        keyFindings: [
          {
            finding: `Functional capacity at ${functionalLevel}% with ${strengthDeficits.length} strength deficits`,
            confidence: 0.85,
            clinicalRelevance: functionalLevel < 75 ? 'high' : 'medium',
            requiresMDReview: functionalLevel < 40
          }
        ],

        // Inter-agent questions
        questionsForAgents: [
          {
            targetAgent: 'movementDetective',
            question: 'What movement patterns should be prioritized in strength training?',
            priority: 'high'
          },
          {
            targetAgent: 'painWhisperer',
            question: 'Are there pain limitations that will affect exercise progression?',
            priority: 'high'
          },
          {
            targetAgent: 'mindMender',
            question: 'Is fear of re-injury limiting effort or adherence to strengthening?',
            priority: 'medium'
          }
        ],

        // Follow-up questions for patient
        followUpQuestions: [
          'What specific activities do you want to return to?',
          'Are you experiencing any pain during strengthening exercises?',
          'What are your functional goals for recovery?'
        ],

        // Agreement with triage assessment
        agreementWithTriage: 'full',

        // Standard metadata
        confidence: this.getConfidence('functional_assessment'),
        responseTime: responseTime,
        timestamp: new Date().toISOString(),
        status: 'success',

        // Strength-specific additional data
        assessmentId: `functional_${Date.now()}`,
        functionalLevel: functionalLevel,
        strengthDeficits: strengthDeficits,
        restorationPotential: restorationPotential,
        predictedRecoveryDays: predictedRecoveryDays
      };

      // Generate user-friendly markdown response
      functionalAssessment.response = this.formatUserFriendlyResponse(functionalAssessment);

      // Store assessment
      this.strengthAssessments.set(functionalAssessment.assessmentId, functionalAssessment);
      this.functionalTests.push(functionalAssessment);

      this.updateExperience();

      return functionalAssessment;
    } catch (error) {
      logger.error(`Error in functional capacity assessment: ${error.message}`);
      throw error;
    }
  }

  async designRehabilitationProgram(functionalAssessment) {
    try {
      logger.info(`${this.name} designing comprehensive rehabilitation program`);
      
      const programPrompt = `
        EVIDENCE-BASED REHABILITATION PROGRAM DESIGN:
        
        Functional Assessment: ${JSON.stringify(functionalAssessment)}
        
        Design progressive rehabilitation program including:
        
        1. PROGRAM PHASES:
           - Phase 1: Foundation/Protection (weeks 1-2)
           - Phase 2: Early Strengthening (weeks 3-6)
           - Phase 3: Progressive Loading (weeks 7-10)
           - Phase 4: Advanced Conditioning (weeks 11-16)
           - Phase 5: Return Preparation (weeks 17-20)
           
        2. STRENGTH DEVELOPMENT:
           - Progressive resistance training
           - Compound movement patterns
           - Unilateral vs bilateral training
           - Strength curve optimization
           - Power development protocols
           
        3. FUNCTIONAL TRAINING:
           - Task-specific exercises
           - Movement pattern training
           - Real-world application
           - Environmental challenges
           - Skill transfer activities
           
        4. CARDIOVASCULAR CONDITIONING:
           - Aerobic base development
           - Anaerobic power training
           - Work capacity building
           - Energy system specificity
           - Recovery optimization
           
        5. NEUROMUSCULAR CONTROL:
           - Proprioceptive training
           - Balance challenges
           - Reactive training
           - Coordination development
           - Motor pattern refinement
           
        6. FLEXIBILITY AND MOBILITY:
           - Targeted stretching protocols
           - Joint mobilization
           - Movement preparation
           - Recovery enhancement
           - Maintenance strategies
           
        7. EXERCISE PRESCRIPTION:
           - Sets, reps, intensity guidelines
           - Progression criteria
           - Load advancement rules
           - Volume periodization
           - Recovery protocols
           
        8. MONITORING AND PROGRESSION:
           - Objective progress markers
           - Subjective feedback integration
           - Reassessment schedule
           - Modification triggers
           - Goal achievement tracking
           
        9. RETURN-TO-ACTIVITY CRITERIA:
           - Strength benchmarks
           - Functional test standards
           - Movement quality requirements
           - Confidence measures
           - Risk mitigation factors
           
        Provide specific, progressive, and periodized rehabilitation program.
      `;
      
      const rehabilitationProgram = await this.processMessage(programPrompt);
      
      const programData = {
        programId: `rehab_${Date.now()}`,
        assessmentId: functionalAssessment.assessmentId,
        agent: this.name,
        program: rehabilitationProgram,
        phases: ['foundation', 'early_strengthening', 'progressive_loading', 'advanced_conditioning', 'return_preparation'],
        currentPhase: 'foundation',
        startDate: new Date().toISOString(),
        estimatedDuration: '20 weeks',
        progressMarkers: [],
        createdAt: new Date().toISOString(),
        confidence: this.getConfidence('program_design')
      };
      
      // Store rehabilitation program
      this.rehabilitationPrograms.set(programData.programId, programData);
      
      return programData;
    } catch (error) {
      logger.error(`Error designing rehabilitation program: ${error.message}`);
      throw error;
    }
  }

  async monitorRehabilitationProgress(programId, progressData) {
    try {
      logger.info(`${this.name} monitoring rehabilitation progress`);
      
      const monitoringPrompt = `
        REHABILITATION PROGRESS MONITORING:
        
        Program ID: ${programId}
        Progress Data: ${JSON.stringify(progressData)}
        Current Program: ${JSON.stringify(this.rehabilitationPrograms.get(programId))}
        
        Evaluate rehabilitation progress and program effectiveness:
        
        1. STRENGTH IMPROVEMENTS:
           - Absolute strength gains
           - Relative strength progress
           - Bilateral comparison improvements
           - Functional strength transfer
           - Power development progress
           
        2. FUNCTIONAL CAPACITY GAINS:
           - ADL performance improvements
           - Work-specific capacity gains
           - Sport/activity readiness
           - Endurance improvements
           - Movement quality enhancement
           
        3. PHASE PROGRESSION CRITERIA:
           - Current phase completion status
           - Readiness for advancement
           - Objective milestone achievement
           - Subjective confidence levels
           - Risk assessment for progression
           
        4. ADHERENCE AND ENGAGEMENT:
           - Program compliance rates
           - Exercise execution quality
           - Progression challenge acceptance
           - Motivation and confidence
           - Barrier identification
           
        5. ADAPTATION RESPONSE:
           - Training load tolerance
           - Recovery between sessions
           - Overuse risk indicators
           - Adaptation plateau signs
           - Individual response patterns
           
        6. PROGRAM MODIFICATIONS:
           - Exercise substitutions needed
           - Intensity adjustments required
           - Volume modifications
           - Frequency changes
           - Timeline adjustments
           
        7. RETURN-TO-ACTIVITY READINESS:
           - Objective test performance
           - Functional movement quality
           - Psychological readiness
           - Risk factor mitigation
           - Confidence levels
           
        8. NEXT STEPS:
           - Immediate recommendations
           - Phase progression decisions
           - Program modifications
           - Additional interventions
           - Timeline updates
           
        Provide evidence-based progress assessment with specific actionable recommendations.
      `;
      
      const progressAssessment = await this.processMessage(monitoringPrompt);
      
      // Update program with progress data
      const program = this.rehabilitationPrograms.get(programId);
      if (program) {
        if (!program.progressUpdates) program.progressUpdates = [];
        program.progressUpdates.push({
          update: progressAssessment,
          data: progressData,
          timestamp: new Date().toISOString()
        });
        
        // Update phase if criteria met
        if (progressData.phaseProgression) {
          program.currentPhase = progressData.phaseProgression;
          program.phaseAdvancedAt = new Date().toISOString();
        }
        
        // Track progress markers
        if (progressData.strengthGains) {
          program.progressMarkers.push({
            type: 'strength_gain',
            value: progressData.strengthGains,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      // Calculate improvements for token rewards
      const strengthImprovement = this.calculateStrengthImprovement(progressData);
      const functionalGains = this.calculateFunctionalGains(progressData);
      
      return {
        programId,
        progressAssessment,
        strengthImprovement,
        functionalGains,
        currentPhase: program?.currentPhase,
        readinessScore: this.calculateReadinessScore(progressData),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error monitoring rehabilitation progress: ${error.message}`);
      throw error;
    }
  }

  async developReturnToActivityProtocol(activityType, currentCapacity) {
    try {
      logger.info(`${this.name} developing return-to-${activityType} protocol`);
      
      const protocolPrompt = `
        RETURN-TO-ACTIVITY PROTOCOL DEVELOPMENT:
        
        Activity Type: ${activityType}
        Current Capacity: ${JSON.stringify(currentCapacity)}
        
        Design comprehensive return protocol including:
        
        1. READINESS CRITERIA:
           - Strength benchmarks (% of pre-injury/normative)
           - Functional test standards
           - Movement quality requirements
           - Pain levels and symptoms
           - Psychological readiness factors
           
        2. PROGRESSIVE EXPOSURE PLAN:
           - Stage 1: Skill reacquisition (25% intensity)
           - Stage 2: Basic participation (50% intensity)
           - Stage 3: Progressive loading (75% intensity)
           - Stage 4: Full participation (100% intensity)
           - Stage 5: Performance optimization (>100%)
           
        3. ACTIVITY-SPECIFIC TESTING:
           - Sport/work-specific assessments
           - Performance benchmarks
           - Endurance requirements
           - Skill execution standards
           - Decision-making under fatigue
           
        4. RISK MITIGATION STRATEGIES:
           - Injury prevention protocols
           - Load management guidelines
           - Environmental modifications
           - Equipment recommendations
           - Technique refinements
           
        5. MONITORING PROTOCOLS:
           - Objective performance metrics
           - Subjective symptom tracking
           - Fatigue and recovery monitoring
           - Confidence and fear assessment
           - Re-injury risk indicators
           
        6. MAINTENANCE PROGRAM:
           - Ongoing strength training
           - Flexibility maintenance
           - Skill refinement
           - Injury prevention exercises
           - Performance optimization
           
        7. DECISION POINTS:
           - Progression criteria
           - Hold/regression triggers
           - Medical clearance needs
           - Performance standards
           - Long-term considerations
           
        Provide systematic, evidence-based return-to-activity protocol.
      `;
      
      const protocol = await this.processMessage(protocolPrompt);
      
      const protocolData = {
        protocolId: `rta_${Date.now()}`,
        activityType,
        agent: this.name,
        protocol,
        stages: ['skill_reacquisition', 'basic_participation', 'progressive_loading', 'full_participation', 'performance_optimization'],
        currentStage: 'skill_reacquisition',
        currentCapacity,
        createdAt: new Date().toISOString(),
        confidence: this.getConfidence('return_protocol')
      };
      
      // Store protocol
      this.returnToActivityProtocols.set(protocolData.protocolId, protocolData);
      
      return protocolData;
    } catch (error) {
      logger.error(`Error developing return-to-activity protocol: ${error.message}`);
      throw error;
    }
  }

  async provideFunctionalEducation(educationRequest) {
    try {
      logger.info(`${this.name} providing functional restoration education`);
      
      const educationPrompt = `
        FUNCTIONAL RESTORATION EDUCATION:
        
        Education Request: ${JSON.stringify(educationRequest)}
        
        Provide patient-friendly functional education covering:
        
        1. STRENGTH AND CONDITIONING BASICS:
           - How muscles adapt and grow stronger
           - Progressive overload principles
           - Recovery and adaptation cycle
           - Importance of consistency
           
        2. YOUR FUNCTIONAL JOURNEY:
           - Current capacity assessment
           - Realistic timeline expectations
           - Milestone celebrations
           - Plateau management
           
        3. EXERCISE EXECUTION:
           - Proper form principles
           - Quality over quantity focus
           - Progression guidelines
           - Pain vs. challenge recognition
           
        4. RECOVERY OPTIMIZATION:
           - Sleep and recovery importance
           - Nutrition for adaptation
           - Active recovery strategies
           - Stress management
           
        5. MOTIVATION AND ADHERENCE:
           - Goal setting strategies
           - Progress tracking methods
           - Obstacle overcoming
           - Support system utilization
           
        6. LONG-TERM SUCCESS:
           - Habit formation
           - Lifestyle integration
           - Injury prevention
           - Performance maintenance
           
        7. RETURN TO ACTIVITIES:
           - Gradual progression importance
           - Risk management
           - Confidence building
           - Performance optimization
           
        Use motivating, empowering language that builds confidence and commitment.
      `;
      
      const education = await this.processMessage(educationPrompt);
      
      return {
        agent: this.name,
        education,
        topic: educationRequest.topic || 'comprehensive_functional_education',
        timestamp: new Date().toISOString(),
        format: 'patient_friendly'
      };
    } catch (error) {
      logger.error(`Error providing functional education: ${error.message}`);
      throw error;
    }
  }

  extractFunctionalLevel(assessment) {
    const match = assessment.match(/functional\s+level.*?(\d+)%/i) || 
                  assessment.match(/capacity.*?(\d+)%/i);
    return match ? parseInt(match[1]) : null;
  }

  extractStrengthDeficits(assessment) {
    const deficits = [];
    const deficitKeywords = {
      'quadriceps_weakness': ['quadriceps', 'quad'],
      'hamstring_weakness': ['hamstring'],
      'gluteal_weakness': ['gluteal', 'glute'],
      'core_weakness': ['core', 'abdominal'],
      'shoulder_weakness': ['shoulder', 'rotator cuff'],
      'general_deconditioning': ['deconditioning', 'overall weakness']
    };
    
    const lowerAssessment = assessment.toLowerCase();
    
    Object.entries(deficitKeywords).forEach(([deficit, keywords]) => {
      if (keywords.some(keyword => lowerAssessment.includes(keyword) && lowerAssessment.includes('weak'))) {
        deficits.push(deficit);
      }
    });
    
    return deficits;
  }

  extractPriorityAreas(assessment) {
    const priorities = [];
    const priorityKeywords = ['priority', 'primary', 'focus', 'emphasis'];
    
    // Simple extraction - could be enhanced with NLP
    const sentences = assessment.split('.');
    sentences.forEach(sentence => {
      if (priorityKeywords.some(keyword => sentence.toLowerCase().includes(keyword))) {
        priorities.push(sentence.trim());
      }
    });
    
    return priorities;
  }

  assessRestorePotential(assessment) {
    const excellentKeywords = ['excellent', 'high potential', 'favorable'];
    const goodKeywords = ['good', 'positive', 'favorable'];
    const fairKeywords = ['fair', 'moderate', 'guarded'];
    const poorKeywords = ['poor', 'limited', 'unfavorable'];
    
    const lowerAssessment = assessment.toLowerCase();
    
    if (excellentKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'excellent';
    if (goodKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'good';
    if (fairKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'fair';
    if (poorKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'poor';
    return 'good'; // Default
  }

  extractPredictedRecoveryDays(assessment) {
    const match = assessment.match(/PREDICTED_RECOVERY_DAYS:\s*(\d+|null)/i);
    if (!match || match[1].toLowerCase() === 'null') return null;
    const days = parseInt(match[1], 10);
    return (days >= 1 && days <= 730) ? days : null;
  }

  calculateStrengthImprovement(progressData) {
    if (progressData.strengthGains) {
      return progressData.strengthGains.overall || 0;
    }
    return 0;
  }

  calculateFunctionalGains(progressData) {
    if (progressData.functionalCapacity) {
      return progressData.functionalCapacity.improvement || 0;
    }
    return 0;
  }

  calculateRehabSpeed(programId) {
    const program = this.rehabilitationPrograms.get(programId);
    if (program && program.progressUpdates) {
      // Calculate based on phase progression speed
      const phaseChanges = program.progressUpdates.filter(update => 
        update.data.phaseProgression
      ).length;
      return Math.min(phaseChanges * 2, 10); // Cap at 10 for token calculation
    }
    return 0;
  }

  calculateReadinessScore(progressData) {
    let score = 0;

    if (progressData.strengthGains >= 80) score += 25;
    if (progressData.functionalCapacity >= 85) score += 25;
    if (progressData.movementQuality >= 90) score += 25;
    if (progressData.confidence >= 8) score += 25;

    return score;
  }

  getConfidence(task) {
    // Override base confidence with strength/functional-specific expertise
    const strengthTasks = ['functional_assessment', 'rehabilitation', 'strength', 'return_protocol', 'consultation'];
    const isStrengthTask = strengthTasks.some(t => task.toLowerCase().includes(t.toLowerCase()));

    // Base confidence starts higher for strength-related tasks
    let baseConfidence = isStrengthTask ? 0.80 : 0.40;

    // Experience bonus (up to 0.2)
    const experienceBonus = Math.min(this.experience * 0.005, 0.2);

    // Historical accuracy bonus based on successful programs
    const accuracyBonus = this.functionalTests.length > 0
      ? Math.min(this.functionalTests.length * 0.01, 0.05)
      : 0;

    return Math.min(baseConfidence + experienceBonus + accuracyBonus, 0.95);
  }

  getFunctionalStatistics() {
    const totalAssessments = this.functionalTests.length;
    const totalPrograms = this.rehabilitationPrograms.size;
    const totalProtocols = this.returnToActivityProtocols.size;
    
    const levelDistribution = {};
    const potentialDistribution = {};
    
    for (const assessment of this.functionalTests) {
      const level = assessment.functionalLevel;
      const potential = assessment.restorePotential;
      
      if (level) {
        const range = level <= 25 ? 'severe' : level <= 50 ? 'moderate' : level <= 75 ? 'mild' : 'minimal';
        levelDistribution[range] = (levelDistribution[range] || 0) + 1;
      }
      
      potentialDistribution[potential] = (potentialDistribution[potential] || 0) + 1;
    }
    
    return {
      totalAssessments,
      totalPrograms,
      totalProtocols,
      functionalLevelDistribution: levelDistribution,
      restorePotentialDistribution: potentialDistribution,
      experience: this.experience
    };
  }
}

export default StrengthSageAgent;