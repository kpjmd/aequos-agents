import { OrthopedicSpecialist } from './orthopedic-specialist.js';
import logger from '../utils/logger.js';
import { extractBodyPartFromQuery, extractSportActivity, extractTimeline } from '../utils/body-part-extractor.js';

export class MindMenderAgent extends OrthopedicSpecialist {
  constructor(name = 'Mind Mender', accountManager = null) {
    super(name, 'psychological aspects of recovery', accountManager, 'mindMender');
    this.agentType = 'mind_mender';
    this.psychologicalAssessments = new Map();
    this.interventionPlans = new Map();
    this.copingStrategies = new Set();
    this.behaviorModifications = [];
  }

  getSystemPrompt() {
    return `You are ${this.name}, the psychological aspects specialist in the AequOs recovery ecosystem.
    
    Your expertise encompasses the complex psychological factors that influence physical recovery, including pain perception, fear-avoidance behaviors, motivation, adherence, and the bidirectional relationship between mental and physical health in orthopedic recovery.
    
    CORE SPECIALIZATIONS:
    - Pain psychology and catastrophizing assessment
    - Fear-avoidance behavior identification and modification
    - Motivation enhancement and adherence strategies
    - Coping skills development and training
    - Anxiety and depression screening in injury context
    - Self-efficacy and confidence building
    - Behavioral change facilitation
    - Mindfulness and stress reduction techniques
    
    PSYCHOLOGICAL ASSESSMENT FRAMEWORK:
    - Pain catastrophizing scale assessment
    - Fear-avoidance beliefs evaluation
    - Depression and anxiety screening
    - Self-efficacy and confidence measures
    - Coping strategies assessment
    - Social support evaluation
    - Motivation and readiness assessment
    - Quality of life impact analysis
    
    Experience level: ${this.experience} points
    Psychological interventions: ${this.interventionPlans.size}
    Wallet: ${this.walletAddress}
    
    EVIDENCE-BASED APPROACHES:
    - Cognitive-behavioral therapy principles
    - Acceptance and commitment therapy
    - Mindfulness-based interventions
    - Motivational interviewing techniques
    - Graded exposure therapy
    - Behavioral activation strategies
    - Social support optimization
    
    TOKEN INCENTIVES:
    - Significant anxiety/depression reduction
    - Fear-avoidance behavior elimination
    - Improved treatment adherence (>90%)
    - Enhanced self-efficacy and confidence
    - Successful coping strategy implementation
    - Quality of life improvements
    
    INTERVENTION FOCUS AREAS:
    - Pain-related fear and avoidance
    - Catastrophic thinking patterns
    - Treatment adherence barriers
    - Motivation and goal engagement
    - Stress and anxiety management
    - Depression and mood regulation
    - Social support optimization
    - Return-to-activity confidence
    
    Your mission is to address the psychological barriers to recovery while building resilience, confidence, and adaptive coping strategies that support optimal physical healing and long-term well-being.`;
  }

