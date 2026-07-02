import { OrthopedicSpecialist } from './orthopedic-specialist.js';
import logger from '../utils/logger.js';
import { extractBodyPartFromQuery, extractSportActivity, getBodyPartSpecificPatterns, extractTimeline, extractInjuryMechanism, extractInjuryContext } from '../utils/body-part-extractor.js';

export class MovementDetectiveAgent extends OrthopedicSpecialist {
  constructor(name = 'Movement Detective', accountManager = null) {
    super(name, 'biomechanics and movement analysis', accountManager, 'movementDetective');
    this.agentType = 'movement_detective';
    this.movementPatterns = new Map();
    this.biomechanicalAssessments = [];
    this.compensatoryPatterns = new Set();
    this.movementInterventions = new Map();
  }

  getSystemPrompt() {
    return `You are ${this.name}, the biomechanics and movement analysis specialist in the AequOs recovery ecosystem.
    
    Your expertise lies in understanding the intricate relationships between anatomy, biomechanics, and functional movement to optimize recovery and prevent future injury through movement pattern analysis and correction.
    
    CORE SPECIALIZATIONS:
    - Comprehensive movement pattern analysis
    - Biomechanical dysfunction identification
    - Compensatory movement pattern detection
    - Gait and locomotion assessment
    - Sport-specific movement analysis
    - Postural assessment and correction
    - Kinetic chain evaluation
    - Movement re-education strategies
    
    ASSESSMENT FRAMEWORK:
    - Static postural analysis
    - Dynamic movement screening
    - Gait analysis and locomotion patterns
    - Sport-specific movement assessment
    - Kinetic chain evaluation
    - Muscle activation patterns
    - Range of motion assessment
    - Stability and balance testing
    
    Experience level: ${this.experience} points
    Movement assessments: ${this.biomechanicalAssessments.length}
    Wallet: ${this.walletAddress}
    
    EVIDENCE-BASED APPROACHES:
    - Functional Movement Screen (FMS) principles
    - Selective Functional Movement Assessment (SFMA)
    - Movement system impairment classification
    - Corrective exercise prescription
    - Motor control and learning principles
    - Neuromuscular re-education techniques
    
    TOKEN INCENTIVES:
    - Movement pattern improvement (>75% correction)
    - Injury recurrence prevention
    - Functional capacity enhancement
    - Return to sport/activity success
    - Patient education effectiveness
    - Collaboration with other specialists
    
    ASSESSMENT TOOLS:
    - Video movement analysis
    - Postural grid assessment
    - Functional movement screens
    - Sport-specific testing
    - Balance and proprioception testing
    - Strength and flexibility evaluation
    
    Your mission is to decode movement mysteries, identify dysfunction patterns, and prescribe targeted interventions that restore optimal movement and prevent future injury through biomechanically sound approaches.`;
  }

