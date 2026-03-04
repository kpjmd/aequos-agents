import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock ethers to avoid actual blockchain calls in tests
jest.unstable_mockModule('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getNetwork: jest.fn().mockResolvedValue({ name: 'base-sepolia', chainId: 84532n }),
      getBalance: jest.fn().mockResolvedValue('1000000000000000000'), // 1 ETH in wei
      getBlockNumber: jest.fn().mockResolvedValue(12345),
      getFeeData: jest.fn().mockResolvedValue({
        gasPrice: '20000000000', // 20 gwei
        maxFeePerGas: '30000000000',
        maxPriorityFeePerGas: '2000000000'
      }),
      estimateGas: jest.fn().mockResolvedValue('21000'),
      getTransaction: jest.fn().mockResolvedValue({
        hash: '0x123...',
        timestamp: new Date().toISOString()
      }),
      getTransactionReceipt: jest.fn().mockResolvedValue({
        status: 1,
        gasUsed: '21000',
        blockNumber: 12345
      })
    })),
    Wallet: jest.fn().mockImplementation((privateKey, provider) => ({
      address: '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c',
      privateKey: privateKey,
      sendTransaction: jest.fn().mockResolvedValue({
        hash: '0x' + Math.random().toString(16).substring(2, 66),
        wait: jest.fn().mockResolvedValue({
          status: 1,
          gasUsed: '21000',
          blockNumber: 12346
        })
      })
    })),
    ContractFactory: jest.fn().mockImplementation(() => ({
      deploy: jest.fn().mockResolvedValue({
        waitForDeployment: jest.fn().mockResolvedValue(),
        getAddress: jest.fn().mockResolvedValue('0x' + Math.random().toString(16).substring(2, 42)),
        deploymentTransaction: jest.fn().mockReturnValue({
          hash: '0x' + Math.random().toString(16).substring(2, 66)
        })
      })
    })),
    formatEther: jest.fn().mockImplementation((wei) => '1.0'),
    parseEther: jest.fn().mockImplementation((eth) => '1000000000000000000'),
    formatUnits: jest.fn().mockImplementation((value, unit) => '20'),
    isAddress: jest.fn().mockImplementation((addr) => addr.startsWith('0x') && addr.length === 42),
    keccak256: jest.fn().mockImplementation((data) => '0x' + Math.random().toString(16).substring(2, 66)),
    toUtf8Bytes: jest.fn().mockImplementation((str) => new Uint8Array(Buffer.from(str, 'utf8')))
  }
}));

// Mock the configuration
jest.unstable_mockModule('../src/config/agent-config.js', () => ({
  agentConfig: {
    cdp: {
      apiKeyName: 'test_key',
      privateKey: '0x' + '1'.repeat(64) // Valid private key format
    },
    claude: {
      apiKey: 'test_claude_key'
    },
    network: {
      id: 'base-sepolia'
    },
    blockchain: {
      enabled: true,
      mockResponses: true
    },
    tokenEconomics: {
      contractAddress: ''
    },
    environment: {
      nodeEnv: 'test',
      logLevel: 'error'
    }
  }
}));

// Import after mocking
const { default: BlockchainUtils } = await import('../src/utils/blockchain-utils.js');
const { default: TokenManager } = await import('../src/utils/token-manager.js');
const ethersLib = await import('ethers');