  async assessPsychologicalFactors(assessmentData, context = {}) {
    try {
      const startTime = Date.now();
      logger.info(`${this.name} conducting comprehensive psychological assessment`);

      // Extract dual-track data if present
      const { rawQuery, enableDualTrack } = assessmentData;

      // 🎯 PRE-EXTRACT body part and sport BEFORE building prompt
      const bodyPart = extractBodyPartFromQuery(rawQuery, assessmentData);
      const sport = extractSportActivity(rawQuery);
      const timeline = extractTimeline(rawQuery, assessmentData);
      const age = assessmentData.age || 'unknown age';

      const assessmentPrompt = `
You are an expert in the psychological aspects of orthopedic recovery.

🎯 PATIENT'S QUESTION: "${rawQuery || 'Psychological assessment requested'}"

📋 PSYCHOLOGICAL CONTEXT:
- Injury: ${bodyPart ? `${bodyPart} injury` : 'Recovery'}
- Timeline: ${timeline ? `${timeline.value} ${timeline.unit}s ago (${timeline.phase} phase)` : 'Unknown'}
- Age: ${age}
- Sport: ${sport || 'Not specified'}
- Patient expressed: ${rawQuery ? `"${rawQuery}"` : 'General concern'}

🧠 THINK LIKE A PSYCHOLOGY SPECIALIST:
${rawQuery && (rawQuery.toLowerCase().includes('scared') || rawQuery.toLowerCase().includes('afraid') || rawQuery.toLowerCase().includes('nervous')) && sport ? `
- Patient expresses fear about specific activities (stairs, ${sport})
- What fear-avoidance behaviors are developing?
- How do we rebuild confidence for ${sport} return?
- What graded exposure protocol addresses this specific fear?
` : rawQuery && (rawQuery.toLowerCase().includes('scared') || rawQuery.toLowerCase().includes('afraid')) ? `
- Patient expresses fear about specific activities
- What fear-avoidance behaviors are developing?
- How do we rebuild movement confidence?
- What graded exposure protocol is needed?
` : sport ? `
- What psychological barriers exist to ${sport} return?
- How do we rebuild sport-specific confidence?
- What fear-avoidance patterns may be present?
` : `
- What psychological barriers to recovery exist?
- How is pain affecting mood and motivation?
- What fear-avoidance patterns may be present?
- What coping strategies would help?
`}

⚠️ PROVIDE EXPERT-LEVEL PSYCHOLOGICAL GUIDANCE:

1. **Psychological Assessment**:
   ${rawQuery && rawQuery.toLowerCase().includes('scared') && bodyPart ?
   `Example: "Fear of stairs after ${bodyPart} injury at ${timeline ? timeline.phase : 'this stage'} is a normal protective response. However, this can develop into maladaptive fear-avoidance behavior if not addressed. Your ${bodyPart} is healing - the fear is about re-injury, not current danger. We need graded exposure to rebuild confidence safely."` :
   `Assess current psychological state: What fears exist? What avoidance behaviors? What's the impact on recovery? Be specific, not generic.`}

2. **Graded Exposure Protocol** (Specific to Fear):
   ${rawQuery && rawQuery.toLowerCase().includes('scared') && rawQuery.toLowerCase().includes('stair') ? `
   Stair Confidence Building Protocol:
   - Phase 1: Single step up/down with rail support (master this first)
   - Phase 2: 3-5 steps with rail, both directions
   - Phase 3: Half flight with touch support only
   - Phase 4: Full flight with rail available (not holding)
   - Phase 5: Full flight no rail, normal speed

   Progression Rule: Master current level pain-free (0-3/10) for 3 consecutive days before advancing
   ` : sport === 'Football' ? `
   Graded Exposure for ${sport} Return:
   - Phase 1: Individual drills, no contact (build skill confidence)
   - Phase 2: Non-contact team drills (build game-speed confidence)
   - Phase 3: Controlled contact drills (build physical confidence)
   - Phase 4: Full practice (build competitive confidence)
   - Phase 5: Game return (build performance confidence)

   Psychological Readiness Criteria:
   - Confident in ${bodyPart} stability during cutting/pivoting
   - No hesitation or guarding during sport movements
   - Willing to engage in contact situations
   - Trust in rehabilitation and strength gains
   ` : `
   Provide specific graded exposure protocol:
   - Break feared activity into 5 progressive phases
   - Define objective criteria for phase progression
   - Address specific psychological barriers at each phase
   `}

3. **Pain Psychology Education**:
   - Pain does not equal harm at ${timeline ? timeline.phase : 'this stage'}
   - Acceptable pain: 0-3/10 during activity, returns to baseline after
   - Flare-ups are normal part of recovery, not re-injury
   - ${timeline && timeline.phase === 'Early Proliferation' ? 'At 3-6 weeks, tissues are healing and strengthening - movement is medicine' : 'Movement promotes healing when done appropriately'}

4. **Coping Strategies** (Specific):
   - When fear arises during ${rawQuery && rawQuery.toLowerCase().includes('stair') ? 'stairs' : sport || 'activity'}: "This is healing tissue, not damaged tissue. I can do this safely."
   - Breathing technique: 4-count inhale, 6-count exhale during feared movement
   - Visualization: Successfully completing ${rawQuery && rawQuery.toLowerCase().includes('stair') ? 'stairs' : sport || 'activity'} pain-free
   - Progress tracking: Journal confidence levels (0-10) to see objective improvement

Assessment Data: ${JSON.stringify(assessmentData)}

        ${enableDualTrack && rawQuery ? `
🎯 REMEMBER: Your PRIMARY task is answering: "${rawQuery}"
${sport ? `🏈 ADDRESS: Fear of returning to ${sport}, confidence for contact/competition` : ''}
        ` : ''}

        Provide your response as readable prose with markdown headers (## for sections).
        Write naturally as a psychology specialist explaining your assessment and recommendations.
        Use bullet points for protocols, but write in clear, empathetic clinical narrative format.
      `;
      
      const assessment = await this.processMessage(assessmentPrompt, context);
      const responseTime = Date.now() - startTime;

      // Parse psychological metrics
      const riskFactors = this.extractPsychologicalRisks(assessment);
      const protectiveFactors = this.extractProtectiveFactors(assessment);
      const interventionTargets = this.extractInterventionTargets(assessment);
      const urgencyLevel = this.assessPsychologicalUrgency(assessment);

      // Build structured response per Task 1.2
      const psychAssessment = {
        // Standard fields
        specialist: this.name,
        specialistType: 'mindMender',

        // Structured assessment
        assessment: {
          primaryFindings: [
            `Psychological risk factors: ${riskFactors.length > 0 ? riskFactors[0] : 'None identified'}`,
            `Protective factors: ${protectiveFactors.length > 0 ? protectiveFactors.length : 0}`,
            `Intervention priority: ${urgencyLevel}`,
            assessmentData.concerns ? `Primary concerns: ${assessmentData.concerns.join(', ')}` : 'Concerns unspecified'
          ],
          confidence: this.getConfidence('psychological_assessment'),
          dataQuality: assessmentData.description ? 0.8 : 0.4,
          clinicalImportance: urgencyLevel === 'high' ? 'high' : urgencyLevel === 'moderate' ? 'medium' : 'low'
        },

        // Raw LLM response for reference
        rawResponse: assessment,

        // Recommendations come from LLM rawResponse, not hardcoded
        recommendations: [],

        // Key findings with metadata
        keyFindings: [
          {
            finding: riskFactors.length > 0 ? riskFactors[0] : 'Psychological assessment complete',
            confidence: 0.8,
            clinicalRelevance: urgencyLevel === 'high' ? 'high' : 'medium',
            requiresMDReview: urgencyLevel === 'high' || riskFactors.length > 3
          }
        ],

        // Inter-agent questions
        questionsForAgents: [
          {
            targetAgent: 'painWhisperer',
            question: 'Is catastrophic thinking amplifying pain perception?',
            priority: 'high'
          },
          {
            targetAgent: 'strengthSage',
            question: 'Is fear-avoidance limiting participation in rehabilitation?',
            priority: 'high'
          },
          {
            targetAgent: 'movementDetective',
            question: 'Are there movement compensations driven by fear?',
            priority: 'medium'
          }
        ],

        // Follow-up questions for patient
        followUpQuestions: [
          'How worried are you about re-injuring yourself?',
          'What activities are you avoiding due to fear?',
          'How is your mood and stress level affecting your recovery?'
        ],

        // Agreement with triage assessment
        agreementWithTriage: 'full',

        // Standard metadata
        confidence: this.getConfidence('psychological_assessment'),
        responseTime: responseTime,
        timestamp: new Date().toISOString(),
        status: 'success',

        // Psychology-specific additional data
        assessmentId: `psych_${Date.now()}`,
        riskFactors: riskFactors,
        protectiveFactors: protectiveFactors,
        interventionTargets: interventionTargets,
        urgencyLevel: urgencyLevel
      };

      // Generate user-friendly markdown response
      psychAssessment.response = this.formatUserFriendlyResponse(psychAssessment);

      // Store assessment
      this.psychologicalAssessments.set(psychAssessment.assessmentId, psychAssessment);
      this.updateExperience();

      return psychAssessment;
    } catch (error) {
      logger.error(`Error in psychological assessment: ${error.message}`);
      throw error;
    }
  }

  async developPsychologicalIntervention(psychAssessment) {
    try {
      logger.info(`${this.name} developing psychological intervention plan`);
      
      const interventionPrompt = `
        COMPREHENSIVE PSYCHOLOGICAL INTERVENTION PLAN:
        
        Psychological Assessment: ${JSON.stringify(psychAssessment)}
        
        Design evidence-based psychological intervention including:
        
        1. COGNITIVE INTERVENTIONS:
           - Cognitive restructuring for catastrophic thoughts
           - Pain education and understanding
           - Realistic expectation setting
           - Thought challenging techniques
           - Mindfulness and present-moment awareness
           
        2. BEHAVIORAL INTERVENTIONS:
           - Graded exposure to feared activities
           - Activity pacing and scheduling
           - Behavioral activation strategies
           - Goal setting and achievement
           - Relaxation and stress management
           
        3. FEAR-AVOIDANCE MODIFICATION:
           - Movement confidence building
           - Systematic desensitization
           - Safety behavior reduction
           - Gradual activity exposure
           - Success experience creation
           
        4. PAIN COPING STRATEGIES:
           - Adaptive coping skill development
           - Distraction and attention techniques
           - Breathing and relaxation methods
           - Imagery and visualization
           - Acceptance and mindfulness approaches
           
        5. MOTIVATION ENHANCEMENT:
           - Motivational interviewing principles
           - Value clarification exercises
           - Goal alignment and commitment
           - Intrinsic motivation development
           - Barrier identification and problem-solving
           
        6. MOOD REGULATION:
           - Depression intervention strategies
           - Anxiety management techniques
           - Emotional regulation skills
           - Pleasant activity scheduling
           - Social connection enhancement
           
        7. ADHERENCE OPTIMIZATION:
           - Barrier identification and removal
           - Habit formation strategies
           - Self-monitoring techniques
           - Accountability systems
           - Reward and reinforcement plans
           
        8. SOCIAL SUPPORT MOBILIZATION:
           - Support network identification
           - Communication skill development
           - Family education and involvement
           - Peer support connections
           - Professional support utilization
           
        9. SELF-EFFICACY BUILDING:
           - Mastery experience creation
           - Skill development and practice
           - Success attribution training
           - Confidence building exercises
           - Self-advocacy development
           
        10. IMPLEMENTATION STRATEGY:
            - Session structure and frequency
            - Homework and practice assignments
            - Progress monitoring methods
            - Booster session planning
            - Crisis intervention protocols
        
        Provide specific, step-by-step psychological intervention plan with clear objectives and methods.
      `;
      
      const interventionPlan = await this.processMessage(interventionPrompt);
      
      const planData = {
        planId: `psych_plan_${Date.now()}`,
        assessmentId: psychAssessment.assessmentId,
        agent: this.name,
        plan: interventionPlan,
        targetAreas: psychAssessment.interventionTargets,
        interventionType: 'comprehensive_psychological',
        expectedDuration: '12-16 weeks',
        sessionFrequency: 'weekly',
        createdAt: new Date().toISOString(),
        confidence: this.getConfidence('intervention_planning')
      };
      
      // Store intervention plan
      this.interventionPlans.set(planData.planId, planData);
      
      return planData;
    } catch (error) {
      logger.error(`Error developing psychological intervention: ${error.message}`);
      throw error;
    }
  }

  async monitorPsychologicalProgress(planId, progressData) {
    try {
      logger.info(`${this.name} monitoring psychological intervention progress`);
      
      const monitoringPrompt = `
        PSYCHOLOGICAL INTERVENTION PROGRESS MONITORING:
        
        Plan ID: ${planId}
        Progress Data: ${JSON.stringify(progressData)}
        Original Plan: ${JSON.stringify(this.interventionPlans.get(planId))}
        
        Evaluate psychological intervention effectiveness:
        
        1. SYMPTOM IMPROVEMENT:
           - Depression and anxiety reduction
           - Pain catastrophizing changes
           - Fear-avoidance behavior modification
           - Stress and worry level changes
           - Sleep and appetite improvements
           
        2. COGNITIVE CHANGES:
           - Thought pattern modifications
           - Cognitive flexibility improvements
           - Realistic thinking development
           - Problem-solving enhancement
           - Attention and focus changes
           
        3. BEHAVIORAL MODIFICATIONS:
           - Activity engagement increases
           - Avoidance behavior reductions
           - Coping strategy utilization
           - Self-care behavior improvements
           - Social engagement changes
           
        4. SELF-EFFICACY ENHANCEMENT:
           - Confidence level improvements
           - Self-efficacy belief changes
           - Mastery experience accumulation
           - Goal achievement progress
           - Independence development
           
        5. TREATMENT ADHERENCE:
           - Session attendance rates
           - Homework completion
           - Strategy practice frequency
           - Skill application success
           - Engagement and motivation
           
        6. FUNCTIONAL IMPROVEMENTS:
           - Daily activity performance
           - Role function restoration
           - Relationship quality changes
           - Work performance improvements
           - Quality of life enhancement
           
        7. COPING SKILL DEVELOPMENT:
           - New strategy acquisition
           - Skill refinement progress
           - Strategy effectiveness
           - Generalization to new situations
           - Crisis management abilities
           
        8. INTERVENTION ADJUSTMENTS:
           - Strategy modifications needed
           - Session frequency changes
           - Focus area adjustments
           - Booster session requirements
           - Termination planning
           
        Provide evidence-based progress assessment with specific recommendations for continued intervention.
      `;
      
      const progressAssessment = await this.processMessage(monitoringPrompt);
      
      // Update intervention plan with progress
      const plan = this.interventionPlans.get(planId);
      if (plan) {
        if (!plan.progressUpdates) plan.progressUpdates = [];
        plan.progressUpdates.push({
          update: progressAssessment,
          data: progressData,
          timestamp: new Date().toISOString()
        });
      }
      
      // Calculate improvements for token rewards
      const anxietyReduction = this.calculateAnxietyReduction(progressData);
      const adherenceImprovement = this.calculateAdherenceImprovement(progressData);
      const confidenceGains = this.calculateConfidenceGains(progressData);
      
      return {
        planId,
        progressAssessment,
        anxietyReduction,
        adherenceImprovement,
        confidenceGains,
        readinessForDischarge: this.assessDischargeReadiness(progressData),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error monitoring psychological progress: ${error.message}`);
      throw error;
    }
  }

