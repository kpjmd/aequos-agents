import { OrthopedicSpecialist } from './orthopedic-specialist.js';
import logger from '../utils/logger.js';
import { extractBodyPartFromQuery, extractSportActivity, extractTimeline, extractInjuryMechanism } from '../utils/body-part-extractor.js';

export class PainWhispererAgent extends OrthopedicSpecialist {
  constructor(name = 'Pain Whisperer', accountManager = null) {
    super(name, 'pain management and assessment', accountManager, 'painWhisperer');
    this.agentType = 'pain_whisperer';
    this.painScales = {
      numeric: { min: 0, max: 10 },
      functional: ['none', 'mild', 'moderate', 'severe', 'excruciating'],
      descriptive: ['burning', 'aching', 'sharp', 'throbbing', 'cramping', 'stabbing']
    };
    this.painInterventions = new Map();
    this.painTrackingHistory = [];
  }

  getSystemPrompt() {
    return `You are ${this.name}, the specialized pain management expert in the AequOs recovery ecosystem.
    
    Your expertise encompasses comprehensive pain assessment, management, and recovery optimization through understanding the complex interplay of physical, psychological, and social factors affecting pain experience.
    
    CORE SPECIALIZATIONS:
    - Comprehensive pain assessment and phenotyping
    - Multi-modal pain management strategies
    - Acute to chronic pain transition prevention
    - Opioid-sparing approaches and alternatives
    - Interventional pain procedures guidance
    - Pain psychology and coping strategies
    - Functional restoration through pain management
    
    PAIN ASSESSMENT FRAMEWORK:
    - Intensity (0-10 scale, functional impact)
    - Quality (sharp, dull, burning, etc.)
    - Temporal patterns (constant, intermittent, positional)
    - Triggers and relieving factors
    - Functional impact on daily activities
    - Psychological impact and coping
    - Sleep and mood effects
    
    Experience level: ${this.experience} points
    Pain cases managed: ${this.painTrackingHistory.length}
    Wallet: ${this.walletAddress}
    
    EVIDENCE-BASED APPROACHES:
    - Multimodal analgesia protocols
    - Movement-based pain management
    - Cognitive-behavioral strategies
    - Mindfulness and relaxation techniques
    - Graded exposure and activity pacing
    - Social support optimization
    
    TOKEN INCENTIVES:
    - Pain reduction achievements (>50% improvement)
    - Functional improvement milestones
    - Opioid reduction success
    - Patient satisfaction with pain management
    - Collaboration with other specialists
    - Innovation in pain management approaches
    
    SAFETY PROTOCOLS:
    - Red flag symptom recognition
    - Medication safety and monitoring
    - Addiction risk assessment
    - Emergency pain situations
    - Appropriate escalation pathways
    
    Your goal is to minimize suffering while maximizing function and quality of life through comprehensive, compassionate, and evidence-based pain management.`;
  }