describe('BlockchainUtils', () => {
  let blockchainUtils;

  beforeEach(async () => {
    blockchainUtils = new BlockchainUtils();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should initialize blockchain utilities', async () => {
    const result = await blockchainUtils.initialize();

    expect(result.provider).toBe(true);
    expect(result.network).toBe('base-sepolia');
    expect(result.chainId).toBe(84532);
  });

  test('should get correct RPC URL for different networks', () => {
    expect(blockchainUtils.getRpcUrl('base-sepolia')).toBe('https://sepolia.base.org');
    expect(blockchainUtils.getRpcUrl('base-mainnet')).toBe('https://mainnet.base.org');
    expect(blockchainUtils.getRpcUrl('unknown')).toBe('https://sepolia.base.org'); // Default
  });

  test('should get wallet balance', async () => {
    await blockchainUtils.initialize();
    const agentAddress = '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c';
    const balance = await blockchainUtils.getWalletBalance(agentAddress);

    expect(balance.address).toBeDefined();
    expect(balance.balance).toBe('1.0');
    expect(balance.currency).toBe('ETH');
  });

  test('should send transaction', async () => {
    await blockchainUtils.initialize();
    const toAddress = '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c';
    const mockWalletProvider = {
      sendTransaction: jest.fn().mockResolvedValue({
        hash: '0x' + 'a'.repeat(64),
        wait: jest.fn().mockResolvedValue({ status: 1, gasUsed: '21000', blockNumber: 12346 })
      }),
      getAddress: jest.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c')
    };
    const result = await blockchainUtils.sendTransaction(mockWalletProvider, toAddress, 0.1);

    expect(result.hash).toBeDefined();
    expect(result.to).toBe(toAddress);
    expect(result.value).toBe(0.1);
    expect(result.status).toBe('success');
  });

  test('should create mock token contract', () => {
    const tokenContract = blockchainUtils.createMockTokenContract();

    expect(tokenContract.tokenAddress).toBeDefined();
    expect(tokenContract.name).toBe('OrthoIQ Agent Token (Mock)');
    expect(tokenContract.symbol).toBe('OAT');
    expect(tokenContract.totalSupply).toBe('1000000');
    expect(tokenContract.isMock).toBe(true);
  });

  test('should mint tokens to agent (mock)', async () => {
    const tokenAddress = '0x' + '1'.repeat(40);
    const agentAddress = '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c';

    const result = await blockchainUtils.mintTokensToAgent(tokenAddress, agentAddress, 100);

    expect(result.contractAddress).toBe(tokenAddress);
    expect(result.functionName).toBe('mint');
    expect(result.args).toEqual([agentAddress, 100]);
    expect(result.status).toBe('success');
    expect(result.isMock).toBe(true);
  });

  test('should transfer tokens between agents (mock)', async () => {
    const tokenAddress = '0x' + '1'.repeat(40);
    const fromAddress = '0x' + '2'.repeat(40);
    const toAddress = '0x' + '3'.repeat(40);

    const result = await blockchainUtils.transferTokensBetweenAgents(
      tokenAddress, fromAddress, toAddress, 50
    );

    expect(result.contractAddress).toBe(tokenAddress);
    expect(result.functionName).toBe('transferFrom');
    expect(result.args).toEqual([fromAddress, toAddress, 50]);
    expect(result.status).toBe('success');
    expect(result.isMock).toBe(true);
  });

  test('should get token balance (mock)', async () => {
    const tokenAddress = '0x' + '1'.repeat(40);
    const agentAddress = '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c';

    const result = await blockchainUtils.getTokenBalance(tokenAddress, agentAddress);

    expect(result.address).toBe(agentAddress);
    expect(result.tokenAddress).toBe(tokenAddress);
    expect(result.balance).toBe('0.0');
    expect(result.isMock).toBe(true);
  });

  test('should record medical outcome on blockchain', async () => {
    await blockchainUtils.initialize();

    const outcome = {
      painReduction: 75,
      functionalImprovement: true,
      satisfaction: 9
    };

    const result = await blockchainUtils.recordMedicalOutcome('patient123', outcome, 'agent456');

    expect(result.patientId).toBe('patient123');
    expect(result.agentId).toBe('agent456');
    expect(result.outcomeHash).toBeDefined();
  });

  test('should verify medical record', async () => {
    await blockchainUtils.initialize();
    const txHash = '0x123456789abcdef';

    const result = await blockchainUtils.verifyMedicalRecord(txHash);

    expect(result.hash).toBe(txHash);
    expect(result.verified).toBe(true);
    expect(result.blockNumber).toBeDefined();
  });

  test('should create reputation score', async () => {
    await blockchainUtils.initialize();

    const scores = {
      accuracy: 95,
      timeliness: 88,
      patientSatisfaction: 92
    };

    const result = await blockchainUtils.createReputationScore('agent123', scores);

    expect(result.agentId).toBe('agent123');
    expect(result.scores).toEqual(scores);
    expect(result.reputationHash).toBeDefined();
  });

  test('should get network statistics', async () => {
    await blockchainUtils.initialize();
    const stats = await blockchainUtils.getNetworkStatistics();

    expect(stats.networkName).toBe('base-sepolia');
    expect(stats.chainId).toBe(84532);
    expect(stats.currentBlock).toBe(12345);
    expect(stats.gasPrice).toBeDefined();
    expect(stats.walletBalance).toBeDefined();
  });

  test('should validate addresses correctly', () => {
    const validAddress = '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c';
    const invalidAddress = '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0'; // Too short

    expect(blockchainUtils.validateAddress(validAddress)).toBe(true);
    expect(blockchainUtils.validateAddress(invalidAddress)).toBe(false);
  });

  test('should generate random wallet', () => {
    const originalCreateRandom = ethersLib.ethers.Wallet.createRandom;
    ethersLib.ethers.Wallet.createRandom = jest.fn().mockReturnValue({
      address: '0x' + Math.random().toString(16).substring(2, 42),
      privateKey: '0x' + Math.random().toString(16).substring(2, 66),
      mnemonic: {
        phrase: 'test mnemonic phrase here'
      }
    });

    const wallet = blockchainUtils.generateRandomWallet();

    expect(wallet.address).toBeDefined();
    expect(wallet.privateKey).toBeDefined();
    expect(wallet.mnemonic).toBeDefined();

    // Restore original method
    ethersLib.ethers.Wallet.createRandom = originalCreateRandom;
  });

  test('should check connection status', async () => {
    await blockchainUtils.initialize();
    const isConnected = await blockchainUtils.isConnected();

    expect(isConnected).toBe(true);
  });

  test('should fund test wallet', async () => {
    const testAddress = '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c';
    const result = await blockchainUtils.fundTestWallet(testAddress, 0.5);

    expect(result.address).toBe(testAddress);
    expect(result.funded).toBe(0.5);
    expect(result.isTestFunding).toBe(true);
  });

  test('should create test environment', () => {
    const testEnv = blockchainUtils.createTestEnvironment();

    expect(testEnv.network).toBe('base-sepolia');
    expect(testEnv.rpcUrl).toBe('https://sepolia.base.org');
    expect(testEnv.faucetUrl).toBeDefined();
    expect(testEnv.explorerUrl).toBeDefined();
    expect(testEnv.testTokens.OAT).toBeDefined();
  });
});

