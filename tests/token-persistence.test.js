import { describe, test, expect, jest } from '@jest/globals';

// Mock the configuration
jest.unstable_mockModule('../src/config/agent-config.js', () => ({
  agentConfig: {
    cdp: { apiKeyName: 'test_key', privateKey: 'test_key' },
    claude: { apiKey: 'test_key' },
    network: { id: 'base-sepolia' },
    agent: { minConfidenceThreshold: 0.7, experienceMultiplier: 1.0 },
    blockchain: { enabled: false, mockResponses: true },
    environment: { nodeEnv: 'test', logLevel: 'error' }
  }
}));

jest.unstable_mockModule('@langchain/anthropic', () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({ content: 'Mock response' })
  }))
}));

const { TokenManager } = await import('../src/utils/token-manager.js');

// Helper: build a mock sql tagged-template that returns preset rows
function makeMockSql(rows = {}) {
  const calls = [];
  const fn = jest.fn((strings, ...values) => {
    const key = strings[0].trim().split('\n')[0].trim().slice(0, 40);
    calls.push({ key, values });
    // Match by first keyword of query
    const q = strings.join('').toLowerCase();
    if (q.includes('select * from agent_balances')) return rows.agent_balances || [];
    if (q.includes('select * from token_transactions')) return rows.token_transactions || [];
    return [];
  });
  fn._calls = calls;
  return fn;
}

describe('TokenManager — cold-boot DB replay (T0-9)', () => {
  test('loads agent balances from DB rows on boot', async () => {
    const manager = new TokenManager();

    const fakeRows = {
      agent_balances: [
        {
          agent_id: 'agent-abc',
          agent_name: 'Pain Whisperer',
          wallet_address: '0xabc',
          token_balance: 150,
          total_earned: 200,
          transaction_count: 5,
          last_updated: new Date().toISOString()
        }
      ],
      token_transactions: []
    };

    // Inject mock sql
    const mockSql = makeMockSql(fakeRows);
    jest.unstable_mockModule('../src/utils/db.js', () => ({ default: mockSql }));

    // Re-import after mock
    const { TokenManager: TM2 } = await import('../src/utils/token-manager.js');
    const m2 = new TM2();

    // Directly call loadFromDb with the mock sql
    // Patch _getSql to return our mock
    m2._getSql = async () => mockSql;

    await m2.loadFromDb();

    const balance = m2.getAgentBalance('agent-abc');
    expect(balance).not.toBeNull();
    expect(balance.tokenBalance).toBe(150);
    expect(balance.totalEarned).toBe(200);
    expect(balance.name).toBe('Pain Whisperer');
  });

  test('skips DB load silently when sql is null', async () => {
    const manager = new TokenManager();
    manager._getSql = async () => null;
    await expect(manager.loadFromDb()).resolves.toBeUndefined();
    expect(manager.agentBalances.size).toBe(0);
  });
});

describe('TokenManager — per-agent serialization (T0-10)', () => {
  test('50 concurrent distributeTokenReward calls produce correct total balance', async () => {
    const manager = new TokenManager();

    // Disable DB persistence for this test
    manager._getSql = async () => null;

    const agentId = 'concurrent-agent';
    manager.agentBalances.set(agentId, {
      agentId,
      name: 'ConcurrentAgent',
      walletAddress: '0xtest',
      tokenBalance: 0,
      totalEarned: 0,
      lastUpdated: new Date().toISOString(),
      transactionCount: 0
    });

    const CALLS = 50;
    const minimalOutcome = { success: false, userSatisfaction: 3 }; // = 1 token each

    await Promise.all(
      Array.from({ length: CALLS }, () =>
        manager.distributeTokenReward(agentId, minimalOutcome)
      )
    );

    const balance = manager.getAgentBalance(agentId);
    // Each call earns 1 token (base only). No lost updates expected.
    expect(balance.tokenBalance).toBe(CALLS);
    expect(balance.transactionCount).toBe(CALLS);
  });

  test('transfer between agents serializes correctly', async () => {
    const manager = new TokenManager();
    manager._getSql = async () => null;

    manager.agentBalances.set('from-agent', {
      agentId: 'from-agent', name: 'From', walletAddress: '0x1',
      tokenBalance: 100, totalEarned: 100, transactionCount: 0,
      lastUpdated: new Date().toISOString()
    });
    manager.agentBalances.set('to-agent', {
      agentId: 'to-agent', name: 'To', walletAddress: '0x2',
      tokenBalance: 0, totalEarned: 0, transactionCount: 0,
      lastUpdated: new Date().toISOString()
    });

    // 5 concurrent transfers of 10 each — only 10 can succeed (balance=100)
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        manager.transferTokensBetweenAgents('from-agent', 'to-agent', 10, 'test')
      )
    );

    const from = manager.getAgentBalance('from-agent');
    const to = manager.getAgentBalance('to-agent');

    // All 10 transfers of 10 should succeed (100 total available)
    expect(from.tokenBalance).toBe(0);
    expect(to.tokenBalance).toBe(100);
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(10);
  });
});

describe('TokenManager — applyPenalty (T0-9)', () => {
  test('penalty reduces balance and is recorded as transaction', async () => {
    const manager = new TokenManager();
    manager._getSql = async () => null;

    const agentId = 'penalty-agent';
    manager.agentBalances.set(agentId, {
      agentId, name: 'PenaltyAgent', walletAddress: '0x3',
      tokenBalance: 50, totalEarned: 50, transactionCount: 0,
      lastUpdated: new Date().toISOString()
    });

    await manager.applyPenalty(agentId, 20);

    const balance = manager.getAgentBalance(agentId);
    expect(balance.tokenBalance).toBe(30);
    expect(balance.transactionCount).toBe(1);
  });

  test('penalty is capped at current balance (no negative balances)', async () => {
    const manager = new TokenManager();
    manager._getSql = async () => null;

    const agentId = 'small-balance-agent';
    manager.agentBalances.set(agentId, {
      agentId, name: 'SmallAgent', walletAddress: '0x4',
      tokenBalance: 5, totalEarned: 5, transactionCount: 0,
      lastUpdated: new Date().toISOString()
    });

    await manager.applyPenalty(agentId, 100);

    const balance = manager.getAgentBalance(agentId);
    expect(balance.tokenBalance).toBe(0);
  });
});
