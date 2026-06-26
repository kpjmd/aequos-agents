import { BaseAgent } from './base-agent.js';
import logger from '../utils/logger.js';
import { makePositionSchema, makeReconsiderSchema } from '../utils/dialogue-schemas.js';
import { resolvePersona } from '../utils/specialist-identity.js';

export class OrthopedicSpecialist extends BaseAgent {
  constructor(name, subspecialty = 'general orthopedics', accountManager = null, agentId = null) {
    super(name, 'orthopedic medicine', accountManager, agentId);
    this.subspecialty = subspecialty;
    this.medicalKnowledge = this.initializeMedicalKnowledge();
    this.recoveryMetrics = new Map();
    this.digitalRxHistory = [];
  }

  /**
   * State a structured position on one triage-framed decision point, from this specialist's lens.
   * Deferral ("defer") is a first-class, valued outcome when the decision is outside this
   * specialist's expertise or the evidence is insufficient — never fabricate a stance.
   * @param {Object} caseData
   * @param {{id:string,question:string,options:string[],rationale?:string}} decisionPoint
   * @param {Object} context - { mode, timeout }
   * @returns {Promise<{decisionPointId,specialist,specialistType,stance,confidence,reasoning,evidenceGrade}>}
   */
  /**
   * Build the exact statePosition user prompt (population vs patient-specific branch).
   * Extracted so the batched benchmark path (src/utils/batch-probe.js) can replicate the
   * live position call byte-for-byte — single source of truth for the prompt.
   * @param {Object} caseData
   * @param {{id,question,options}} decisionPoint
   * @param {Object} context - { population }
   * @returns {string}
   */
  buildPositionPrompt(caseData, decisionPoint, context = {}) {
    const optionList = decisionPoint.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');

    // Population mode (benchmark probe): reason at the population level on a canonical decision,
    // not for a specific patient. Isolates the detector's intrinsic equipoise sensitivity and
    // avoids the vignette-framing confounds that drive convergence (see divergence-spike-findings).
    return context.population === true
      ? `As ${this.name} (${this.subspecialty}), state YOUR position on the following clinical decision at the POPULATION level, reasoning ONLY from your area of expertise.

DECISION: ${decisionPoint.question}
OPTIONS:
${optionList}

Reason for a TYPICAL adult patient for whom this decision arises — assume no atypical comorbidities or contraindications, and do not invent patient specifics beyond this.

Instructions:
- Choose exactly one option you support, OR choose "defer".
- DEFER if this decision is outside your specialty lens, or if the evidence available to you is insufficient to take a responsible position. Deferring is appropriate and expected — do not invent a stance to seem decisive.
- Ground your reasoning in your specialty's evidence and judgment for this population.`
      : `As ${this.name} (${this.subspecialty}), state YOUR position on the following clinical decision for this patient, reasoning ONLY from your area of expertise.

DECISION: ${decisionPoint.question}
OPTIONS:
${optionList}

<patient_input>
${JSON.stringify(caseData)}
</patient_input>

Instructions:
- Choose exactly one option you support, OR choose "defer".
- DEFER if this decision is outside your specialty lens, or if the evidence available to you is insufficient to take a responsible position. Deferring is appropriate and expected — do not invent a stance to seem decisive.
- Ground your reasoning in THIS patient's specifics, from your specialty's perspective.`;
  }

  async statePosition(caseData, decisionPoint, context = {}) {
    const schema = makePositionSchema(decisionPoint.options);
    const prompt = this.buildPositionPrompt(caseData, decisionPoint, context);

    try {
      const result = await this.processStructured(prompt, schema, {
        mode: context.mode || 'normal',
        timeout: context.timeout || 75000,
        schemaName: 'specialist_position',
      });
      return {
        decisionPointId: decisionPoint.id,
        ...resolvePersona(this.agentType || this.subspecialty),
        stance: result.stance,
        defer: result.stance === 'defer',
        confidence: result.confidence,
        reasoning: result.reasoning,
        evidenceGrade: result.evidenceGrade,
      };
    } catch (error) {
      logger.error(`${this.name}: statePosition failed for "${decisionPoint.id}": ${error.message}`);
      return {
        decisionPointId: decisionPoint.id,
        ...resolvePersona(this.agentType || this.subspecialty),
        stance: 'defer',
        defer: true,
        confidence: 0,
        reasoning: `Position unavailable (${error.message})`,
        evidenceGrade: 'none',
        error: true,
      };
    }
  }

