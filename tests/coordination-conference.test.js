import { describe, test, expect, jest } from '@jest/globals';

// agent-config is read at module load by AgentCoordinator's import chain.
jest.unstable_mockModule('../src/config/agent-config.js', () => ({
  agentConfig: {
    agent: { maxSpecialistsPerCase: 5 },
    claude: { apiKey: 'test_claude_key' },
    cdp: { apiKeyName: 'test_key', privateKey: 'test_private_key' },
    network: { id: 'base-sepolia' },
    environment: { nodeEnv: 'test', logLevel: 'error' },
  },
}));

const { CoordinationConference } = await import('../src/utils/coordination-conference.js');
const { default: AgentCoordinator } = await import('../src/utils/agent-coordinator.js');
const { makePositionSchema, makeReconsiderSchema, DecisionPointsSchema } = await import('../src/utils/dialogue-schemas.js');
const { storeCoordinationDivergences, getCoordinationDivergences } = await import('../src/utils/divergence-storage.js');

// ---- helpers --------------------------------------------------------------
const pos = (dpId, stance, confidence, specialist) => ({
  decisionPointId: dpId, stance, confidence, specialist,
  specialistType: specialist, reasoning: 'because', evidenceGrade: 'B',
});
const turn = (specialist, originalStance, revisedStance, changed, changeReason = '') => ({
  decisionPointId: 'd1', specialist, originalStance, revisedStance, changed, changeReason, confidence: 0.8,
});
const DP = { id: 'd1', question: 'Surgery now or rehab first?', options: ['surgery', 'rehab'] };

function mockTriage(decisionPoints) {
  return { identifyDecisionPoints: jest.fn().mockResolvedValue(decisionPoints) };
}
function mockSpecialist(name, stanceFor) {
  return {
    statePosition: jest.fn(async (_caseData, dp) => ({
      decisionPointId: dp.id, specialist: name, stance: stanceFor(dp),
      confidence: 0.8, reasoning: `${name} reasoning`, evidenceGrade: 'B',
    })),
    reconsiderPosition: jest.fn(async (_caseData, dp, own) => ({
      decisionPointId: dp.id, specialist: name, originalStance: own.stance,
      revisedStance: own.stance, changed: false, reasoning: 'rr', changeReason: 'hold', confidence: 0.8,
    })),
  };
}
function panel(decisionPoints, stanceFor) {
  return new Map([
    ['triage', mockTriage(decisionPoints)],
    ['painWhisperer', mockSpecialist('Pain', dp => stanceFor('painWhisperer', dp))],
    ['movementDetective', mockSpecialist('Move', dp => stanceFor('movementDetective', dp))],
    ['strengthSage', mockSpecialist('Strength', dp => stanceFor('strengthSage', dp))],
    ['mindMender', mockSpecialist('Mind', dp => stanceFor('mindMender', dp))],
  ]);
}

// ---- detectDivergence -----------------------------------------------------
describe('CoordinationConference.detectDivergence', () => {
  const conf = new CoordinationConference();

  test('no divergence when all substantive stances agree', () => {
    const out = conf.detectDivergence([DP], [pos('d1', 'surgery', 0.8, 'Pain'), pos('d1', 'surgery', 0.8, 'Move')]);
    expect(out).toHaveLength(0);
  });

  test('divergence when >=2 distinct stances clear the floor', () => {
    const out = conf.detectDivergence([DP], [pos('d1', 'surgery', 0.8, 'Pain'), pos('d1', 'rehab', 0.8, 'Move')]);
    expect(out).toHaveLength(1);
    expect(out[0].sides).toHaveLength(2);
    expect(out[0].decisionPoint).toBe(DP);
  });

  test('below-floor stances do not count toward divergence', () => {
    const out = conf.detectDivergence([DP], [pos('d1', 'surgery', 0.8, 'Pain'), pos('d1', 'rehab', 0.4, 'Move')]);
    expect(out).toHaveLength(0);
  });

  test('defer is not a substantive stance', () => {
    const out = conf.detectDivergence([DP], [pos('d1', 'surgery', 0.8, 'Pain'), pos('d1', 'defer', 0.95, 'Move')]);
    expect(out).toHaveLength(0);
    // defer captured for context
    const div = conf.detectDivergence(
      [DP],
      [pos('d1', 'surgery', 0.8, 'Pain'), pos('d1', 'rehab', 0.8, 'Move'), pos('d1', 'defer', 0.9, 'Mind')]
    );
    expect(div[0].deferred.map(d => d.specialist)).toContain('Mind');
  });
});

// ---- summarizePostDialogue ------------------------------------------------
describe('CoordinationConference.summarizePostDialogue', () => {
  const conf = new CoordinationConference();

  test('persistent split when final stances still differ', () => {
    const pd = conf.summarizePostDialogue([turn('Pain', 'surgery', 'surgery', false), turn('Move', 'rehab', 'rehab', false)]);
    expect(pd.persisted).toBe(true);
    expect(pd.resolved).toBe(false);
    expect(pd.changedCount).toBe(0);
  });

  test('resolved with delta captured when a specialist revises', () => {
    const pd = conf.summarizePostDialogue([turn('Pain', 'surgery', 'rehab', true, 'moved by X'), turn('Move', 'rehab', 'rehab', false)]);
    expect(pd.resolved).toBe(true);
    expect(pd.persisted).toBe(false);
    expect(pd.changedCount).toBe(1);
    expect(pd.deltas[0]).toMatchObject({ specialist: 'Pain', from: 'surgery', to: 'rehab' });
  });
});