  async analyzeMovementPattern(movementData, context = {}) {
    try {
      const startTime = Date.now();
      logger.info(`${this.name} analyzing movement patterns`);

      // Extract dual-track data if present
      const { rawQuery, enableDualTrack } = movementData;

      // 🎯 PRE-EXTRACT context BEFORE building prompt
      const bodyPart = extractBodyPartFromQuery(rawQuery, movementData);
      const sport = extractSportActivity(rawQuery);
      const timeline = extractTimeline(rawQuery, movementData);
      const mechanism = extractInjuryMechanism(rawQuery, movementData);
      const injuryContext = extractInjuryContext(rawQuery);
      const age = movementData.age || 'unknown age';

      // Get body-part-specific patterns
      const relevantPatterns = bodyPart ? getBodyPartSpecificPatterns(bodyPart) : {};

      const analysisPrompt = `
You are an expert in biomechanics and arthrokinematics. Think deeply as a movement specialist.

🎯 PATIENT'S QUESTION: "${rawQuery || 'Movement assessment requested'}"

📋 INJURY CONTEXT:
- Body Part: ${bodyPart || 'Unspecified'}
- Mechanism: ${mechanism || 'Unknown'}
- Timeline: ${timeline ? `${timeline.value} ${timeline.unit}s ago (${timeline.phase} phase, Day ${timeline.totalDays})` : 'Unknown'}
- Age: ${age}
- Sport: ${sport || 'Not specified'}
- Context: ${injuryContext || 'Not specified'}

🧠 THINK LIKE A MOVEMENT SPECIALIST:
${mechanism && bodyPart ? `
- What joint mechanics were disrupted by this ${mechanism} injury to the ${bodyPart}?
- What arthrokinematics (gliding, rolling, spinning) need restoration?
- How is the kinetic chain compensating for this dysfunction?
- What movement patterns are at risk due to this ${timeline ? timeline.phase + ' phase' : ''} injury?
` : `
- What movement patterns are dysfunctional based on the symptoms?
- How does this affect the kinetic chain proximally and distally?
- What arthrokinematic restrictions need addressing?
`}

⚠️ PROVIDE EXPERT-LEVEL BIOMECHANICAL ANALYSIS:

1. **Clinical Reasoning** (Explain the biomechanics):
   ${mechanism === 'twist' && bodyPart === 'Knee' ? 'Example: "The twisting mechanism likely disrupted tibiofemoral arthrokinematics. Rotational forces may have damaged meniscal or ligamentous structures. The joint\'s normal gliding and rolling mechanics need restoration to prevent compensatory stress in the hip and ankle kinetic chain."' : 'Explain WHAT was disrupted biomechanically and WHY it matters for function and recovery.'}

2. **Specific Movement Restoration Protocol**:
   - Provide EXACT exercises with sets/reps/frequency/progression
   - Example: "Patellar mobilizations: 4 directions, 30 seconds each, 3x/day"
   - Example: "Heel slides for ROM: 3 sets of 15, twice daily, progress when reaching 0-120°"
   - NOT generic: "Movement pattern correction exercises"

3. **Phase-Appropriate Guidance** (${timeline ? timeline.phase : 'Current stage'}):
   ${timeline && timeline.phase === 'Early Proliferation' ? '- Focus: ROM restoration (target 80% of opposite side), neuromuscular control, early weight-bearing\n   - Avoid: High-impact, pivoting, deep flexion >90°' : '- Provide recommendations appropriate to injury timeline'}

4. **Progression Criteria** (Objective measures):
   - Example: "Progress when ROM reaches 0-120° and gait is symmetric with no antalgic pattern"
   - Define specific benchmarks, not vague timelines

Movement Data: ${JSON.stringify(movementData)}

        ${enableDualTrack && rawQuery ? `
🎯 REMEMBER: Your PRIMARY task is answering: "${rawQuery}"
        ` : ''}

        Provide your response as readable prose with markdown headers (## for sections).
        Write naturally as a biomechanics specialist explaining your movement analysis and recommendations.
        Cover key areas like postural assessment, movement patterns, gait analysis, kinetic chain, and compensatory patterns.
        Use bullet points for exercise lists, but write in clear, clinical narrative format.
      `;
      
      const analysis = await this.processMessage(analysisPrompt, context);
      const responseTime = Date.now() - startTime;

      // Parse movement patterns using body-part-specific context
      const dysfunctionPatterns = this.extractDysfunctionPatterns(analysis, bodyPart, relevantPatterns);
      const compensatoryPatterns = this.extractCompensatoryPatterns(analysis);
      const riskLevel = this.assessMovementRisk(analysis);

      // Body part was already extracted above (before prompt) - no need to extract again

      // Build structured response per Task 1.2
      const movementAssessment = {
        // Standard fields
        specialist: this.name,
        specialistType: 'movementDetective',

        // Structured assessment
        assessment: {
          primaryFindings: [
            bodyPart ? `${bodyPart} Movement Analysis:` : 'Movement Analysis:',
            `Movement dysfunction detected: ${dysfunctionPatterns.length > 0 ? dysfunctionPatterns[0] : 'Assessment in progress'}`,
            `Compensatory patterns: ${compensatoryPatterns.length > 0 ? compensatoryPatterns[0] : 'None identified'}`,
            `Movement risk level: ${riskLevel}`,
            bodyPart ? `Focus area: ${bodyPart}` : (movementData.affectedArea ? `Affected area: ${movementData.affectedArea}` : 'General assessment')
          ],
          confidence: this.getConfidence('movement_analysis'),
          dataQuality: movementData.description ? 0.8 : 0.4,
          clinicalImportance: riskLevel === 'high' ? 'high' : riskLevel === 'moderate' ? 'medium' : 'low'
        },

        // Raw LLM response for reference
        rawResponse: analysis,

        // Recommendations come from LLM rawResponse, not hardcoded
        recommendations: [],

        // Key findings with metadata
        keyFindings: [
          {
            finding: dysfunctionPatterns.length > 0 ? dysfunctionPatterns[0] : 'Movement assessment complete',
            confidence: 0.8,
            clinicalRelevance: riskLevel === 'high' ? 'high' : 'medium',
            requiresMDReview: riskLevel === 'high'
          }
        ],

        // Inter-agent questions
        questionsForAgents: [
          {
            targetAgent: 'painWhisperer',
            question: 'Is pain limiting movement patterns or is movement dysfunction causing pain?',
            priority: 'high'
          },
          {
            targetAgent: 'strengthSage',
            question: 'What strength deficits contribute to movement dysfunction?',
            priority: 'high'
          }
        ],

        // Follow-up questions for patient
        followUpQuestions: [
          'When do you notice the movement difficulty most?',
          'Have you had previous injuries to this area?',
          'What movements are most challenging for you?'
        ],

        // Agreement with triage assessment
        agreementWithTriage: dysfunctionPatterns.length > 0 ? 'full' : 'partial',

        // Standard metadata
        confidence: this.getConfidence('movement_analysis'),
        responseTime: responseTime,
        timestamp: new Date().toISOString(),
        status: 'success',

        // Movement-specific additional data
        assessmentId: `movement_${Date.now()}`,
        dysfunctionPatterns: dysfunctionPatterns,
        compensatoryPatterns: compensatoryPatterns,
        riskLevel: riskLevel
      };

      // Generate user-friendly markdown response
      movementAssessment.response = this.formatUserFriendlyResponse(movementAssessment);

      // Store assessment
      this.biomechanicalAssessments.push(movementAssessment);
      this.movementPatterns.set(movementAssessment.assessmentId, movementAssessment);

      // Track compensatory patterns
      if (movementAssessment.compensatoryPatterns) {
        movementAssessment.compensatoryPatterns.forEach(pattern =>
          this.compensatoryPatterns.add(pattern)
        );
      }

      this.updateExperience();

      return movementAssessment;
    } catch (error) {
      logger.error(`Error in movement pattern analysis: ${error.message}`);
      throw error;
    }
  }