  /**
   * Dialogue round: reconsider this specialist's position in light of the opposing positions,
   * then HOLD (with rebuttal) or REVISE (with reason). Captures the pre/post position delta.
   * @param {Object} caseData
   * @param {{id,question,options}} decisionPoint
   * @param {{stance,reasoning}} ownPosition - this specialist's initial position
   * @param {Array<{specialist,stance,reasoning}>} opposingPositions
   * @param {Object} context - { mode, timeout }
   * @returns {Promise<Object>} dialogue entry with originalStance/revisedStance/changed/changeReason
   */
  async reconsiderPosition(caseData, decisionPoint, ownPosition, opposingPositions, context = {}) {
    const schema = makeReconsiderSchema(decisionPoint.options);
    const optionList = decisionPoint.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
    const opposingText = opposingPositions
      .map(p => `- ${p.specialist} argues for "${p.stance}": ${p.reasoning}`)
      .join('\n');

    const prompt = context.population === true
      ? `You are ${this.name} (${this.subspecialty}) in a multi-specialist panel debating a canonical clinical decision at the POPULATION level. The panel DISAGREES. Reconsider YOUR position in light of your colleagues' reasoning.

DECISION: ${decisionPoint.question}
OPTIONS:
${optionList}

YOUR INITIAL POSITION: "${ownPosition.stance}" — ${ownPosition.reasoning}

COLLEAGUES WHO DISAGREE:
${opposingText}

Reason for a TYPICAL adult patient for whom this decision arises — no atypical comorbidities or contraindications. Engage honestly with their reasoning from your specialty lens. HOLD your position (and rebut) if you still believe it is right for this population; REVISE it only if their reasoning genuinely changes your clinical judgment. A well-reasoned persistent disagreement is valuable — do not revise merely to reach consensus, and do not hold out of stubbornness.`
      : `You are ${this.name} (${this.subspecialty}) in a multi-specialist panel discussing this patient. The panel DISAGREES on a decision. Reconsider YOUR position in light of your colleagues' reasoning.

DECISION: ${decisionPoint.question}
OPTIONS:
${optionList}

YOUR INITIAL POSITION: "${ownPosition.stance}" — ${ownPosition.reasoning}

COLLEAGUES WHO DISAGREE:
${opposingText}

<patient_input>
${JSON.stringify(caseData)}
</patient_input>

Engage honestly with their reasoning from your specialty lens. HOLD your position (and rebut) if you still believe it is right for this patient; REVISE it only if their reasoning genuinely changes your clinical judgment. A well-reasoned persistent disagreement is valuable — do not revise merely to reach consensus, and do not hold out of stubbornness.`;

    try {
      const result = await this.processStructured(prompt, schema, {
        mode: context.mode || 'normal',
        timeout: context.timeout || 75000,
        schemaName: 'reconsidered_position',
      });
      return {
        decisionPointId: decisionPoint.id,
        ...resolvePersona(this.agentType || this.subspecialty),
        originalStance: ownPosition.stance,
        revisedStance: result.revisedStance,
        changed: result.revisedStance !== ownPosition.stance,
        reasoning: result.reconsideration,
        changeReason: result.changeReason,
        confidence: result.confidence,
      };
    } catch (error) {
      logger.error(`${this.name}: reconsiderPosition failed for "${decisionPoint.id}": ${error.message}`);
      return {
        decisionPointId: decisionPoint.id,
        ...resolvePersona(this.agentType || this.subspecialty),
        originalStance: ownPosition.stance,
        revisedStance: ownPosition.stance,
        changed: false,
        reasoning: `Reconsideration unavailable (${error.message})`,
        changeReason: 'held (reconsideration error)',
        confidence: ownPosition.confidence ?? 0,
        error: true,
      };
    }
  }

  initializeMedicalKnowledge() {
    return {
      anatomicalSystems: ['musculoskeletal', 'joints', 'bones', 'ligaments', 'tendons'],
      commonConditions: [
        'fractures', 'arthritis', 'sports_injuries', 'joint_replacement',
        'spine_disorders', 'pediatric_orthopedics', 'soft_tissue_injuries'
      ],
      diagnosticTools: ['xray', 'mri', 'ct_scan', 'physical_examination', 'ultrasound'],
      treatmentModalities: [
        'surgery', 'physical_therapy', 'medication', 'injections', 
        'regenerative_medicine', 'biomechanical_correction'
      ],
      recoveryStages: [
        'acute_phase', 'inflammatory_phase', 'proliferation_phase', 
        'maturation_phase', 'functional_restoration'
      ]
    };
  }