  async provideCopingStrategies(copingRequest) {
    try {
      logger.info(`${this.name} providing coping strategies`);
      
      const copingPrompt = `
        PERSONALIZED COPING STRATEGY RECOMMENDATIONS:
        
        Coping Request: ${JSON.stringify(copingRequest)}
        
        Provide specific, actionable coping strategies including:
        
        1. IMMEDIATE COPING TECHNIQUES:
           - Quick anxiety relief methods
           - Pain flare-up management
           - Stress reduction techniques
           - Crisis intervention strategies
           - Emergency coping plans
           
        2. COGNITIVE COPING STRATEGIES:
           - Thought challenging techniques
           - Realistic thinking practices
           - Perspective-taking exercises
           - Problem-solving methods
           - Mindfulness techniques
           
        3. BEHAVIORAL COPING APPROACHES:
           - Relaxation and breathing exercises
           - Activity pacing strategies
           - Distraction techniques
           - Physical comfort measures
           - Movement and exercise integration
           
        4. EMOTIONAL REGULATION SKILLS:
           - Emotion identification techniques
           - Emotional expression methods
           - Mood regulation strategies
           - Stress management approaches
           - Emotional tolerance building
           
        5. SOCIAL COPING RESOURCES:
           - Support network utilization
           - Communication strategies
           - Help-seeking behaviors
           - Boundary setting techniques
           - Relationship maintenance
           
        6. MEANING-MAKING AND ACCEPTANCE:
           - Value clarification exercises
           - Acceptance strategies
           - Post-traumatic growth facilitation
           - Resilience building techniques
           - Hope and optimism cultivation
           
        7. PRACTICAL COPING TOOLS:
           - Daily routine structures
           - Self-care planning
           - Energy management
           - Time management strategies
           - Environmental modifications
           
        8. LONG-TERM COPING DEVELOPMENT:
           - Skill practice schedules
           - Strategy refinement plans
           - Generalization techniques
           - Maintenance strategies
           - Relapse prevention
           
        Provide practical, evidence-based coping strategies tailored to the specific request.
      `;
      
      const copingStrategies = await this.processMessage(copingPrompt);
      
      // Add to coping strategies set
      const strategyData = {
        strategyId: `coping_${Date.now()}`,
        agent: this.name,
        request: copingRequest,
        strategies: copingStrategies,
        timestamp: new Date().toISOString()
      };
      
      this.copingStrategies.add(strategyData.strategyId);
      
      return strategyData;
    } catch (error) {
      logger.error(`Error providing coping strategies: ${error.message}`);
      throw error;
    }
  }