  async developMovementPlan(movementAssessment) {
    try {
      logger.info(`${this.name} developing movement correction plan`);
      
      const planPrompt = `
        COMPREHENSIVE MOVEMENT CORRECTION PLAN:
        
        Movement Assessment: ${JSON.stringify(movementAssessment)}
        
        Develop systematic movement intervention strategy:
        
        1. CORRECTIVE EXERCISE PRESCRIPTION:
           - Inhibition techniques for overactive muscles
           - Lengthening strategies for tight structures
           - Activation exercises for underactive muscles
           - Integration movements for proper patterns
           
        2. NEUROMUSCULAR RE-EDUCATION:
           - Motor control training
           - Proprioceptive enhancement
           - Balance and stability progression
           - Coordination development
           
        3. MOVEMENT PATTERN TRAINING:
           - Fundamental movement patterns
           - Progressive loading strategies
           - Functional movement integration
           - Sport-specific movement preparation
           
        4. POSTURAL CORRECTION:
           - Ergonomic recommendations
           - Postural awareness training
           - Environmental modifications
           - Daily habit modifications
           
        5. FLEXIBILITY AND MOBILITY:
           - Static stretching protocols
           - Dynamic mobility exercises
           - Joint mobilization techniques
           - Fascial release strategies
           
        6. STRENGTH AND CONDITIONING:
           - Progressive strength training
           - Power development protocols
           - Endurance conditioning
           - Sport-specific preparation
           
        7. PROGRESSION TIMELINE:
           - Phase 1: Corrective (weeks 1-4)
           - Phase 2: Integration (weeks 5-8)
           - Phase 3: Performance (weeks 9-12)
           - Phase 4: Maintenance (ongoing)
           
        8. MONITORING AND ASSESSMENT:
           - Movement quality checkpoints
           - Progress measurement tools
           - Reassessment schedule
           - Modification triggers
           
        Provide specific, progressive, and evidence-based movement intervention plan.
      `;
      
      const correctionPlan = await this.processMessage(planPrompt);
      
      const planData = {
        planId: `plan_${Date.now()}`,
        assessmentId: movementAssessment.assessmentId,
        agent: this.name,
        plan: correctionPlan,
        phases: ['corrective', 'integration', 'performance', 'maintenance'],
        currentPhase: 'corrective',
        createdAt: new Date().toISOString(),
        confidence: this.getConfidence('movement_planning')
      };
      
      // Store intervention plan
      this.movementInterventions.set(planData.planId, planData);
      
      return planData;
    } catch (error) {
      logger.error(`Error developing movement plan: ${error.message}`);
      throw error;
    }
  }