// ---- conductConferenceRound gate + dialogue -------------------------------
describe('CoordinationConference.conductConferenceRound (gate)', () => {
  test('fast mode skips the conference entirely', async () => {
    const conf = new CoordinationConference();
    const cm = await conf.conductConferenceRound(new Map(), new Map(), {}, { mode: 'fast' });
    expect(cm.gateOpen).toBe(false);
    expect(cm.note).toMatch(/fast mode/);
  });

  test('gate closed when triage finds no contested decision points', async () => {
    const conf = new CoordinationConference();
    const specialists = panel([], () => 'surgery');
    const cm = await conf.conductConferenceRound(new Map(), specialists, {}, { mode: 'normal' });
    expect(cm.gateOpen).toBe(false);
    expect(cm.positions).toEqual([]);
    expect(specialists.get('painWhisperer').statePosition).not.toHaveBeenCalled();
  });

  test('gate closed (no manufactured disagreement) when specialists converge', async () => {
    const conf = new CoordinationConference();
    const specialists = panel([DP], () => 'surgery'); // everyone agrees
    const cm = await conf.conductConferenceRound(new Map(), specialists, {}, { mode: 'normal' });
    expect(cm.gateOpen).toBe(false);
    expect(cm.divergences).toHaveLength(0);
    expect(cm.positions.length).toBe(4); // positions elicited...
    expect(specialists.get('painWhisperer').reconsiderPosition).not.toHaveBeenCalled(); // ...but no dialogue
  });

  test('gate open + dialogue round runs when specialists genuinely split', async () => {
    const conf = new CoordinationConference();
    const stanceFor = type => (['painWhisperer', 'strengthSage'].includes(type) ? 'rehab' : 'surgery');
    const specialists = panel([DP], stanceFor);
    const cm = await conf.conductConferenceRound(new Map(), specialists, {}, { mode: 'normal' });
    expect(cm.gateOpen).toBe(true);
    expect(cm.divergences).toHaveLength(1);
    expect(cm.interAgentDialogue.length).toBeGreaterThan(0);
    expect(specialists.get('painWhisperer').reconsiderPosition).toHaveBeenCalled();
    expect(cm.divergences[0].postDialogue).toBeDefined();
  });
});

// ---- formatDivergencesForSynthesis ----------------------------------------
describe('AgentCoordinator.formatDivergencesForSynthesis', () => {
  const coord = new AgentCoordinator();

  test('returns empty string when there is no genuine divergence', () => {
    expect(coord.formatDivergencesForSynthesis(null)).toBe('');
    expect(coord.formatDivergencesForSynthesis({ gateOpen: false, divergences: [] })).toBe('');
    expect(coord.formatDivergencesForSynthesis({ gateOpen: true, divergences: [] })).toBe('');
  });

  test('renders contested decision content when divergence exists', () => {
    const block = coord.formatDivergencesForSynthesis({
      gateOpen: true,
      divergences: [{
        decisionPoint: { question: 'Surgery now or rehab first?' },
        sides: [
          { stance: 'surgery', specialists: [{ specialist: 'Move', reasoning: 'instability' }] },
          { stance: 'rehab', specialists: [{ specialist: 'Strength', reasoning: 'prehab' }] },
        ],
        dialogue: [],
        postDialogue: {},
      }],
    });
    expect(block).toContain('GENUINE SPECIALIST DISAGREEMENTS');
    expect(block).toContain('Surgery now or rehab first?');
    expect(block).toContain('Move');
    expect(block).toContain('Strength');
  });
});

// ---- schemas --------------------------------------------------------------
describe('dialogue-schemas', () => {
  test('makePositionSchema constrains stance to options + defer', () => {
    const schema = makePositionSchema(['surgery', 'rehab']);
    expect(schema.safeParse({ reasoning: 'r', stance: 'surgery', confidence: 0.8, evidenceGrade: 'B' }).success).toBe(true);
    expect(schema.safeParse({ reasoning: 'r', stance: 'defer', confidence: 0.4, evidenceGrade: 'none' }).success).toBe(true);
    expect(schema.safeParse({ reasoning: 'r', stance: 'off-menu', confidence: 0.8, evidenceGrade: 'B' }).success).toBe(false);
  });

  test('makeReconsiderSchema constrains revisedStance', () => {
    const schema = makeReconsiderSchema(['surgery', 'rehab']);
    expect(schema.safeParse({ reconsideration: 'r', revisedStance: 'rehab', changeReason: 'x', confidence: 0.7 }).success).toBe(true);
    expect(schema.safeParse({ reconsideration: 'r', revisedStance: 'nope', changeReason: 'x', confidence: 0.7 }).success).toBe(false);
  });

  test('DecisionPointsSchema accepts an empty list (clear case)', () => {
    expect(DecisionPointsSchema.safeParse({ decisionPoints: [] }).success).toBe(true);
    expect(DecisionPointsSchema.safeParse({
      decisionPoints: [{ id: 'd', question: 'q', options: ['a', 'b'], rationale: 'why' }],
    }).success).toBe(true);
  });
});

// ---- persistence no-op without DB -----------------------------------------
describe('divergence-storage (no DATABASE_URL)', () => {
  test('store is a safe no-op returning 0', async () => {
    const n = await storeCoordinationDivergences('c1', {
      gateOpen: true,
      divergences: [{ decisionPoint: { id: 'd', question: 'q', options: ['a', 'b'] }, sides: [], dialogue: [], postDialogue: { persisted: true } }],
    });
    expect(n).toBe(0);
  });

  test('store returns 0 when gate closed', async () => {
    expect(await storeCoordinationDivergences('c2', { gateOpen: false, divergences: [] })).toBe(0);
  });

  test('get returns empty array without DB', async () => {
    expect(await getCoordinationDivergences('c1')).toEqual([]);
  });
});