  async providePsychoeducation(educationRequest) {
    try {
      logger.info(`${this.name} providing psychological education`);
      
      const educationPrompt = `
        PSYCHOLOGICAL EDUCATION FOR RECOVERY:
        
        Education Request: ${JSON.stringify(educationRequest)}
        
        Provide patient-friendly psychological education covering:
        
        1. MIND-BODY CONNECTION:
           - How thoughts affect physical recovery
           - Pain and emotion relationships
           - Stress impact on healing
           - Brain plasticity and recovery
           
        2. UNDERSTANDING YOUR RESPONSES:
           - Normal psychological reactions to injury
           - Fear and anxiety explanations
           - Grief and loss in injury context
           - Adaptation and resilience concepts
           
        3. PAIN PSYCHOLOGY BASICS:
           - Pain perception and processing
           - Chronic vs acute pain differences
           - Central sensitization concepts
           - Pain-emotion connections
           
        4. RECOVERY PSYCHOLOGY:
           - Motivation and recovery relationship
           - Adherence importance and strategies
           - Goal setting and achievement
           - Setback normalization and management
           
        5. COPING AND RESILIENCE:
           - Adaptive vs maladaptive coping
           - Resilience building techniques
           - Stress management importance
           - Support system utilization
           
        6. BEHAVIORAL CHANGE:
           - Habit formation principles
           - Motivation enhancement
           - Barrier identification and overcoming
           - Success strategy development
           
        7. SELF-ADVOCACY AND EMPOWERMENT:
           - Communication with healthcare providers
           - Decision-making participation
           - Self-monitoring and awareness
           - Confidence building approaches
           
        Use compassionate, empowering language that validates experiences while promoting growth and recovery.
      `;
      
      const education = await this.processMessage(educationPrompt);
      
      return {
        agent: this.name,
        education,
        topic: educationRequest.topic || 'comprehensive_psychological_education',
        timestamp: new Date().toISOString(),
        format: 'patient_friendly'
      };
    } catch (error) {
      logger.error(`Error providing psychological education: ${error.message}`);
      throw error;
    }
  }