  async monitorMovementProgress(planId, progressData) {
    try {
      logger.info(`${this.name} monitoring movement correction progress`);
      
      const monitoringPrompt = `
        MOVEMENT CORRECTION PROGRESS MONITORING:
        
        Plan ID: ${planId}
        Progress Data: ${JSON.stringify(progressData)}
        Original Plan: ${JSON.stringify(this.movementInterventions.get(planId))}
        
        Evaluate movement improvement and plan progression:
        
        1. MOVEMENT QUALITY ASSESSMENT:
           - Pattern correction percentage
           - Compensatory pattern reduction
           - Movement efficiency improvements
           - Symmetry restoration
           
        2. FUNCTIONAL IMPROVEMENT:
           - Daily activity performance
           - Sport/work-specific improvements
           - Pain reduction during movement
           - Endurance and capacity gains
           
        3. NEUROMUSCULAR CONTROL:
           - Motor control improvements
           - Proprioceptive enhancement
           - Balance and stability gains
           - Reaction time improvements
           
        4. STRENGTH AND FLEXIBILITY:
           - Range of motion improvements
           - Strength gains in key muscles
           - Power development
           - Flexibility/mobility progress
           
        5. PHASE PROGRESSION:
           - Current phase completion
           - Readiness for advancement
           - Timeline adherence
           - Modification needs
           
        6. RISK REDUCTION:
           - Injury risk factor elimination
           - Movement safety improvements
           - Load tolerance increases
           - Resilience building
           
        7. NEXT STEPS:
           - Immediate recommendations
           - Phase progression decisions
           - Plan modifications
           - Long-term strategy
           
        Provide evidence-based progress assessment with specific recommendations.
      `;
      
      const progressAssessment = await this.processMessage(monitoringPrompt);
      
      // Update intervention plan with progress
      const plan = this.movementInterventions.get(planId);
      if (plan) {
        if (!plan.progressUpdates) plan.progressUpdates = [];
        plan.progressUpdates.push({
          update: progressAssessment,
          data: progressData,
          timestamp: new Date().toISOString()
        });
        
        // Update phase if progression criteria met
        if (progressData.phaseProgression) {
          plan.currentPhase = progressData.phaseProgression;
        }
      }
      
      // Calculate movement improvement for token rewards
      const movementImprovement = this.calculateMovementImprovement(progressData);
      const functionalGains = this.calculateFunctionalGains(progressData);
      
      return {
        planId,
        progressAssessment,
        movementImprovement,
        functionalGains,
        currentPhase: plan?.currentPhase,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error monitoring movement progress: ${error.message}`);
      throw error;
    }
  }

  async analyzeGaitPattern(gaitData) {
    try {
      logger.info(`${this.name} analyzing gait pattern`);
      
      const gaitPrompt = `
        COMPREHENSIVE GAIT ANALYSIS:
        
        Gait Data: ${JSON.stringify(gaitData)}
        
        Perform detailed gait assessment including:
        
        1. TEMPORAL-SPATIAL PARAMETERS:
           - Cadence (steps per minute)
           - Stride length and symmetry
           - Step width and variability
           - Velocity and acceleration patterns
           
        2. STANCE PHASE ANALYSIS:
           - Initial contact patterns
           - Loading response
           - Mid-stance stability
           - Terminal stance push-off
           
        3. SWING PHASE EVALUATION:
           - Initial swing clearance
           - Mid-swing advancement
           - Terminal swing preparation
           - Ground clearance adequacy
           
        4. KINEMATIC ASSESSMENT:
           - Joint angle progressions
           - Sagittal plane motions
           - Frontal plane deviations
           - Transverse plane rotations
           
        5. COMPENSATORY MECHANISMS:
           - Hip hiking patterns
           - Circumduction strategies
           - Trendelenburg patterns
           - Antalgic modifications
           
        6. ENERGY EFFICIENCY:
           - Metabolic cost assessment
           - Energy transfer patterns
           - Mechanical efficiency
           - Fatigue effects
           
        7. FUNCTIONAL IMPLICATIONS:
           - Fall risk assessment
           - Mobility limitations
           - Activity restrictions
           - Intervention priorities
           
        Provide detailed gait analysis with specific recommendations for improvement.
      `;
      
      const gaitAnalysis = await this.processMessage(gaitPrompt);
      
      return {
        analysisId: `gait_${Date.now()}`,
        agent: this.name,
        gaitData,
        analysis: gaitAnalysis,
        deviations: this.extractGaitDeviations(gaitAnalysis),
        riskLevel: this.assessGaitRisk(gaitAnalysis),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error in gait analysis: ${error.message}`);
      throw error;
    }
  }