  async assessPain(painData, context = {}) {
    try {
      const startTime = Date.now();
      logger.info(`${this.name} conducting comprehensive pain assessment`);

      // Extract dual-track data if present
      const { rawQuery, enableDualTrack } = painData;

      // 🎯 PRE-EXTRACT body part and sport BEFORE building prompt
      const bodyPart = extractBodyPartFromQuery(rawQuery, painData);
      const sport = extractSportActivity(rawQuery);
      const timeline = extractTimeline(rawQuery, painData);
      const mechanism = extractInjuryMechanism(rawQuery, painData);
      const age = painData.age || 'unknown age';

      const assessmentPrompt = `
You are an expert in pain neuroscience and management. Think deeply as a pain specialist.

🎯 PATIENT'S QUESTION: "${rawQuery || 'Pain assessment requested'}"

📋 PAIN CONTEXT:
- Pain Level: ${painData.painLevel || 'Unknown'}/10
- Body Part: ${bodyPart || 'Unspecified'}
- Timeline: ${timeline ? `${timeline.value} ${timeline.unit}s ago (${timeline.phase} phase, Day ${timeline.totalDays})` : 'Unknown'}
- Mechanism: ${mechanism || 'Unknown'}
- Age: ${age}
- Sport: ${sport || 'Not specified'}

🧠 THINK LIKE A PAIN SPECIALIST:
${timeline && mechanism ? `
- What is the nociceptive state at ${timeline.phase} phase after ${mechanism} injury?
- What pain mechanisms are active (inflammatory, neuropathic, central)?
- Is there a pain-spasm-pain cycle maintaining symptoms?
- How is the nervous system interpreting threat after this ${mechanism} injury?
` : `
- What is the nociceptive state (sensitization level)?
- What pain mechanisms are active (inflammatory, neuropathic, central)?
- Is there a pain-spasm-pain cycle?
- How is the nervous system interpreting threat?
`}

⚠️ PROVIDE EXPERT-LEVEL PAIN MANAGEMENT:

1. **Pain Neuroscience Reasoning**:
   ${painData.painLevel >= 6 && timeline && timeline.phase === 'Early Proliferation' ?
   `Example: "${painData.painLevel}/10 pain with fluctuating swelling at ${timeline.phase} phase suggests ongoing nociceptive sensitization. The pain-spasm-pain cycle is likely active, where pain causes muscle guarding, which increases joint stress, perpetuating inflammation."` :
   `Explain the pain neuroscience: What sensitization level? What cycles are maintaining pain? NOT generic "multimodal approach"`}

2. **Specific Pain Management Protocol**:
   - Ice: 15-20 min post-activity (NOT before, as this reduces muscle activation)
   - Compression: Sleeve during daytime, remove at night for circulation
   - Elevation: 3-4x daily, 20 min above heart level
   - Swelling monitoring: If morning swelling increases >5mm next day, reduce activity load 50%
   - NOT: "Multimodal pain management approach"

3. **Nervous System De-escalation**:
   - Pain education about healing vs harm at ${timeline ? timeline.phase : 'current phase'}
   - Acceptable pain levels: 0-3/10 during rehab, returns to baseline after
   - Flare-ups are normal at this stage, not setbacks

4. **Red Flags to Assess**:
   ${bodyPart === 'Knee' && mechanism === 'twist' ?
   `- Increasing swelling despite rest → imaging needed
   - Locking/catching → possible meniscus tear
   - Hot, red joint with fever → rule out infection` :
   `- Progressive worsening pain
   - Neurological changes (numbness, weakness)
   - Systemic symptoms (fever, malaise)`}

Pain Data: ${JSON.stringify(painData)}

        ${enableDualTrack && rawQuery ? `
🎯 REMEMBER: Your PRIMARY task is answering: "${rawQuery}"
        ` : ''}

        Provide your response as readable prose with markdown headers (## for sections).
        Write naturally as a pain specialist explaining findings and recommendations to the patient.
        Use bullet points for lists, but write in clear, clinical narrative format.
      `;
      
      const assessment = await this.processMessage(assessmentPrompt, context);
      const responseTime = Date.now() - startTime;

      // Parse and structure the response
      const painScore = this.extractPainScore(assessment, painData);
      const functionalImpact = this.extractFunctionalImpact(assessment);
      const riskLevel = this.extractRiskLevel(assessment);

      // Build structured response per Task 1.2
      const painAssessment = {
        // Standard fields
        specialist: this.name,
        specialistType: 'painWhisperer',

        // Structured assessment
        assessment: {
          primaryFindings: [
            `Pain level: ${painScore}/10`,
            `Functional impact: ${functionalImpact}`,
            `Chronicity risk: ${riskLevel}`,
            painData.location ? `Location: ${painData.location}` : 'Location unspecified'
          ],
          confidence: this.getConfidence('pain_assessment'),
          dataQuality: painData.painLevel !== undefined ? 0.9 : 0.5,
          clinicalImportance: painScore >= 7 ? 'high' : painScore >= 4 ? 'medium' : 'low'
        },

        // Raw LLM response for reference
        rawResponse: assessment,

        // Recommendations come from LLM rawResponse, not hardcoded
        recommendations: [],

        // Key findings with metadata
        keyFindings: [
          {
            finding: `Pain severity ${painScore}/10 with ${functionalImpact} functional impact`,
            confidence: 0.85,
            clinicalRelevance: painScore >= 7 ? 'high' : 'medium',
            requiresMDReview: painScore >= 9 || riskLevel === 'high'
          }
        ],

        // Inter-agent questions
        questionsForAgents: [
          {
            targetAgent: 'movementDetective',
            question: 'Are there movement patterns contributing to pain maintenance?',
            priority: 'high'
          },
          {
            targetAgent: 'mindMender',
            question: 'Are psychological factors amplifying pain perception?',
            priority: functionalImpact === 'severe' ? 'high' : 'medium'
          }
        ],

        // Follow-up questions for patient
        followUpQuestions: [
          'What activities specifically trigger or worsen your pain?',
          'How does the pain affect your sleep quality?',
          'What pain relief methods have you already tried?'
        ],

        // Agreement with triage assessment
        agreementWithTriage: 'full',

        // Standard metadata
        confidence: this.getConfidence('pain_assessment'),
        responseTime: responseTime,
        timestamp: new Date().toISOString(),
        status: 'success',

        // Pain-specific additional data
        painScore: painScore,
        functionalImpact: functionalImpact,
        riskLevel: riskLevel
      };

      // Generate user-friendly markdown response
      painAssessment.response = this.formatUserFriendlyResponse(painAssessment);

      // Store in tracking history
      this.painTrackingHistory.push(painAssessment);
      this.updateExperience();

      return painAssessment;
    } catch (error) {
      logger.error(`Error in pain assessment: ${error.message}`);
      throw error;
    }
  }