  getSystemPrompt() {
    return `You are ${this.name}, an AI orthopedic specialist with expertise in ${this.subspecialty}.
    
    Your capabilities include:
    - Analyzing orthopedic conditions and symptoms with recovery focus
    - Recommending diagnostic approaches and recovery timelines
    - Suggesting evidence-based treatment options
    - Providing patient education and functional goal setting
    - Collaborating with multidisciplinary recovery specialists
    - Generating enhanced digital prescriptions with recovery metrics
    
    Experience level: ${this.experience} points
    Subspecialty: ${this.subspecialty}
    Wallet: ${this.walletAddress}
    
    RECOVERY-FOCUSED APPROACH:
    - Prioritize functional outcomes and quality of life
    - Assess recovery timeline and milestones
    - Consider biomechanical and psychological factors
    - Emphasize patient empowerment and education
    - Coordinate care with other specialists
    
    IMPORTANT MEDICAL DISCLAIMERS:
    - Always recommend consulting with a licensed physician for medical decisions
    - Provide educational information, not definitive diagnoses
    - Emphasize the importance of proper medical evaluation
    - Maintain patient safety as the highest priority
    
    TOKEN INCENTIVES:
    - Earn tokens for successful patient outcomes
    - Bonus tokens for MD approval and functional improvement
    - Collaboration bonuses for effective multidisciplinary care
    
    Respond professionally with evidence-based medical knowledge while being clear about limitations.`;
  }

  async analyzeSymptoms(symptoms, patientHistory = {}) {
    try {
      logger.info(`${this.name} analyzing symptoms for recovery-focused orthopedic assessment`);
      
      const analysisPrompt = `
        RECOVERY-FOCUSED ORTHOPEDIC ANALYSIS:
        
        Patient presents with: ${JSON.stringify(symptoms)}
        Patient history: ${JSON.stringify(patientHistory)}
        
        Please provide comprehensive analysis including:
        
        1. ASSESSMENT:
           - Possible orthopedic conditions to consider
           - Severity and urgency stratification
           - Risk factors and complicating factors
        
        2. DIAGNOSTIC PLAN:
           - Recommended diagnostic tests (priority order)
           - Expected timeline for diagnosis
           - Cost-effectiveness considerations
        
        3. RECOVERY TIMELINE:
           - Expected recovery phases and duration
           - Functional milestones and goals
           - Factors that may accelerate or delay recovery
        
        4. TREATMENT APPROACH:
           - Conservative vs surgical options
           - Evidence-based treatment modalities
           - Multidisciplinary care coordination needs
        
        5. RISK STRATIFICATION:
           - Red flags requiring immediate medical attention
           - Complications to monitor
           - When to escalate care
        
        6. PATIENT EDUCATION:
           - Key points for patient understanding
           - Self-management strategies
           - Activity modifications
        
        7. FUNCTIONAL GOALS:
           - Short-term objectives (1-4 weeks)
           - Medium-term goals (1-3 months)
           - Long-term outcomes (3-12 months)
        
        Remember to emphasize the need for professional medical evaluation and maintain appropriate disclaimers.
      `;

      const response = await this.processMessage(analysisPrompt);
      
      // Calculate confidence and update experience
      const confidence = this.getConfidence('symptom_analysis');
      this.updateExperience();
      
      const analysis = {
        agent: this.name,
        agentId: this.agentId,
        subspecialty: this.subspecialty,
        confidence,
        analysis: response,
        recoveryFocused: true,
        timestamp: new Date().toISOString(),
        walletAddress: this.walletAddress
      };
      
      // Store for potential token rewards
      this.recoveryMetrics.set(`analysis_${Date.now()}`, {
        type: 'symptom_analysis',
        confidence,
        timestamp: new Date().toISOString()
      });
      
      return analysis;
    } catch (error) {
      logger.error(`Error in symptom analysis by ${this.name}:`, error);
      throw error;
    }
  }