  async provideMovementEducation(educationRequest) {
    try {
      logger.info(`${this.name} providing movement education`);
      
      const educationPrompt = `
        MOVEMENT AND BIOMECHANICS EDUCATION:
        
        Education Request: ${JSON.stringify(educationRequest)}
        
        Provide patient-friendly movement education covering:
        
        1. MOVEMENT FUNDAMENTALS:
           - How proper movement works
           - Common movement mistakes
           - Benefits of good biomechanics
           - Cost of poor movement patterns
           
        2. YOUR SPECIFIC PATTERNS:
           - Individual movement assessment
           - Key areas for improvement
           - Why these patterns developed
           - How to recognize good vs poor movement
           
        3. DAILY MOVEMENT AWARENESS:
           - Posture throughout the day
           - Movement quality during activities
           - Environmental considerations
           - Habit formation strategies
           
        4. EXERCISE EXECUTION:
           - Proper form principles
           - Quality vs quantity focus
           - Progression guidelines
           - Safety considerations
           
        5. BODY AWARENESS:
           - Proprioceptive development
           - Movement self-assessment
           - Fatigue recognition
           - Pain vs discomfort
           
        6. INJURY PREVENTION:
           - Movement risk factors
           - Early warning signs
           - Protective strategies
           - Long-term movement health
           
        7. PERFORMANCE OPTIMIZATION:
           - Efficient movement patterns
           - Energy conservation
           - Skill development
           - Movement mastery
           
        Use clear, engaging language with practical examples and actionable guidance.
      `;
      
      const education = await this.processMessage(educationPrompt);
      
      return {
        agent: this.name,
        education,
        topic: educationRequest.topic || 'comprehensive_movement_education',
        timestamp: new Date().toISOString(),
        format: 'patient_friendly'
      };
    } catch (error) {
      logger.error(`Error providing movement education: ${error.message}`);
      throw error;
    }
  }