  async developPainManagementPlan(painAssessment) {
    try {
      logger.info(`${this.name} developing comprehensive pain management plan`);
      
      const planPrompt = `
        EVIDENCE-BASED PAIN MANAGEMENT PLAN:
        
        Pain Assessment: ${JSON.stringify(painAssessment)}
        
        Develop comprehensive, multimodal pain management strategy:
        
        1. PHARMACOLOGICAL INTERVENTIONS:
           - Primary analgesic recommendations
           - Adjuvant medications (anticonvulsants, antidepressants)
           - Topical agents and preparations
           - Opioid-sparing alternatives
           - Rescue medication protocols
           
        2. NON-PHARMACOLOGICAL APPROACHES:
           - Physical therapy and exercise prescription
           - Heat/cold therapy applications
           - TENS and electrical stimulation
           - Acupuncture and dry needling
           - Massage and manual therapy
           
        3. INTERVENTIONAL OPTIONS:
           - Injection therapy candidates
           - Nerve block considerations
           - Regenerative medicine options
           - Surgical intervention timing
           
        4. PSYCHOLOGICAL INTERVENTIONS:
           - Cognitive-behavioral therapy referrals
           - Mindfulness and meditation training
           - Stress management techniques
           - Sleep hygiene optimization
           - Relaxation training
           
        5. LIFESTYLE MODIFICATIONS:
           - Activity pacing strategies
           - Ergonomic recommendations
           - Nutrition optimization
           - Sleep quality improvement
           - Stress reduction techniques
           
        6. MONITORING AND ADJUSTMENT:
           - Pain tracking methods
           - Functional outcome measures
           - Side effect monitoring
           - Plan modification triggers
           - Reassessment schedule
           
        7. PATIENT EDUCATION:
           - Pain science education
           - Self-management strategies
           - Warning sign recognition
           - Medication safety
           - When to seek help
           
        Provide personalized, evidence-based management plan with clear timelines.
      `;
      
      const managementPlan = await this.processMessage(planPrompt);
      
      const planData = {
        planId: `plan_${Date.now()}`,
        assessmentId: painAssessment.assessmentId,
        agent: this.name,
        plan: managementPlan,
        multimodalApproach: true,
        opioidSparing: true,
        functionalFocus: true,
        createdAt: new Date().toISOString(),
        confidence: this.getConfidence('pain_management_planning')
      };
      
      // Store intervention plan
      this.painInterventions.set(planData.planId, planData);
      
      return planData;
    } catch (error) {
      logger.error(`Error developing pain management plan: ${error.message}`);
      throw error;
    }
  }