  extractPsychologicalRisks(assessment) {
    const risks = [];
    const riskKeywords = {
      'high_catastrophizing': ['catastrophizing', 'catastrophic thinking'],
      'severe_fear_avoidance': ['fear avoidance', 'kinesiophobia'],
      'significant_depression': ['depression', 'depressed mood'],
      'high_anxiety': ['anxiety', 'anxious'],
      'poor_coping': ['poor coping', 'maladaptive coping'],
      'low_self_efficacy': ['low confidence', 'low self-efficacy'],
      'social_isolation': ['isolated', 'poor support']
    };
    
    const lowerAssessment = assessment.toLowerCase();
    
    Object.entries(riskKeywords).forEach(([risk, keywords]) => {
      if (keywords.some(keyword => lowerAssessment.includes(keyword))) {
        risks.push(risk);
      }
    });
    
    return risks;
  }

  extractProtectiveFactors(assessment) {
    const factors = [];
    const protectiveKeywords = {
      'good_social_support': ['good support', 'strong support'],
      'high_motivation': ['motivated', 'high motivation'],
      'adaptive_coping': ['good coping', 'adaptive coping'],
      'realistic_expectations': ['realistic', 'appropriate expectations'],
      'positive_outlook': ['optimistic', 'positive outlook'],
      'good_self_efficacy': ['confident', 'high self-efficacy']
    };
    
    const lowerAssessment = assessment.toLowerCase();
    
    Object.entries(protectiveKeywords).forEach(([factor, keywords]) => {
      if (keywords.some(keyword => lowerAssessment.includes(keyword))) {
        factors.push(factor);
      }
    });
    
    return factors;
  }