  extractBodyPart(movementData, analysis) {
    // First check if body part is explicitly provided
    if (movementData.bodyPart) return movementData.bodyPart;
    if (movementData.affectedArea) return movementData.affectedArea;
    if (movementData.location) return movementData.location;

    // Try to extract from raw query if available
    if (movementData.rawQuery) {
      const bodyParts = {
        'hip': ['hip', 'hips', 'hip joint', 'pelvis'],
        'knee': ['knee', 'knees', 'patella'],
        'shoulder': ['shoulder', 'shoulders', 'rotator cuff'],
        'back': ['back', 'spine', 'lumbar', 'thoracic', 'cervical'],
        'ankle': ['ankle', 'ankles', 'achilles'],
        'foot': ['foot', 'feet', 'plantar', 'heel'],
        'elbow': ['elbow', 'elbows'],
        'wrist': ['wrist', 'wrists', 'carpal'],
        'neck': ['neck', 'cervical spine']
      };

      const lowerQuery = movementData.rawQuery.toLowerCase();
      for (const [part, terms] of Object.entries(bodyParts)) {
        if (terms.some(term => lowerQuery.includes(term))) {
          return part.charAt(0).toUpperCase() + part.slice(1);
        }
      }
    }

    // Try to extract from analysis response
    const lowerAnalysis = analysis.toLowerCase();
    if (lowerAnalysis.includes('hip')) return 'Hip';
    if (lowerAnalysis.includes('knee')) return 'Knee';
    if (lowerAnalysis.includes('shoulder')) return 'Shoulder';
    if (lowerAnalysis.includes('back') || lowerAnalysis.includes('spine')) return 'Back';
    if (lowerAnalysis.includes('ankle')) return 'Ankle';
    if (lowerAnalysis.includes('foot')) return 'Foot';
    if (lowerAnalysis.includes('elbow')) return 'Elbow';
    if (lowerAnalysis.includes('wrist')) return 'Wrist';
    if (lowerAnalysis.includes('neck')) return 'Neck';

    return null;
  }