  async monitorPainProgress(planId, progressData) {
    try {
      logger.info(`${this.name} monitoring pain management progress`);
      
      const monitoringPrompt = `
        PAIN MANAGEMENT PROGRESS MONITORING:
        
        Plan ID: ${planId}
        Progress Data: ${JSON.stringify(progressData)}
        Original Plan: ${JSON.stringify(this.painInterventions.get(planId))}
        
        Evaluate current progress and provide recommendations:
        
        1. PAIN INTENSITY TRACKING:
           - Current pain scores vs baseline
           - Pain pattern changes
           - Breakthrough pain episodes
           - Activity-related pain variations
           
        2. FUNCTIONAL IMPROVEMENT:
           - Daily activity performance
           - Work/occupational function
           - Sleep quality changes
           - Recreational activity return
           
        3. INTERVENTION EFFECTIVENESS:
           - Medication response
           - Non-pharmacological success
           - Side effect profile
           - Adherence challenges
           
        4. PSYCHOLOGICAL PROGRESS:
           - Mood and anxiety changes
           - Coping strategy effectiveness
           - Fear-avoidance reduction
           - Self-efficacy improvement
           
        5. PLAN MODIFICATIONS:
           - Dose adjustments needed
           - Intervention additions/changes
           - Timeline modifications
           - Goal reassessment
           
        6. NEXT STEPS:
           - Immediate recommendations
           - Follow-up schedule
           - Specialist referrals
           - Plan optimization
           
        Provide evidence-based progress assessment with actionable recommendations.
      `;
      
      const progressAssessment = await this.processMessage(monitoringPrompt);
      
      // Update intervention plan with progress
      const plan = this.painInterventions.get(planId);
      if (plan) {
        if (!plan.progressUpdates) plan.progressUpdates = [];
        plan.progressUpdates.push({
          update: progressAssessment,
          data: progressData,
          timestamp: new Date().toISOString()
        });
      }
      
      // Calculate potential token rewards based on progress
      const painReduction = this.calculatePainReduction(progressData);
      const functionalImprovement = this.calculateFunctionalImprovement(progressData);
      
      return {
        planId,
        progressAssessment,
        painReduction,
        functionalImprovement,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error monitoring pain progress: ${error.message}`);
      throw error;
    }
  }

  async providePainEducation(educationRequest) {
    try {
      logger.info(`${this.name} providing pain education`);
      
      const educationPrompt = `
        COMPREHENSIVE PAIN EDUCATION:
        
        Education Request: ${JSON.stringify(educationRequest)}
        
        Provide patient-friendly pain education covering:
        
        1. PAIN SCIENCE BASICS:
           - What is pain and why it occurs
           - Acute vs chronic pain differences
           - Pain pathway explanation
           - Central sensitization concepts
           
        2. UNDERSTANDING YOUR PAIN:
           - Specific condition explanation
           - Why this pain pattern occurs
           - Normal vs concerning symptoms
           - Recovery timeline expectations
           
        3. SELF-MANAGEMENT STRATEGIES:
           - Activity pacing techniques
           - Breathing and relaxation methods
           - Heat/cold application guidelines
           - Movement and exercise principles
           
        4. MEDICATION WISDOM:
           - How pain medications work
           - Proper usage and timing
           - Side effect management
           - Safety considerations
           
        5. LIFESTYLE FACTORS:
           - Sleep's role in pain recovery
           - Nutrition and inflammation
           - Stress management importance
           - Social support utilization
           
        6. WHEN TO SEEK HELP:
           - Warning signs to watch for
           - Emergency situations
           - When to contact providers
           - Resource availability
           
        7. HOPE AND RECOVERY:
           - Recovery success stories
           - Realistic expectations
           - Goal setting strategies
           - Motivation maintenance
           
        Use clear, empathetic, and empowering language suitable for patient education.
      `;
      
      const education = await this.processMessage(educationPrompt);
      
      return {
        agent: this.name,
        education,
        topic: educationRequest.topic || 'comprehensive_pain_education',
        timestamp: new Date().toISOString(),
        format: 'patient_friendly'
      };
    } catch (error) {
      logger.error(`Error providing pain education: ${error.message}`);
      throw error;
    }
  }

  extractPainScore(assessment, painData = {}) {
    // ✅ FIX: Check painData.painLevel FIRST before trying to extract from text
    if (painData.painLevel !== undefined && painData.painLevel !== null) {
      const painLevel = parseInt(painData.painLevel);
      if (!isNaN(painLevel) && painLevel >= 0 && painLevel <= 10) {
        return painLevel;
      }
    }

    // Fall back to extracting from assessment text
    const patterns = [
      /pain\s+(?:score|level|intensity|severity)[:\s]+(\d+)(?:\/10|\s+out\s+of\s+10)?/i,
      /(\d+)\/10\s+pain/i,
      /pain[:\s]+(\d+)(?:\/10)?/i,
      /rate.*?pain.*?(\d+)/i,
      /(\d+)\s+(?:on|out\s+of).*?pain\s+scale/i
    ];

    for (const pattern of patterns) {
      const match = assessment.match(pattern);
      if (match && parseInt(match[1]) <= 10) {
        return parseInt(match[1]);
      }
    }

    // If no explicit score found, try to infer from severity descriptions
    const lowerAssessment = assessment.toLowerCase();
    if (lowerAssessment.includes('severe') || lowerAssessment.includes('excruciating')) return 8;
    if (lowerAssessment.includes('moderate')) return 5;
    if (lowerAssessment.includes('mild') || lowerAssessment.includes('minimal')) return 3;

    return null;
  }

  extractFunctionalImpact(assessment) {
    const lowKeywords = ['minimal', 'slight', 'mild'];
    const moderateKeywords = ['moderate', 'significant', 'noticeable'];
    const severeKeywords = ['severe', 'major', 'substantial', 'marked'];
    
    const lowerAssessment = assessment.toLowerCase();
    
    if (severeKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'severe';
    if (moderateKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'moderate';
    if (lowKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'mild';
    return 'unknown';
  }

  extractRiskLevel(assessment) {
    const highRiskKeywords = ['chronic', 'central sensitization', 'catastrophizing', 'high risk'];
    const lowRiskKeywords = ['acute', 'well-localized', 'low risk', 'good prognosis'];
    
    const lowerAssessment = assessment.toLowerCase();
    
    if (highRiskKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'high';
    if (lowRiskKeywords.some(keyword => lowerAssessment.includes(keyword))) return 'low';
    return 'moderate';
  }

  calculatePainReduction(progressData) {
    if (progressData.initialPain && progressData.currentPain) {
      const reduction = ((progressData.initialPain - progressData.currentPain) / progressData.initialPain) * 100;
      return Math.max(0, Math.round(reduction));
    }
    return 0;
  }

  calculateFunctionalImprovement(progressData) {
    if (progressData.functionalScore) {
      return progressData.functionalScore.improvement || 0;
    }
    return 0;
  }

  getConfidence(task) {
    // Override base confidence with pain-specific expertise
    const painTasks = ['pain_assessment', 'pain_management', 'pain_monitoring', 'consultation'];
    const isPainTask = painTasks.some(t => task.toLowerCase().includes(t.toLowerCase()));

    // Base confidence starts higher for pain-related tasks
    let baseConfidence = isPainTask ? 0.75 : 0.45;

    // Experience bonus (up to 0.2)
    const experienceBonus = Math.min(this.experience * 0.005, 0.2);

    // Historical accuracy bonus based on successful assessments
    const accuracyBonus = this.painTrackingHistory.length > 0
      ? Math.min(this.painTrackingHistory.length * 0.01, 0.05)
      : 0;

    return Math.min(baseConfidence + experienceBonus + accuracyBonus, 0.95);
  }

  getPainStatistics() {
    const totalAssessments = this.painTrackingHistory.length;
    const totalPlans = this.painInterventions.size;
    
    const riskDistribution = {};
    const painScoreDistribution = {};
    
    for (const assessment of this.painTrackingHistory) {
      const risk = assessment.riskLevel;
      const score = assessment.painScore;
      
      riskDistribution[risk] = (riskDistribution[risk] || 0) + 1;
      if (score !== null) {
        const scoreRange = score <= 3 ? 'mild' : score <= 6 ? 'moderate' : 'severe';
        painScoreDistribution[scoreRange] = (painScoreDistribution[scoreRange] || 0) + 1;
      }
    }
    
    return {
      totalAssessments,
      totalManagementPlans: totalPlans,
      riskDistribution,
      painScoreDistribution,
      experience: this.experience
    };
  }
}

export default PainWhispererAgent;