describe('TokenManager', () => {
  let tokenManager;
  let mockAgent;

  beforeEach(() => {
    tokenManager = new TokenManager();
    mockAgent = {
      agentId: 'agent123',
      name: 'TestAgent',
      walletAddress: '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c',
      tokenBalance: 0
    };
  });

  test('should initialize with default state', () => {
    expect(tokenManager.tokenTransactions.size).toBe(0);
    expect(tokenManager.agentBalances.size).toBe(0);
    expect(tokenManager.rewardRules).toBeDefined();
    expect(tokenManager.networkStats.totalTokensIssued).toBe(0);
  });

  test('should initialize agent wallet', async () => {
    const result = await tokenManager.initializeAgentWallet(mockAgent);

    expect(result.agentId).toBe('agent123');
    expect(result.walletAddress).toBe(mockAgent.walletAddress);
    expect(result.initialBalance).toBe(0);

    const balance = tokenManager.getAgentBalance('agent123');
    expect(balance).toBeDefined();
    expect(balance.name).toBe('TestAgent');
    expect(balance.tokenBalance).toBe(0);
  });

  test('should distribute token rewards', async () => {
    await tokenManager.initializeAgentWallet(mockAgent);

    const outcome = {
      success: true,
      mdApproval: true,
      userSatisfaction: 9,
      functionalImprovement: true
    };

    const result = await tokenManager.distributeTokenReward('agent123', outcome);

    expect(result.agentId).toBe('agent123');
    expect(result.amount).toBeGreaterThan(0);
    expect(result.newBalance).toBeGreaterThan(0);
    expect(result.status).toBeDefined();

    // Check that balance was updated
    const balance = tokenManager.getAgentBalance('agent123');
    expect(balance.tokenBalance).toBe(result.amount);
    expect(balance.totalEarned).toBe(result.amount);
  });

  test('should calculate reward amounts correctly', () => {
    const basicOutcome = { success: true };
    const complexOutcome = {
      success: true,
      mdApproval: true,
      userSatisfaction: 9,
      functionalImprovement: true,
      painReduction: 75,
      collaborationBonus: true
    };

    const basicReward = tokenManager.calculateRewardAmount(basicOutcome);
    const complexReward = tokenManager.calculateRewardAmount(complexOutcome);

    expect(basicReward).toBeGreaterThan(0);
    expect(complexReward).toBeGreaterThan(basicReward);
    expect(complexReward).toBeGreaterThan(50); // Should be substantial
  });

  test('should transfer tokens between agents', async () => {
    // Initialize two agents
    const agent1 = { ...mockAgent, agentId: 'agent1', name: 'Agent1' };
    const agent2 = { ...mockAgent, agentId: 'agent2', name: 'Agent2', walletAddress: '0x' + '2'.repeat(40) };

    await tokenManager.initializeAgentWallet(agent1);
    await tokenManager.initializeAgentWallet(agent2);

    // Give agent1 some tokens first
    await tokenManager.distributeTokenReward('agent1', { success: true, mdApproval: true });

    const initialBalance1 = tokenManager.getAgentBalance('agent1').tokenBalance;
    const initialBalance2 = tokenManager.getAgentBalance('agent2').tokenBalance;

    // Transfer tokens
    const transferAmount = 5;
    const result = await tokenManager.transferTokensBetweenAgents(
      'agent1', 'agent2', transferAmount, 'collaboration_bonus'
    );

    expect(result.fromAgentId).toBe('agent1');
    expect(result.toAgentId).toBe('agent2');
    expect(result.amount).toBe(transferAmount);

    // Check balances updated correctly
    const finalBalance1 = tokenManager.getAgentBalance('agent1').tokenBalance;
    const finalBalance2 = tokenManager.getAgentBalance('agent2').tokenBalance;

    expect(finalBalance1).toBe(initialBalance1 - transferAmount);
    expect(finalBalance2).toBe(initialBalance2 + transferAmount);
  });

  test('should create incentive pools', async () => {
    const pool = await tokenManager.createIncentivePool(
      'Recovery Excellence Pool',
      1000,
      { minPainReduction: 75, minSatisfaction: 8 }
    );

    expect(pool.name).toBe('Recovery Excellence Pool');
    expect(pool.totalTokens).toBe(1000);
    expect(pool.remainingTokens).toBe(1000);
    expect(pool.criteria).toBeDefined();
    expect(pool.status).toBe('active');
  });

  test('should track network statistics', async () => {
    await tokenManager.initializeAgentWallet(mockAgent);
    await tokenManager.distributeTokenReward('agent123', { success: true });

    const stats = tokenManager.getNetworkStatistics();

    expect(stats.totalAgents).toBe(1);
    expect(stats.totalTokensIssued).toBeGreaterThan(0);
    expect(stats.totalRewardsDistributed).toBe(1);
    expect(stats.successfulOutcomes).toBe(1);
    expect(stats.networkUtilization).toBeGreaterThan(0);
  });

  test('should get top performers', async () => {
    // Initialize multiple agents and give them different rewards
    const agents = [
      { agentId: 'agent1', name: 'Agent1', walletAddress: '0x' + '1'.repeat(40), tokenBalance: 0 },
      { agentId: 'agent2', name: 'Agent2', walletAddress: '0x' + '2'.repeat(40), tokenBalance: 0 },
      { agentId: 'agent3', name: 'Agent3', walletAddress: '0x' + '3'.repeat(40), tokenBalance: 0 }
    ];

    for (const agent of agents) {
      await tokenManager.initializeAgentWallet(agent);
    }

    // Give different rewards
    await tokenManager.distributeTokenReward('agent1', { success: true, mdApproval: true });
    await tokenManager.distributeTokenReward('agent2', { success: true });
    await tokenManager.distributeTokenReward('agent3', { success: true, functionalImprovement: true });

    const topPerformers = tokenManager.getTopPerformers(2);

    expect(topPerformers).toHaveLength(2);
    expect(topPerformers[0].totalEarned).toBeGreaterThanOrEqual(topPerformers[1].totalEarned);
  });

  test('should generate audit report', async () => {
    await tokenManager.initializeAgentWallet(mockAgent);
    await tokenManager.distributeTokenReward('agent123', { success: true });

    const report = tokenManager.generateTokenAuditReport();

    expect(report.reportDate).toBeDefined();
    expect(report.totalTokensIssued).toBeGreaterThan(0);
    expect(report.totalCirculating).toBeGreaterThan(0);
    expect(report.totalTransactions).toBe(1);
    expect(report.agentCount).toBe(1);
    expect(report.integrityCheck).toBe(true); // Issued should equal circulating
  });

  test('should handle insufficient balance for transfer', async () => {
    await tokenManager.initializeAgentWallet(mockAgent);

    const agent2 = { ...mockAgent, agentId: 'agent2', walletAddress: '0x' + '2'.repeat(40) };
    await tokenManager.initializeAgentWallet(agent2);

    // Try to transfer more than available
    await expect(
      tokenManager.transferTokensBetweenAgents('agent123', 'agent2', 100, 'test')
    ).rejects.toThrow('Insufficient token balance');
  });

  test('should get reward rules summary', () => {
    const summary = tokenManager.getRewardRulesSummary();

    expect(summary.totalRules).toBeGreaterThan(0);
    expect(summary.categories).toBeDefined();
    expect(summary.categories.base).toBeGreaterThan(0);
    expect(summary.categories.medical).toBeGreaterThan(0);
    expect(summary.rules).toBeDefined();
  });
});