  extractDysfunctionPatterns(analysis, bodyPart = null, relevantPatterns = {}) {
    const patterns = [];
    const lowerAnalysis = analysis.toLowerCase();

    // If we have body-part-specific patterns from the extractor, use those exclusively
    if (bodyPart && Object.keys(relevantPatterns).length > 0) {
      Object.entries(relevantPatterns).forEach(([pattern, terms]) => {
        if (terms.some(term => lowerAnalysis.includes(term.toLowerCase()))) {
          patterns.push(pattern);
        }
      });

      // If no specific patterns found but we know the body part, add a generic pattern
      if (patterns.length === 0) {
        patterns.push(`${bodyPart.toLowerCase()}_dysfunction_detected`);
      }

      return patterns;
    }

    // Fallback: Legacy pattern extraction (if no body part was extracted)
    const mentionsHip = lowerAnalysis.includes('hip');
    const mentionsKnee = lowerAnalysis.includes('knee');
    const mentionsShoulder = lowerAnalysis.includes('shoulder');
    const mentionsBack = lowerAnalysis.includes('back') || lowerAnalysis.includes('spine');
    const mentionsElbow = lowerAnalysis.includes('elbow');

    // Elbow-related patterns
    if (mentionsElbow) {
      const elbowPatterns = {
        'elbow_instability': ['instability', 'dislocation', 'subluxation'],
        'UCL_injury': ['UCL', 'ulnar collateral', 'medial elbow'],
        'lateral_epicondylitis': ['tennis elbow', 'lateral epicondylitis'],
        'elbow_stiffness': ['stiffness', 'limited range', 'flexion contracture']
      };

      Object.entries(elbowPatterns).forEach(([pattern, terms]) => {
        if (terms.some(term => lowerAnalysis.includes(term))) {
          patterns.push(pattern);
        }
      });
    }

    // Knee-related patterns
    if (mentionsKnee) {
      const kneePatterns = {
        'valgus_collapse': ['valgus', 'knee collapse', 'medial collapse'],
        'patellar_tracking': ['patella', 'kneecap', 'tracking', 'maltracking'],
        'quad_weakness': ['quad weak', 'quadriceps weak', 'VMO'],
        'ACL_pattern': ['ACL', 'anterior cruciate', 'instability'],
        'meniscus_pattern': ['meniscus', 'locking', 'catching']
      };

      Object.entries(kneePatterns).forEach(([pattern, terms]) => {
        if (terms.some(term => lowerAnalysis.includes(term))) {
          patterns.push(pattern);
        }
      });
    }

    // Hip-related patterns
    if (mentionsHip) {
      const hipPatterns = {
        'hip_flexor_tightness': ['hip flexor tight', 'tight hip flexor', 'iliopsoas'],
        'weak_hip_abductors': ['weak hip abductor', 'weak glute', 'weak gluteal'],
        'FAI_pattern': ['impingement', 'FAI', 'femoroacetabular'],
        'hip_drop': ['hip drop', 'trendelenburg', 'pelvic drop']
      };

      Object.entries(hipPatterns).forEach(([pattern, terms]) => {
        if (terms.some(term => lowerAnalysis.includes(term))) {
          patterns.push(pattern);
        }
      });
    }

    // Back/Spine patterns
    if (mentionsBack) {
      const backPatterns = {
        'excessive_lordosis': ['excessive lordosis', 'anterior pelvic tilt'],
        'posterior_pelvic_tilt': ['posterior pelvic tilt', 'flat back']
      };

      Object.entries(backPatterns).forEach(([pattern, terms]) => {
        if (terms.some(term => lowerAnalysis.includes(term))) {
          patterns.push(pattern);
        }
      });
    }

    // Only include head/shoulder patterns if directly relevant
    if (mentionsShoulder || lowerAnalysis.includes('neck pain')) {
      const upperPatterns = {
        'anterior_head_posture': ['forward head', 'anterior head'],
        'rounded_shoulders': ['rounded shoulders', 'protracted shoulders']
      };

      Object.entries(upperPatterns).forEach(([pattern, terms]) => {
        if (terms.some(term => lowerAnalysis.includes(term))) {
          patterns.push(pattern);
        }
      });
    }

    // General patterns
    const generalPatterns = {
      'asymmetric_loading': ['asymmetric', 'unilateral loading'],
      'compensatory_pattern': ['compensatory', 'compensation']
    };

    Object.entries(generalPatterns).forEach(([pattern, terms]) => {
      if (terms.some(term => lowerAnalysis.includes(term))) {
        patterns.push(pattern);
      }
    });

    return patterns;
  }

  extractCompensatoryPatterns(analysis) {
    const patterns = [];
    const compensations = [
      'hip_hiking', 'circumduction', 'ankle_substitution',
      'trunk_lean', 'arm_swing_asymmetry', 'step_length_asymmetry'
    ];
    
    const lowerAnalysis = analysis.toLowerCase();
    
    compensations.forEach(pattern => {
      const searchTerms = pattern.replace('_', ' ');
      if (lowerAnalysis.includes(searchTerms)) {
        patterns.push(pattern);
      }
    });
    
    return patterns;
  }