  extractInterventionTargets(assessment) {
    const targets = [];
    const targetKeywords = {
      'catastrophizing_reduction': ['catastrophizing'],
      'fear_avoidance_modification': ['fear avoidance'],
      'depression_treatment': ['depression'],
      'anxiety_management': ['anxiety'],
      'coping_skill_development': ['coping'],
      'motivation_enhancement': ['motivation'],
      'adherence_improvement': ['adherence'],
      'confidence_building': ['confidence', 'self-efficacy']
    };
    
    const lowerAssessment = assessment.toLowerCase();
    
    Object.entries(targetKeywords).forEach(([target, keywords]) => {
      if (keywords.some(keyword => lowerAssessment.includes(keyword))) {
        targets.push(target);
      }
    });
    
    return targets;
  }

  assessPsychologicalUrgency(assessment) {
    const highUrgencyKeywords = ['severe depression', 'suicidal', 'crisis', 'severe anxiety'];
    const moderateUrgencyKeywords = ['moderate depression', 'significant anxiety', 'marked impairment'];
    
    const lowerAssessment = assessment.toLowerCase();
    
    if (highUrgencyKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'high';
    if (moderateUrgencyKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'moderate';
    return 'low';
  }

  calculateAnxietyReduction(progressData) {
    if (progressData.anxietyScores) {
      const initial = progressData.anxietyScores.initial || 10;
      const current = progressData.anxietyScores.current || initial;
      return Math.round(((initial - current) / initial) * 100);
    }
    return 0;
  }

  calculateAdherenceImprovement(progressData) {
    if (progressData.adherenceRate) {
      return progressData.adherenceRate || 0;
    }
    return 0;
  }

  calculateConfidenceGains(progressData) {
    if (progressData.confidenceScores) {
      const initial = progressData.confidenceScores.initial || 1;
      const current = progressData.confidenceScores.current || initial;
      return Math.round(((current - initial) / 9) * 100); // Assuming 1-10 scale
    }
    return 0;
  }

  assessDischargeReadiness(progressData) {
    let readiness = 0;

    if (progressData.anxietyScores?.current <= 3) readiness += 25;
    if (progressData.adherenceRate >= 90) readiness += 25;
    if (progressData.confidenceScores?.current >= 8) readiness += 25;
    if (progressData.copingSkillMastery >= 80) readiness += 25;

    return readiness;
  }

  getConfidence(task) {
    // Override base confidence with psychological-specific expertise
    const psychTasks = ['psychological_assessment', 'intervention', 'coping', 'mental_health', 'consultation'];
    const isPsychTask = psychTasks.some(t => task.toLowerCase().includes(t.toLowerCase()));

    // Base confidence starts higher for psych-related tasks
    let baseConfidence = isPsychTask ? 0.77 : 0.38;

    // Experience bonus (up to 0.2)
    const experienceBonus = Math.min(this.experience * 0.005, 0.2);

    // Historical accuracy bonus based on successful interventions
    const accuracyBonus = this.psychologicalAssessments.size > 0
      ? Math.min(this.psychologicalAssessments.size * 0.01, 0.05)
      : 0;

    return Math.min(baseConfidence + experienceBonus + accuracyBonus, 0.95);
  }

  getPsychologicalStatistics() {
    const totalAssessments = this.psychologicalAssessments.size;
    const totalInterventions = this.interventionPlans.size;
    const totalCopingStrategies = this.copingStrategies.size;
    
    const riskDistribution = {};
    const urgencyDistribution = {};
    
    for (const [id, assessment] of this.psychologicalAssessments) {
      const urgency = assessment.urgencyLevel;
      urgencyDistribution[urgency] = (urgencyDistribution[urgency] || 0) + 1;
      
      if (assessment.riskFactors) {
        assessment.riskFactors.forEach(risk => {
          riskDistribution[risk] = (riskDistribution[risk] || 0) + 1;
        });
      }
    }
    
    return {
      totalAssessments,
      totalInterventions,
      totalCopingStrategies,
      riskFactorDistribution: riskDistribution,
      urgencyDistribution,
      experience: this.experience
    };
  }
}

export default MindMenderAgent;