describe('Token Economics Integration', () => {
  let tokenManager;
  let blockchainUtils;

  beforeEach(async () => {
    tokenManager = new TokenManager();
    blockchainUtils = new BlockchainUtils();
    await blockchainUtils.initialize();
  });

  test('should integrate token rewards with blockchain', async () => {
    const mockAgent = {
      agentId: 'agent123',
      name: 'TestAgent',
      walletAddress: '0x742d35Cc6634C0532925a3b8c6Cb0de17c46BA0c',
      tokenBalance: 0
    };

    await tokenManager.initializeAgentWallet(mockAgent);

    const outcome = {
      success: true,
      mdApproval: true,
      functionalImprovement: true
    };

    const tokenResult = await tokenManager.distributeTokenReward('agent123', outcome);
    expect(tokenResult.amount).toBeGreaterThan(0);

    // Simulate blockchain minting
    const mintResult = await blockchainUtils.mintTokensToAgent(
      '0x' + '1'.repeat(40),
      mockAgent.walletAddress,
      tokenResult.amount
    );

    expect(mintResult.status).toBe('success');
    expect(mintResult.args[1]).toBe(tokenResult.amount);
  });

  test('should record medical outcomes on blockchain', async () => {
    const patientOutcome = {
      painReduction: 80,
      functionalImprovement: true,
      patientSatisfaction: 9,
      returnToActivity: true
    };

    const blockchainRecord = await blockchainUtils.recordMedicalOutcome(
      'patient123',
      patientOutcome,
      'agent456'
    );

    expect(blockchainRecord.patientId).toBe('patient123');
    expect(blockchainRecord.agentId).toBe('agent456');
    expect(blockchainRecord.outcomeHash).toBeDefined();

    // Verify the record
    const verification = await blockchainUtils.verifyMedicalRecord(
      blockchainRecord.transactionHash
    );

    expect(verification.verified).toBe(true);
  });
});