  async reviewImagingStudy(imagingType, findings, clinicalContext = '') {
    try {
      logger.info(`${this.name} reviewing ${imagingType} study with recovery focus`);
      
      const reviewPrompt = `
        RECOVERY-FOCUSED IMAGING REVIEW:
        
        Imaging Study: ${imagingType}
        Findings: ${findings}
        Clinical Context: ${clinicalContext}
        
        Please provide comprehensive interpretation including:
        
        1. IMAGING INTERPRETATION:
           - Detailed analysis of findings
           - Correlation with clinical presentation
           - Severity assessment
        
        2. RECOVERY IMPLICATIONS:
           - How findings affect recovery timeline
           - Prognostic indicators
           - Factors influencing healing potential
        
        3. TREATMENT PLANNING:
           - Conservative vs surgical indications
           - Timing considerations
           - Recovery optimization strategies
        
        4. FUNCTIONAL ASSESSMENT:
           - Impact on daily activities
           - Work/sport return timeline
           - Activity restrictions needed
        
        5. MONITORING PLAN:
           - Follow-up imaging recommendations
           - Clinical milestones to track
           - When to reassess
        
        6. MULTIDISCIPLINARY COORDINATION:
           - Other specialists needed
           - Therapy referrals
           - Care coordination points
        
        Maintain appropriate medical disclaimers about professional interpretation.
      `;

      const response = await this.processMessage(reviewPrompt);
      const confidence = this.getConfidence('imaging_review');
      this.updateExperience();
      
      const review = {
        agent: this.name,
        agentId: this.agentId,
        imagingType,
        confidence,
        review: response,
        recoveryFocused: true,
        timestamp: new Date().toISOString(),
        walletAddress: this.walletAddress
      };
      
      this.recoveryMetrics.set(`imaging_${Date.now()}`, {
        type: 'imaging_review',
        confidence,
        timestamp: new Date().toISOString()
      });
      
      return review;
    } catch (error) {
      logger.error(`Error in imaging review by ${this.name}:`, error);
      throw error;
    }
  }

  async processOrthoIQQuestion(questionData) {
    try {
      logger.info(`${this.name} processing OrthoIQ platform question`);
      
      const { question, context, patientProfile, urgency } = questionData;
      
      const orthoIQPrompt = `
        ORTHOIQ PLATFORM CONSULTATION:
        
        Question: ${question}
        Context: ${JSON.stringify(context)}
        Patient Profile: ${JSON.stringify(patientProfile)}
        Urgency Level: ${urgency}
        
        As an orthopedic specialist on the OrthoIQ platform, provide:
        
        1. DIRECT ANSWER:
           - Clear response to the specific question
           - Evidence-based recommendations
           - Confidence level in response
        
        2. RECOVERY PERSPECTIVE:
           - How this impacts patient recovery
           - Timeline considerations
           - Optimization strategies
        
        3. ADDITIONAL CONSIDERATIONS:
           - Related factors to consider
           - Potential complications
           - When to seek further evaluation
        
        4. PATIENT EDUCATION:
           - Key teaching points
           - Resources for further learning
           - Self-advocacy guidance
        
        5. PLATFORM INTEGRATION:
           - Suggested follow-up actions
           - Monitoring recommendations
           - Care coordination needs
        
        Format for digital platform delivery with appropriate disclaimers.
      `;
      
      const response = await this.processMessage(orthoIQPrompt);
      const confidence = this.getConfidence('orthoiq_consultation');
      
      const consultation = {
        agent: this.name,
        agentId: this.agentId,
        platform: 'OrthoIQ',
        question: question,
        response: response,
        confidence,
        urgency,
        timestamp: new Date().toISOString(),
        walletAddress: this.walletAddress
      };
      
      // Track for potential token rewards
      this.recoveryMetrics.set(`orthoiq_${Date.now()}`, {
        type: 'orthoiq_consultation',
        confidence,
        urgency,
        timestamp: new Date().toISOString()
      });
      
      return consultation;
    } catch (error) {
      logger.error(`Error processing OrthoIQ question by ${this.name}:`, error);
      throw error;
    }
  }

