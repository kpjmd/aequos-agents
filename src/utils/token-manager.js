import { ethers } from 'ethers';
import logger from './logger.js';
import { agentConfig } from '../config/agent-config.js';
import BlockchainUtils from './blockchain-utils.js';

export const RESEARCH_TOKEN_EVENTS = {
  // Base participation
  LITERATURE_SEARCH_COMPLETED: 1,
  RELEVANT_STUDIES_FOUND: 3,
  HIGH_IMPACT_JOURNAL: 5,
  RECENT_EVIDENCE: 2,
  MULTIPLE_STUDY_TYPES: 3,

  // User engagement
  PREMIUM_ACCESS: 2,

  // Validation
  MD_CONFIRMS_HELPFUL: 8,
  USER_CLICKED_CITATIONS: 1,

  // Penalties
  LOW_RELEVANCE: -2,
  NO_STUDIES_FOUND: 0,
  API_ERROR: 0,
};

export class TokenManager {
  constructor() {
    this.tokenTransactions = new Map();
    this.agentBalances = new Map();
    this.rewardRules = this.initializeRewardRules();
    this.distributionHistory = [];
    this.blockchainUtils = new BlockchainUtils();
    this.tokenContractAddress = null;
    this.networkStats = {
      totalTokensIssued: 0,
      totalRewardsDistributed: 0,
      successfulOutcomes: 0,
      networkUtilization: 0
    };
  }

  initializeRewardRules() {
    return {
      // Base rewards
      base_consultation: 1,
      successful_analysis: 5,
      patient_satisfaction_high: 10,
      
      // Medical outcome rewards
      pain_reduction_50_percent: 15,
      pain_reduction_75_percent: 25,
      functional_improvement: 20,
      return_to_activity: 30,
      md_approval: 15,
      
      // Collaboration bonuses
      multi_specialist_consultation: 5,
      successful_coordination: 10,
      knowledge_sharing: 3,
      
      // Innovation and excellence
      novel_approach: 20,
      exceptional_outcome: 50,
      zero_complications: 15,
      
      // Speed and efficiency
      rapid_response: 5,
      timeline_adherence: 10,
      efficient_resource_use: 8,
      
      // Education and engagement
      patient_education_effective: 8,
      adherence_improvement: 12,
      self_advocacy_development: 10,
      
      // Risk mitigation
      prevented_complications: 25,
      successful_risk_mitigation: 15,
      early_intervention: 10,

      // Research and evidence curation
      literature_search_completed: 1,
      relevant_studies_found: 3,
      high_impact_journal: 5,
      recent_evidence: 2,
      multiple_study_types: 3
    };
  }

  async initializeAgentWallet(agent) {
    try {
      logger.info(`Initializing wallet for agent: ${agent.name}`);
      
      if (!agent.walletAddress) {
        throw new Error(`Agent ${agent.name} does not have a wallet address`);
      }
      
      // Initialize balance tracking
      this.agentBalances.set(agent.agentId, {
        agentId: agent.agentId,
        name: agent.name,
        walletAddress: agent.walletAddress,
        tokenBalance: agent.tokenBalance || 0,
        totalEarned: 0,
        lastUpdated: new Date().toISOString(),
        transactionCount: 0
      });
      
      logger.info(`Wallet initialized for ${agent.name} at address: ${agent.walletAddress}`);
      
      return {
        agentId: agent.agentId,
        walletAddress: agent.walletAddress,
        initialBalance: agent.tokenBalance || 0
      };
    } catch (error) {
      logger.error(`Error initializing agent wallet: ${error.message}`);
      throw error;
    }
  }

