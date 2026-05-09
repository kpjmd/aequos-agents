import logger from './logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * PredictionMarket - Inter-agent prediction system for medical outcomes
 * Enables agents to make staked predictions across multiple dimensions with
 * cascading resolution from inter-agent consensus through user follow-up
 */
export class PredictionMarket {
  constructor(tokenManager) {
    this.tokenManager = tokenManager;
    this.predictions = new Map(); // consultationId -> predictions
    this.resolutions = new Map(); // consultationId -> resolution data
    this.agentPerformance = new Map(); // agentId -> performance stats
    this.predictionHistory = [];
  }

  async _getSql() {
    const mod = await import('./db.js');
    return mod.default;
  }

  async loadFromDb() {
    const sql = await this._getSql();
    if (!sql) return;
    try {
      const predRows = await sql`SELECT * FROM predictions`;
      for (const row of predRows) {
        this.predictions.set(row.consultation_id, {
          consultationId: row.consultation_id,
          caseData: row.case_data,
          agentPredictions: row.agent_predictions,
          status: row.status,
          timestamp: row.created_at
        });
      }

      const resRows = await sql`SELECT * FROM prediction_resolutions`;
      for (const row of resRows) {
        this.resolutions.set(row.consultation_id, {
          consultationId: row.consultation_id,
          source: row.source,
          outcomes: row.outcomes,
          agentResults: row.agent_results,
          timestamp: row.timestamp
        });
      }

      const perfRows = await sql`SELECT * FROM agent_performance`;
      for (const row of perfRows) {
        this.agentPerformance.set(row.agent_id, {
          agentId: row.agent_id,
          totalPredictions: row.total_predictions,
          totalStaked: row.total_staked,
          totalWon: row.total_won,
          totalLost: row.total_lost,
          averageAccuracy: row.average_accuracy,
          predictionCount: row.prediction_count,
          dimensionAccuracy: row.dimension_accuracy || {}
        });
      }

      logger.info(`PredictionMarket loaded from DB: ${predRows.length} predictions, ${perfRows.length} performance records`);
    } catch (error) {
      logger.error(`PredictionMarket DB load failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initiate predictions for a consultation
   * Called at consultation start - agents make predictions before seeing outcomes
   * Supports merging: if called multiple times with same consultationId (e.g., fast mode
   * where triage predicts first, then specialists predict in background), predictions are merged
   */
  async initiatePredictions(consultationId, caseData, participatingAgents) {
    try {
      logger.info(`Initiating predictions for consultation: ${consultationId}`);

      // Check if predictions already exist for this consultation (supports fast mode merging)
      let predictions = this.predictions.get(consultationId);

      if (!predictions) {
        predictions = {
          consultationId,
          timestamp: new Date().toISOString(),
          caseData: {
            primaryComplaint: caseData.primaryComplaint,
            painLevel: caseData.painLevel,
            duration: caseData.duration,
            location: caseData.location
          },
          agentPredictions: [],
          status: 'active'
        };
      }

      // Track existing agent IDs to avoid duplicates when merging
      const existingAgentIds = new Set(predictions.agentPredictions.map(p => p.agentId));

      // Each participating agent makes predictions (skip if already exists)
      for (const agent of participatingAgents) {
        if (!existingAgentIds.has(agent.agentId)) {
          const agentPrediction = await this.collectAgentPredictions(
            agent,
            caseData,
            consultationId
          );
          predictions.agentPredictions.push(agentPrediction);
        } else {
          logger.debug(`Skipping duplicate prediction for agent: ${agent.agentId}`);
        }
      }

      this.predictions.set(consultationId, predictions);

      // Persist to DB
      const sql = await this._getSql();
      if (sql) {
        await sql`
          INSERT INTO predictions (consultation_id, case_data, agent_predictions, status, created_at, updated_at)
          VALUES (${consultationId}, ${JSON.stringify(predictions.caseData)}, ${JSON.stringify(predictions.agentPredictions)}, ${predictions.status}, NOW(), NOW())
          ON CONFLICT (consultation_id) DO UPDATE SET
            agent_predictions = EXCLUDED.agent_predictions,
            status = EXCLUDED.status,
            updated_at = NOW()
        `;
      }

      // Count specialists (exclude triage) for MD review recommendation
      const specialistCount = predictions.agentPredictions
        .filter(p => !p.agentType?.includes('triage'))
        .length;

      logger.info(`Collected ${predictions.agentPredictions.length} agent predictions (${specialistCount} specialists)`);

      return {
        consultationId,
        totalPredictions: predictions.agentPredictions.length,
        totalStaked: this.calculateTotalStake(predictions),
        timestamp: predictions.timestamp,
        specialistCount,
        recommendMDReview: specialistCount >= 4
      };
    } catch (error) {
      logger.error(`Error initiating predictions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Collect predictions from individual agent
   * Agents predict outcomes across multiple dimensions
   */
  async collectAgentPredictions(agent, caseData, consultationId) {
    const agentId = agent.agentId;
    const agentType = agent.agentType || agent.name;
    // Get balance from tokenManager, not from agent object
    const agentBalance = this.tokenManager ? this.tokenManager.getAgentBalance(agentId) : null;
    const currentBalance = agentBalance ? agentBalance.tokenBalance : 0;

    // Generate predictions based on agent specialty
    const predictions = this.generateDimensionPredictions(agentType, caseData);

    // Calculate stakes with non-linear scaling
    const stakedPredictions = predictions.map(pred => ({
      ...pred,
      stake: this.calculateStake(pred.confidence, currentBalance),
      stakePercentage: this.calculateStakePercentage(pred.confidence)
    }));

    const totalStake = stakedPredictions.reduce((sum, p) => sum + p.stake, 0);

    return {
      predictionId: uuidv4(),
      agentId,
      agentName: agent.name,
      agentType,
      consultationId,
      predictions: stakedPredictions,
      totalStake,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate dimension-specific predictions based on agent specialty
   */
  generateDimensionPredictions(agentType, caseData) {
    const predictions = [];

    // All agents predict basic outcomes
    predictions.push({
      dimension: 'user_satisfaction',
      type: 'binary',
      value: true, // Will user be satisfied?
      confidence: 0.7,
      rationale: 'Based on case complexity and typical outcomes'
    });

    // Specialist-specific predictions
    if (agentType.includes('pain') || agentType.includes('whisperer')) {
      predictions.push({
        dimension: 'pain_reduction_day7',
        type: 'range',
        value: caseData.painLevel ? Math.max(0, caseData.painLevel - 3) : 4,
        range: [0, 10],
        confidence: 0.75,
        rationale: 'Pain trajectory prediction based on intervention'
      });

      predictions.push({
        dimension: 'pain_reduction_percentage',
        type: 'range',
        value: 40,
        range: [0, 100],
        confidence: 0.7,
        rationale: 'Expected pain reduction at 2 weeks'
      });
    }

    if (agentType.includes('movement') || agentType.includes('detective')) {
      predictions.push({
        dimension: 'mobility_improvement',
        type: 'range',
        value: 60,
        range: [0, 100],
        confidence: 0.65,
        rationale: 'Movement pattern correction success rate'
      });

      predictions.push({
        dimension: 'rom_restoration_day14',
        type: 'range',
        value: 80,
        range: [0, 100],
        confidence: 0.7,
        rationale: 'Range of motion restoration percentage'
      });
    }

    if (agentType.includes('strength') || agentType.includes('sage')) {
      predictions.push({
        dimension: 'functional_restoration',
        type: 'range',
        value: 70,
        range: [0, 100],
        confidence: 0.75,
        rationale: 'Return to functional activities'
      });

      predictions.push({
        dimension: 'return_to_activity_timeline',
        type: 'timeline',
        value: 21, // days
        confidence: 0.65,
        rationale: 'Expected timeline for activity return'
      });
    }

    if (agentType.includes('mind') || agentType.includes('mender')) {
      predictions.push({
        dimension: 'adherence_rate',
        type: 'range',
        value: 75,
        range: [0, 100],
        confidence: 0.7,
        rationale: 'Treatment adherence prediction'
      });

      predictions.push({
        dimension: 'psychological_improvement',
        type: 'range',
        value: 65,
        range: [0, 100],
        confidence: 0.6,
        rationale: 'Fear-avoidance and anxiety reduction'
      });
    }

    if (agentType.includes('triage')) {
      predictions.push({
        dimension: 'md_approval',
        type: 'binary',
        value: true,
        confidence: 0.8,
        rationale: 'Clinical assessment quality prediction'
      });

      predictions.push({
        dimension: 'recovery_phase_transition',
        type: 'timeline',
        value: 14, // days to next phase
        confidence: 0.7,
        rationale: 'Recovery phase progression timing'
      });
    }

    return predictions;
  }

  /**
   * Calculate stake amount with non-linear scaling
   * Higher confidence requires exponentially more tokens
   */
  calculateStake(confidence, agentBalance) {
    // Exponential staking curve: stake = base * (confidence ^ 3)
    const baseStake = 5;
    const maxStake = Math.min(agentBalance * 0.2, 50); // Max 20% of balance or 50 tokens

    // Non-linear scaling: confidence^3 creates exponential cost
    const stake = baseStake * Math.pow(confidence, 3);

    return Math.min(Math.round(stake), maxStake);
  }

  /**
   * Calculate stake percentage for display
   */
  calculateStakePercentage(confidence) {
    return Math.round(confidence * 100);
  }

  /**
   * Check if consultation should be recommended for MD review
   * Consultations with 4+ specialists indicate higher complexity/quality
   */
  shouldRecommendMDReview(consultationId) {
    const predictions = this.predictions.get(consultationId);
    if (!predictions) return false;

    // Count distinct specialist types (exclude triage)
    const specialistCount = predictions.agentPredictions
      .filter(p => !p.agentType?.includes('triage'))
      .length;

    return specialistCount >= 4;
  }

  /**
   * Get consultation metadata including participating agents and MD review recommendation
   */
  getConsultationMetadata(consultationId) {
    const predictions = this.predictions.get(consultationId);
    if (!predictions) return null;

    return {
      consultationId,
      totalAgents: predictions.agentPredictions.length,
      participatingAgents: predictions.agentPredictions.map(p => ({
        agentId: p.agentId,
        agentName: p.agentName,
        agentType: p.agentType
      })),
      recommendMDReview: this.shouldRecommendMDReview(consultationId),
      status: predictions.status,
      timestamp: predictions.timestamp
    };
  }

  /**
   * Resolve predictions with cascading resolution sources
   * Resolution cascade: inter-agent → MD review → user feedback → follow-up
   */
  async resolvePredictions(consultationId, resolutionData) {
    try {
      logger.info(`Resolving predictions for consultation: ${consultationId}`);

      const predictions = this.predictions.get(consultationId);
      if (!predictions) {
        logger.warn(`No predictions found for consultation: ${consultationId}`);
        return null;
      }

      // Determine resolution source and weight
      const { source, data, timestamp } = this.determineResolutionSource(resolutionData);

      const resolution = {
        consultationId,
        source, // 'inter_agent', 'md_review', 'user_modal', 'follow_up'
        timestamp,
        outcomes: data,
        agentResults: []
      };

      // Score each agent's predictions
      for (const agentPrediction of predictions.agentPredictions) {
        const result = await this.scoreAgentPredictions(
          agentPrediction,
          data,
          source
        );
        resolution.agentResults.push(result);

        // Distribute rewards/penalties
        await this.distributeTokens(result, agentPrediction.agentId);

        // Update agent performance stats
        this.updateAgentPerformance(agentPrediction.agentId, result);
      }

      this.resolutions.set(consultationId, resolution);
      predictions.status = 'resolved';

      // Persist resolution + updated prediction status
      const sql = await this._getSql();
      if (sql) {
        await sql`
          INSERT INTO prediction_resolutions (consultation_id, source, outcomes, agent_results, timestamp)
          VALUES (${consultationId}, ${source}, ${JSON.stringify(resolution.outcomes)}, ${JSON.stringify(resolution.agentResults)}, ${timestamp})
          ON CONFLICT (consultation_id, source) DO NOTHING
        `;
        await sql`
          UPDATE predictions SET status = 'resolved', updated_at = NOW()
          WHERE consultation_id = ${consultationId}
        `;
      }

      // Record in history
      this.predictionHistory.push({
        consultationId,
        source,
        timestamp,
        totalAgents: predictions.agentPredictions.length,
        averageAccuracy: this.calculateAverageAccuracy(resolution.agentResults)
      });

      logger.info(`Predictions resolved: ${resolution.agentResults.length} agents scored`);

      return resolution;
    } catch (error) {
      logger.error(`Error resolving predictions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Determine resolution source with cascading priority
   */
  determineResolutionSource(resolutionData) {
    // Priority: follow_up > user_modal > md_review > inter_agent
    if (resolutionData.followUp) {
      return {
        source: 'follow_up',
        data: resolutionData.followUp,
        timestamp: resolutionData.followUp.timestamp || new Date().toISOString()
      };
    }

    if (resolutionData.userModal) {
      return {
        source: 'user_modal',
        data: resolutionData.userModal,
        timestamp: resolutionData.userModal.timestamp || new Date().toISOString()
      };
    }

    if (resolutionData.mdReview) {
      return {
        source: 'md_review',
        data: resolutionData.mdReview,
        timestamp: resolutionData.mdReview.timestamp || new Date().toISOString()
      };
    }

    if (resolutionData.interAgent) {
      return {
        source: 'inter_agent',
        data: resolutionData.interAgent,
        timestamp: resolutionData.interAgent.timestamp || new Date().toISOString()
      };
    }

    // Fallback to inter-agent consensus (always available)
    return {
      source: 'inter_agent',
      data: resolutionData,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Score agent predictions with partial credit
   */
  async scoreAgentPredictions(agentPrediction, actualOutcomes, resolutionSource) {
    const results = {
      agentId: agentPrediction.agentId,
      agentName: agentPrediction.agentName,
      predictionScores: [],
      totalStaked: agentPrediction.totalStake,
      tokensWon: 0,
      tokensLost: 0,
      netChange: 0,
      accuracy: 0
    };

    // Score each dimension prediction
    for (const prediction of agentPrediction.predictions) {
      const score = this.scoreSinglePrediction(
        prediction,
        actualOutcomes,
        resolutionSource
      );
      results.predictionScores.push(score);
    }

    // Calculate aggregate accuracy
    const accuracyScores = results.predictionScores.map(s => s.accuracy);
    results.accuracy = accuracyScores.length > 0
      ? accuracyScores.reduce((sum, a) => sum + a, 0) / accuracyScores.length
      : 0;

    // Calculate token rewards/penalties
    const totalStake = agentPrediction.totalStake;
    results.tokensWon = Math.round(totalStake * results.accuracy * 2); // Up to 2x return
    results.tokensLost = Math.round(totalStake * (1 - results.accuracy));
    results.netChange = results.tokensWon - results.tokensLost;

    return results;
  }

  /**
   * Score individual prediction dimension with partial credit
   */
  scoreSinglePrediction(prediction, actualOutcomes, resolutionSource) {
    const dimension = prediction.dimension;
    const actualValue = actualOutcomes[dimension];

    // If dimension not available in outcomes, return neutral score
    if (actualValue === undefined || actualValue === null) {
      return {
        dimension,
        type: prediction.type,
        predicted: prediction.value,
        actual: null,
        accuracy: 0.5, // Neutral - no penalty or reward
        partialCredit: true,
        resolutionSource
      };
    }

    let accuracy = 0;

    if (prediction.type === 'binary') {
      // Binary: exact match or miss
      accuracy = prediction.value === actualValue ? 1.0 : 0.0;
    } else if (prediction.type === 'range') {
      // Range: partial credit based on distance
      const predicted = prediction.value;
      const actual = actualValue;
      const rangeSize = prediction.range ? prediction.range[1] - prediction.range[0] : 100;

      const error = Math.abs(predicted - actual);
      const normalizedError = error / rangeSize;

      // Accuracy decreases linearly with error
      accuracy = Math.max(0, 1 - (normalizedError * 2));
    } else if (prediction.type === 'timeline') {
      // Timeline: partial credit for being close
      const predicted = prediction.value;
      const actual = actualValue;
      const error = Math.abs(predicted - actual);

      // Accuracy decreases with timeline error (within 3 days is still good)
      if (error === 0) accuracy = 1.0;
      else if (error <= 3) accuracy = 0.8;
      else if (error <= 7) accuracy = 0.6;
      else if (error <= 14) accuracy = 0.4;
      else accuracy = 0.2;
    }

    return {
      dimension,
      type: prediction.type,
      predicted: prediction.value,
      actual: actualValue,
      accuracy,
      confidence: prediction.confidence,
      stake: prediction.stake,
      resolutionSource
    };
  }

  /**
   * Distribute tokens based on prediction results
   */
  async distributeTokens(result, agentId) {
    try {
      const netChange = result.netChange;

      if (netChange > 0) {
        // Agent won tokens
        await this.tokenManager.distributeTokenReward(agentId, {
          success: true,
          predictionAccuracy: result.accuracy,
          predictionBonus: true
        }, {
          experienceMultiplier: 1.0,
          qualityMultiplier: result.accuracy
        });
        logger.info(`Agent ${agentId} won ${netChange} tokens from predictions`);
      } else if (netChange < 0) {
        // Agent lost tokens — route through applyPenalty for proper accounting
        await this.tokenManager.applyPenalty(agentId, Math.abs(netChange));
        logger.info(`Agent ${agentId} lost ${Math.abs(netChange)} tokens from predictions`);
      }
    } catch (error) {
      logger.error(`Error distributing prediction tokens: ${error.message}`);
    }
  }

  /**
   * Update agent performance statistics
   */
  async updateAgentPerformance(agentId, result) {
    if (!this.agentPerformance.has(agentId)) {
      this.agentPerformance.set(agentId, {
        agentId,
        totalPredictions: 0,
        totalStaked: 0,
        totalWon: 0,
        totalLost: 0,
        averageAccuracy: 0,
        predictionCount: 0,
        dimensionAccuracy: {}
      });
    }

    const perf = this.agentPerformance.get(agentId);
    perf.totalPredictions += result.predictionScores.length;
    perf.totalStaked += result.totalStaked;
    perf.totalWon += result.tokensWon;
    perf.totalLost += result.tokensLost;
    perf.predictionCount += 1;

    perf.averageAccuracy = (
      (perf.averageAccuracy * (perf.predictionCount - 1)) + result.accuracy
    ) / perf.predictionCount;

    for (const score of result.predictionScores) {
      if (!perf.dimensionAccuracy[score.dimension]) {
        perf.dimensionAccuracy[score.dimension] = {
          count: 0,
          totalAccuracy: 0,
          averageAccuracy: 0
        };
      }
      const dimPerf = perf.dimensionAccuracy[score.dimension];
      dimPerf.count += 1;
      dimPerf.totalAccuracy += score.accuracy;
      dimPerf.averageAccuracy = dimPerf.totalAccuracy / dimPerf.count;
    }

    // Persist to DB
    const sql = await this._getSql();
    if (sql) {
      await sql`
        INSERT INTO agent_performance (agent_id, total_predictions, total_staked, total_won, total_lost, average_accuracy, prediction_count, dimension_accuracy, last_updated)
        VALUES (${agentId}, ${perf.totalPredictions}, ${perf.totalStaked}, ${perf.totalWon}, ${perf.totalLost}, ${perf.averageAccuracy}, ${perf.predictionCount}, ${JSON.stringify(perf.dimensionAccuracy)}, NOW())
        ON CONFLICT (agent_id) DO UPDATE SET
          total_predictions = EXCLUDED.total_predictions,
          total_staked = EXCLUDED.total_staked,
          total_won = EXCLUDED.total_won,
          total_lost = EXCLUDED.total_lost,
          average_accuracy = EXCLUDED.average_accuracy,
          prediction_count = EXCLUDED.prediction_count,
          dimension_accuracy = EXCLUDED.dimension_accuracy,
          last_updated = NOW()
      `;
    }
  }

  /**
   * Calculate total stake across all predictions
   */
  calculateTotalStake(predictions) {
    return predictions.agentPredictions.reduce(
      (sum, ap) => sum + ap.totalStake,
      0
    );
  }

  /**
   * Calculate average accuracy across all agents
   */
  calculateAverageAccuracy(agentResults) {
    if (agentResults.length === 0) return 0;
    const totalAccuracy = agentResults.reduce((sum, r) => sum + r.accuracy, 0);
    return totalAccuracy / agentResults.length;
  }

  /**
   * Get agent prediction performance stats
   */
  getAgentPerformance(agentId) {
    return this.agentPerformance.get(agentId) || null;
  }

  /**
   * Get prediction market statistics
   */
  getMarketStatistics() {
    const allPerformance = Array.from(this.agentPerformance.values());

    return {
      totalConsultations: this.predictions.size,
      resolvedConsultations: this.resolutions.size,
      totalAgents: this.agentPerformance.size,
      totalPredictions: allPerformance.reduce((sum, p) => sum + p.totalPredictions, 0),
      totalStaked: allPerformance.reduce((sum, p) => sum + p.totalStaked, 0),
      averageMarketAccuracy: allPerformance.length > 0
        ? allPerformance.reduce((sum, p) => sum + p.averageAccuracy, 0) / allPerformance.length
        : 0,
      topPerformers: this.getTopPerformers(5),
      recentResolutions: this.predictionHistory.slice(-10)
    };
  }

  /**
   * Get top performing agents
   */
  getTopPerformers(limit = 5) {
    const allPerformance = Array.from(this.agentPerformance.values());
    return allPerformance
      .sort((a, b) => b.averageAccuracy - a.averageAccuracy)
      .slice(0, limit)
      .map(p => ({
        agentId: p.agentId,
        averageAccuracy: Math.round(p.averageAccuracy * 100),
        totalPredictions: p.totalPredictions,
        netTokens: p.totalWon - p.totalLost
      }));
  }

  /**
   * Get predictions for a consultation
   */
  getPredictions(consultationId) {
    return this.predictions.get(consultationId) || null;
  }

  /**
   * Get resolution for a consultation
   */
  getResolution(consultationId) {
    return this.resolutions.get(consultationId) || null;
  }
}

export default PredictionMarket;