  async generateDigitalRx(analysis) {
    try {
      logger.info(`${this.name} generating enhanced digital prescription`);
      
      const digitalRxPrompt = `
        ENHANCED DIGITAL PRESCRIPTION GENERATION:
        
        Based on analysis: ${JSON.stringify(analysis)}
        
        Create a comprehensive digital prescription including:
        
        1. TREATMENT PLAN:
           - Primary interventions
           - Secondary/adjunct therapies
           - Timeline and sequencing
        
        2. RECOVERY METRICS:
           - Measurable outcomes
           - Progress indicators
           - Success criteria
        
        3. FUNCTIONAL GOALS:
           - Daily activity targets
           - Work/sport milestones
           - Quality of life measures
        
        4. MONITORING PROTOCOL:
           - Check-in schedule
           - Red flag symptoms
           - Progress assessment tools
        
        5. DIGITAL INTEGRATION:
           - App recommendations
           - Wearable device integration
           - Telemedicine schedule
        
        6. MULTIDISCIPLINARY COORDINATION:
           - Specialist referrals
           - Therapy prescriptions
           - Care team communication
        
        7. PATIENT EMPOWERMENT:
           - Education resources
           - Self-management tools
           - Decision-making support
        
        Format as structured digital prescription with blockchain verification capability.
      `;
      
      const response = await this.processMessage(digitalRxPrompt);
      
      const digitalRx = {
        id: `rx_${Date.now()}_${this.agentId}`,
        prescribingAgent: this.name,
        agentId: this.agentId,
        prescription: response,
        baseAnalysis: analysis,
        timestamp: new Date().toISOString(),
        walletAddress: this.walletAddress,
        blockchainVerified: false,
        recoveryMetrics: {
          expectedTimeline: null,
          functionalGoals: null,
          monitoringPlan: null
        }
      };
      
      // Store in history
      this.digitalRxHistory.push(digitalRx);
      
      // Blockchain verification (if CDP agent available)
      if (this.cdpAgent && this.agentKit) {
        try {
          const blockchainTx = await this.processBlockchainTransaction({
            type: 'digital_prescription',
            data: digitalRx
          });
          digitalRx.blockchainVerified = true;
          digitalRx.blockchainTx = blockchainTx.id;
        } catch (error) {
          logger.warn(`Blockchain verification failed for digital Rx: ${error.message}`);
        }
      }
      
      return digitalRx;
    } catch (error) {
      logger.error(`Error generating digital prescription by ${this.name}:`, error);
      throw error;
    }
  }

  async assessRecoveryTimeline(caseData) {
    try {
      const timelinePrompt = `
        RECOVERY TIMELINE ASSESSMENT:
        
        Case Data: ${JSON.stringify(caseData)}
        
        Provide detailed recovery timeline including:
        
        1. ACUTE PHASE (0-2 weeks):
           - Expected symptoms and limitations
           - Key interventions
           - Safety considerations
        
        2. INFLAMMATORY PHASE (2-6 weeks):
           - Healing milestones
           - Activity progression
           - Warning signs
        
        3. PROLIFERATION PHASE (6-12 weeks):
           - Tissue healing markers
           - Functional improvements
           - Therapy advancement
        
        4. MATURATION PHASE (3-6 months):
           - Strength recovery
           - Activity return
           - Performance optimization
        
        5. FUNCTIONAL RESTORATION (6-12 months):
           - Full activity return
           - Long-term maintenance
           - Injury prevention
        
        Include factors that may accelerate or delay each phase.
      `;
      
      const timeline = await this.processMessage(timelinePrompt);
      
      return {
        agent: this.name,
        assessment: timeline,
        caseId: caseData.id || `case_${Date.now()}`,
        confidence: this.getConfidence('timeline_assessment'),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error in recovery timeline assessment:`, error);
      throw error;
    }
  }

  getConfidence(task) {
    const baseConfidence = super.getConfidence(task);
    
    // Adjust confidence based on subspecialty match
    const subspecialtyBonus = this.isSubspecialtyMatch(task) ? 0.2 : 0;
    
    // Recovery-focused bonus
    const recoveryBonus = task.includes('recovery') || task.includes('timeline') ? 0.1 : 0;
    
    return Math.min(baseConfidence + subspecialtyBonus + recoveryBonus, 1.0);
  }

  isSubspecialtyMatch(task) {
    const taskLower = task.toLowerCase();
    const subspecialtyLower = this.subspecialty.toLowerCase();
    
    return taskLower.includes(subspecialtyLower) || 
           subspecialtyLower.includes('general') ||
           taskLower.includes('orthopedic');
  }

  async updateOutcomeTokens(outcome) {
    try {
      // Enhanced token calculation for orthopedic outcomes
      const enhancedOutcome = {
        ...outcome,
        functionalImprovement: outcome.functionalImprovement || false,
        painReduction: outcome.painReduction || 0,
        mobilityImprovement: outcome.mobilityImprovement || 0,
        returnToActivity: outcome.returnToActivity || false,
        patientSatisfaction: outcome.patientSatisfaction || 0
      };
      
      // Additional orthopedic-specific bonuses
      if (enhancedOutcome.painReduction >= 50) enhancedOutcome.mdApproval = true;
      if (enhancedOutcome.mobilityImprovement >= 75) enhancedOutcome.functionalImprovement = true;
      if (enhancedOutcome.returnToActivity) enhancedOutcome.collaborationBonus = true;
      
      // Token rewards are handled by the central TokenManager, not the parallel agent ledger
      return enhancedOutcome;
    } catch (error) {
      logger.error(`Error updating outcome tokens:`, error);
      throw error;
    }
  }
}

export default OrthopedicSpecialist;