  async distributeTokenReward(agentId, outcome, additionalData = {}) {
    try {
      logger.info(`Distributing token reward for agent: ${agentId}`);
      
      const agentBalance = this.agentBalances.get(agentId);
      if (!agentBalance) {
        throw new Error(`Agent balance not found for agentId: ${agentId}`);
      }
      
      // Calculate reward amount
      const rewardAmount = this.calculateRewardAmount(outcome, additionalData);
      
      if (rewardAmount <= 0) {
        logger.info(`No reward calculated for agent ${agentId}`);
        return null;
      }
      
      // Create transaction record
      const transaction = {
        id: `txn_${Date.now()}_${agentId}`,
        agentId,
        type: 'reward_distribution',
        amount: rewardAmount,
        outcome,
        additionalData,
        track: additionalData.track || 'clinical',
        timestamp: new Date().toISOString(),
        blockchainTx: null,
        status: 'pending'
      };
      
      // Update agent balance
      agentBalance.tokenBalance += rewardAmount;
      agentBalance.totalEarned += rewardAmount;
      agentBalance.lastUpdated = new Date().toISOString();
      agentBalance.transactionCount += 1;
      
      // Store transaction
      this.tokenTransactions.set(transaction.id, transaction);
      
      // Try to process blockchain transaction if available
      try {
        const blockchainTx = await this.processBlockchainReward(
          agentBalance.walletAddress,
          rewardAmount,
          transaction.id,
          additionalData.walletProvider // Pass wallet provider if available
        );
        
        transaction.blockchainTx = blockchainTx.hash;
        transaction.status = blockchainTx.isMock ? 'simulated' : 'confirmed';
      } catch (blockchainError) {
        logger.warn(`Blockchain transaction failed, keeping local record: ${blockchainError.message}`);
        transaction.status = 'local_only';
      }
      
      // Update network statistics
      this.updateNetworkStats(rewardAmount, outcome);
      
      // Record distribution history
      this.distributionHistory.push({
        agentId,
        agentName: agentBalance.name,
        amount: rewardAmount,
        reason: this.summarizeOutcome(outcome),
        track: additionalData.track || 'clinical',
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Distributed ${rewardAmount} tokens to agent ${agentId} for: ${this.summarizeOutcome(outcome)}`);
      
      return {
        transactionId: transaction.id,
        agentId,
        amount: rewardAmount,
        newBalance: agentBalance.tokenBalance,
        blockchainTx: transaction.blockchainTx,
        status: transaction.status
      };
    } catch (error) {
      logger.error(`Error distributing token reward: ${error.message}`);
      throw error;
    }
  }

  calculateRewardAmount(outcome, additionalData = {}) {
    let totalReward = 0;
    
    // Base reward for participation
    totalReward += this.rewardRules.base_consultation;
    
    // Outcome-based rewards
    if (outcome.success) {
      totalReward += this.rewardRules.successful_analysis;
    }
    
    if (outcome.mdApproval) {
      totalReward += this.rewardRules.md_approval;
    }
    
    if (outcome.functionalImprovement) {
      totalReward += this.rewardRules.functional_improvement;
    }
    
    if (outcome.returnToActivity) {
      totalReward += this.rewardRules.return_to_activity;
    }
    
    // Pain reduction rewards
    if (outcome.painReduction >= 75) {
      totalReward += this.rewardRules.pain_reduction_75_percent;
    } else if (outcome.painReduction >= 50) {
      totalReward += this.rewardRules.pain_reduction_50_percent;
    }
    
    // Patient satisfaction rewards
    if (outcome.userSatisfaction >= 8) {
      totalReward += this.rewardRules.patient_satisfaction_high;
    }
    
    // Collaboration bonuses
    if (outcome.collaborationBonus) {
      totalReward += this.rewardRules.multi_specialist_consultation;
    }
    
    if (outcome.coordinationSuccess) {
      totalReward += this.rewardRules.successful_coordination;
    }
    
    // Speed and efficiency bonuses
    if (outcome.speedOfResolution && outcome.speedOfResolution <= 5) {
      totalReward += this.rewardRules.rapid_response;
    }
    
    if (outcome.timelineAdherence) {
      totalReward += this.rewardRules.timeline_adherence;
    }
    
    // Innovation and excellence
    if (outcome.novelApproach) {
      totalReward += this.rewardRules.novel_approach;
    }
    
    if (outcome.exceptionalOutcome) {
      totalReward += this.rewardRules.exceptional_outcome;
    }
    
    if (outcome.zeroComplications) {
      totalReward += this.rewardRules.zero_complications;
    }
    
    // Education and engagement
    if (outcome.effectiveEducation) {
      totalReward += this.rewardRules.patient_education_effective;
    }
    
    if (outcome.adherenceImprovement >= 90) {
      totalReward += this.rewardRules.adherence_improvement;
    }
    
    // Risk mitigation
    if (outcome.preventedComplications) {
      totalReward += this.rewardRules.prevented_complications;
    }
    
    if (outcome.riskMitigation) {
      totalReward += this.rewardRules.successful_risk_mitigation;
    }

    // Research and evidence curation rewards
    if (outcome.literatureSearchCompleted) {
      totalReward += this.rewardRules.literature_search_completed;
    }

    if (outcome.relevantStudiesFound) {
      totalReward += this.rewardRules.relevant_studies_found;
    }

    if (outcome.highImpactJournal) {
      totalReward += this.rewardRules.high_impact_journal;
    }

    if (outcome.recentEvidence) {
      totalReward += this.rewardRules.recent_evidence;
    }

    if (outcome.multipleStudyTypes) {
      totalReward += this.rewardRules.multiple_study_types;
    }

    // Additional multipliers
    const experienceMultiplier = additionalData.experienceMultiplier || 1.0;
    const qualityMultiplier = additionalData.qualityMultiplier || 1.0;
    
    totalReward = Math.round(totalReward * experienceMultiplier * qualityMultiplier);
    
    return Math.max(0, totalReward);
  }

  async initializeTokenContract(walletProvider) {
    try {
      if (!walletProvider) {
        logger.warn('No wallet provider available for token contract initialization');
        return null;
      }
      
      // Initialize blockchain utilities
      await this.blockchainUtils.initialize();
      
      // Create or get existing token contract
      const tokenContract = await this.blockchainUtils.createAgentTokenContract(walletProvider);
      this.tokenContractAddress = tokenContract.tokenAddress;
      
      logger.info(`Token contract initialized at: ${this.tokenContractAddress}`);
      return tokenContract;
    } catch (error) {
      logger.error(`Token contract initialization failed: ${error.message}`);
      return null;
    }
  }

  async processBlockchainReward(walletAddress, amount, transactionId, walletProvider) {
    try {
      logger.info(`Processing blockchain reward: ${amount} tokens to ${walletAddress}`);

      // Check if blockchain is disabled or in mock mode
      if (!agentConfig.blockchain.enabled || agentConfig.blockchain.mockResponses) {
        logger.debug('Mock blockchain mode enabled, returning simulated transaction');
        return this.createSimulatedTransaction(walletAddress, amount);
      }

      if (!this.tokenContractAddress) {
        logger.warn('Token contract address not set, falling back to simulated transaction');
        return this.createSimulatedTransaction(walletAddress, amount);
      }

      if (!walletProvider) {
        logger.warn('Wallet provider not available for real minting, falling back to simulated transaction');
        return this.createSimulatedTransaction(walletAddress, amount);
      }

      // Mint tokens to the agent wallet on real blockchain
      const mintResult = await this.blockchainUtils.mintTokensToAgent(
        this.tokenContractAddress,
        walletAddress,
        amount,
        walletProvider
      );

      logger.info(`Blockchain reward processed: ${mintResult.transactionHash || 'simulated'}`);

      return {
        hash: mintResult.transactionHash,
        from: '0x0000000000000000000000000000000000000000', // Minting from zero address
        to: walletAddress,
        value: ethers.parseEther(amount.toString()),
        gasUsed: mintResult.gasUsed || 21000,
        blockNumber: mintResult.blockNumber || 0,
        timestamp: mintResult.timestamp,
        isMock: mintResult.isMock !== false // Default to true if not explicitly false
      };
    } catch (error) {
      logger.error(`Blockchain reward processing failed: ${error.message}`);
      // Fall back to simulated transaction
      return this.createSimulatedTransaction(walletAddress, amount);
    }
  }
  
  createSimulatedTransaction(walletAddress, amount) {
    const simulatedTx = {
      hash: `0x${Math.random().toString(16).substring(2, 66)}`,
      from: '0x0000000000000000000000000000000000000000',
      to: walletAddress,
      value: ethers.parseEther(amount.toString()),
      gasUsed: 21000,
      blockNumber: Math.floor(Math.random() * 1000000),
      timestamp: new Date().toISOString(),
      isMock: true
    };
    
    logger.info(`Simulated blockchain transaction: ${simulatedTx.hash}`);
    return simulatedTx;
  }

  async transferTokensBetweenAgents(fromAgentId, toAgentId, amount, reason) {
    try {
      logger.info(`Transferring ${amount} tokens from ${fromAgentId} to ${toAgentId}`);
      
      const fromBalance = this.agentBalances.get(fromAgentId);
      const toBalance = this.agentBalances.get(toAgentId);
      
      if (!fromBalance || !toBalance) {
        throw new Error('One or both agents not found');
      }
      
      if (fromBalance.tokenBalance < amount) {
        throw new Error('Insufficient token balance');
      }
      
      // Create transfer transaction
      const transferTx = {
        id: `transfer_${Date.now()}_${fromAgentId}_${toAgentId}`,
        type: 'agent_transfer',
        fromAgentId,
        toAgentId,
        amount,
        reason,
        timestamp: new Date().toISOString(),
        status: 'completed'
      };
      
      // Update balances
      fromBalance.tokenBalance -= amount;
      fromBalance.lastUpdated = new Date().toISOString();
      fromBalance.transactionCount += 1;
      
      toBalance.tokenBalance += amount;
      toBalance.lastUpdated = new Date().toISOString();
      toBalance.transactionCount += 1;
      
      // Store transaction
      this.tokenTransactions.set(transferTx.id, transferTx);
      
      logger.info(`Transfer completed: ${amount} tokens from ${fromBalance.name} to ${toBalance.name}`);
      
      return transferTx;
    } catch (error) {
      logger.error(`Error transferring tokens: ${error.message}`);
      throw error;
    }
  }

  async createIncentivePool(poolName, totalTokens, criteria) {
    try {
      const poolId = `pool_${Date.now()}_${poolName.replace(/\s+/g, '_')}`;
      
      const incentivePool = {
        id: poolId,
        name: poolName,
        totalTokens,
        remainingTokens: totalTokens,
        criteria,
        participants: new Set(),
        distributions: [],
        createdAt: new Date().toISOString(),
        status: 'active'
      };
      
      // Store pool
      if (!this.incentivePools) {
        this.incentivePools = new Map();
      }
      this.incentivePools.set(poolId, incentivePool);
      
      logger.info(`Created incentive pool: ${poolName} with ${totalTokens} tokens`);
      
      return incentivePool;
    } catch (error) {
      logger.error(`Error creating incentive pool: ${error.message}`);
      throw error;
    }
  }

  updateNetworkStats(rewardAmount, outcome) {
    this.networkStats.totalTokensIssued += rewardAmount;
    this.networkStats.totalRewardsDistributed += 1;
    
    if (outcome.success) {
      this.networkStats.successfulOutcomes += 1;
    }
    
    // Calculate network utilization
    const totalAgents = this.agentBalances.size;
    const activeAgents = Array.from(this.agentBalances.values())
      .filter(balance => balance.transactionCount > 0).length;
    
    this.networkStats.networkUtilization = totalAgents > 0 ? (activeAgents / totalAgents) * 100 : 0;
  }

  summarizeOutcome(outcome) {
    const reasons = [];
    
    if (outcome.success) reasons.push('successful_outcome');
    if (outcome.mdApproval) reasons.push('md_approved');
    if (outcome.functionalImprovement) reasons.push('functional_improvement');
    if (outcome.painReduction >= 50) reasons.push(`pain_reduced_${outcome.painReduction}%`);
    if (outcome.userSatisfaction >= 8) reasons.push('high_satisfaction');
    if (outcome.collaborationBonus) reasons.push('collaboration');
    
    return reasons.length > 0 ? reasons.join(', ') : 'participation';
  }

  getAgentBalance(agentId) {
    return this.agentBalances.get(agentId) || null;
  }

  getAgentTransactions(agentId) {
    return Array.from(this.tokenTransactions.values())
      .filter(tx => tx.agentId === agentId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  getNetworkStatistics() {
    const balances = Array.from(this.agentBalances.values());
    
    return {
      ...this.networkStats,
      totalAgents: balances.length,
      totalTokenBalance: balances.reduce((sum, b) => sum + b.tokenBalance, 0),
      averageBalance: balances.length > 0 ? 
        balances.reduce((sum, b) => sum + b.tokenBalance, 0) / balances.length : 0,
      totalTransactions: this.tokenTransactions.size,
      topPerformers: this.getTopPerformers(5),
      recentDistributions: this.distributionHistory.slice(-10)
    };
  }

  getTopPerformers(limit = 5) {
    return Array.from(this.agentBalances.values())
      .sort((a, b) => b.totalEarned - a.totalEarned)
      .slice(0, limit)
      .map(balance => ({
        agentId: balance.agentId,
        name: balance.name,
        totalEarned: balance.totalEarned,
        currentBalance: balance.tokenBalance,
        transactionCount: balance.transactionCount
      }));
  }

  getRewardRulesSummary() {
    return {
      totalRules: Object.keys(this.rewardRules).length,
      categories: {
        base: Object.keys(this.rewardRules).filter(k => k.includes('base')).length,
        medical: Object.keys(this.rewardRules).filter(k => k.includes('pain') || k.includes('functional')).length,
        collaboration: Object.keys(this.rewardRules).filter(k => k.includes('collaboration') || k.includes('coordination')).length,
        innovation: Object.keys(this.rewardRules).filter(k => k.includes('novel') || k.includes('exceptional')).length,
        efficiency: Object.keys(this.rewardRules).filter(k => k.includes('speed') || k.includes('timeline')).length
      },
      rules: this.rewardRules
    };
  }

  // Audit and reporting methods
  generateTokenAuditReport() {
    const transactions = Array.from(this.tokenTransactions.values());
    const balances = Array.from(this.agentBalances.values());
    
    const totalIssued = transactions
      .filter(tx => tx.type === 'reward_distribution')
      .reduce((sum, tx) => sum + tx.amount, 0);
    
    const totalCirculating = balances.reduce((sum, b) => sum + b.tokenBalance, 0);
    
    return {
      reportDate: new Date().toISOString(),
      totalTokensIssued: totalIssued,
      totalCirculating,
      totalTransactions: transactions.length,
      agentCount: balances.length,
      averageBalance: balances.length > 0 ? totalCirculating / balances.length : 0,
      transactionsByType: this.groupTransactionsByType(transactions),
      balanceDistribution: this.analyzeBalanceDistribution(balances),
      integrityCheck: totalIssued === totalCirculating
    };
  }

  groupTransactionsByType(transactions) {
    const grouped = {};
    transactions.forEach(tx => {
      grouped[tx.type] = (grouped[tx.type] || 0) + 1;
    });
    return grouped;
  }

  analyzeBalanceDistribution(balances) {
    const sorted = balances.map(b => b.tokenBalance).sort((a, b) => a - b);
    const len = sorted.length;
    
    return {
      min: sorted[0] || 0,
      max: sorted[len - 1] || 0,
      median: len > 0 ? sorted[Math.floor(len / 2)] : 0,
      q1: len > 0 ? sorted[Math.floor(len * 0.25)] : 0,
      q3: len > 0 ? sorted[Math.floor(len * 0.75)] : 0
    };
  }
}

export default TokenManager;