  assessMovementRisk(analysis) {
    const highRiskKeywords = ['severe', 'marked', 'significant asymmetry', 'multiple compensations'];
    const lowRiskKeywords = ['mild', 'minimal', 'good', 'adequate'];
    
    const lowerAnalysis = analysis.toLowerCase();
    
    if (highRiskKeywords.some(keyword => lowerAnalysis.includes(keyword))) return 'high';
    if (lowRiskKeywords.some(keyword => lowerAnalysis.includes(keyword))) return 'low';
    return 'moderate';
  }

  extractGaitDeviations(gaitAnalysis) {
    const deviations = [];
    const gaitProblems = [
      'antalgic', 'trendelenburg', 'circumduction', 'steppage',
      'scissoring', 'crouched', 'stiff_knee', 'foot_drop'
    ];
    
    const lowerAnalysis = gaitAnalysis.toLowerCase();
    
    gaitProblems.forEach(deviation => {
      const searchTerm = deviation.replace('_', ' ');
      if (lowerAnalysis.includes(searchTerm)) {
        deviations.push(deviation);
      }
    });
    
    return deviations;
  }

  assessGaitRisk(gaitAnalysis) {
    const fallRiskKeywords = ['unsteady', 'fall risk', 'balance deficit', 'unstable'];
    const normalKeywords = ['normal', 'stable', 'good balance'];
    
    const lowerAnalysis = gaitAnalysis.toLowerCase();
    
    if (fallRiskKeywords.some(keyword => lowerAnalysis.includes(keyword))) return 'high';
    if (normalKeywords.some(keyword => lowerAnalysis.includes(keyword))) return 'low';
    return 'moderate';
  }

  calculateMovementImprovement(progressData) {
    if (progressData.movementQuality) {
      return progressData.movementQuality.improvement || 0;
    }
    return 0;
  }

  calculateFunctionalGains(progressData) {
    if (progressData.functionalGains) {
      return progressData.functionalGains.overall || 0;
    }
    return 0;
  }

  getConfidence(task) {
    // Override base confidence with movement-specific expertise
    const movementTasks = ['movement_analysis', 'movement_planning', 'biomechanics', 'gait', 'consultation'];
    const isMovementTask = movementTasks.some(t => task.toLowerCase().includes(t.toLowerCase()));

    // Base confidence starts higher for movement-related tasks
    let baseConfidence = isMovementTask ? 0.78 : 0.42;

    // Experience bonus (up to 0.2)
    const experienceBonus = Math.min(this.experience * 0.005, 0.2);

    // Historical accuracy bonus based on successful assessments
    const accuracyBonus = this.biomechanicalAssessments.length > 0
      ? Math.min(this.biomechanicalAssessments.length * 0.01, 0.05)
      : 0;

    return Math.min(baseConfidence + experienceBonus + accuracyBonus, 0.95);
  }

  getMovementStatistics() {
    const totalAssessments = this.biomechanicalAssessments.length;
    const totalPlans = this.movementInterventions.size;
    
    const dysfunctionDistribution = {};
    const riskDistribution = {};
    
    for (const assessment of this.biomechanicalAssessments) {
      const risk = assessment.riskLevel;
      riskDistribution[risk] = (riskDistribution[risk] || 0) + 1;
      
      if (assessment.dysfunctionPatterns) {
        assessment.dysfunctionPatterns.forEach(pattern => {
          dysfunctionDistribution[pattern] = (dysfunctionDistribution[pattern] || 0) + 1;
        });
      }
    }
    
    return {
      totalAssessments,
      totalCorrectionPlans: totalPlans,
      compensatoryPatterns: Array.from(this.compensatoryPatterns),
      dysfunctionDistribution,
      riskDistribution,
      experience: this.experience
    };
  }
}

export default MovementDetectiveAgent;