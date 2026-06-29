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
const { buildSynthesizerOutput, storeSynthesizerOutput } = await import('../src/utils/synthesizer.js');
const { createQuery, resolveModelVersionId, getSentinelDecisionPointId } = await import('../src/utils/equipoise-ingest.js');
const { resolvePersona, PERSONA_BY_KEY } = await import('../src/utils/specialist-identity.js');

const CANONICAL_NAMES = new Set(Object.values(PERSONA_BY_KEY).map(p => p.specialist));
const CANONICAL_KEYS = new Set(Object.values(PERSONA_BY_KEY).map(p => p.specialistType));

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

// Like mockSpecialist but reports a clinical-label specialistType and revises its stance on
// reconsider — used to prove the conference normalizes identity and never leaks raw labels.
function mockLeakyRevisingSpecialist(rawLabel, stance, revisesTo = null) {
  return {
    statePosition: jest.fn(async (_caseData, dp) => ({
      decisionPointId: dp.id, specialist: rawLabel, specialistType: rawLabel,
      stance, confidence: 0.8, reasoning: `${rawLabel} reasoning`, evidenceGrade: 'B',
    })),
    reconsiderPosition: jest.fn(async (_caseData, dp, own) => ({
      decisionPointId: dp.id, specialist: rawLabel, specialistType: rawLabel,
      originalStance: own.stance, revisedStance: revisesTo || own.stance,
      changed: revisesTo != null && revisesTo !== own.stance,
      reasoning: 'rr', changeReason: revisesTo ? 'persuaded' : 'hold', confidence: 0.8,
    })),
  };
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

// ---- synthesizer: routing/collapse truth table + card --------------------
describe('buildSynthesizerOutput', () => {
  const contestedPerDP = {
    decisionPoint: { id: 'd1', question: 'Early reconstruction vs structured rehab?', options: ['Early reconstruction', 'Structured rehab'] },
    verdict: 'contested',
    positions: [],
    splitSummary: {
      verdict: 'contested',
      stanceCounts: { 'Early reconstruction': 2, 'Structured rehab': 2 },
      sides: [
        { stance: 'Early reconstruction', specialists: [{ specialist: 'Strength Sage', confidence: 0.8, evidenceGrade: 'B', reasoning: 'active giving-way, secondary meniscal risk' }] },
        { stance: 'Structured rehab', specialists: [{ specialist: 'Movement Detective', confidence: 0.75, evidenceGrade: 'B', reasoning: 'KANON: rehab is the diagnostic test' }] },
      ],
      postDialogue: { resolved: false, persisted: true, changedCount: 1, deltas: [{ specialist: 'Pain Whisperer', from: 'Structured rehab', to: 'Early reconstruction', reason: 'giving-way' }] },
    },
  };
  const convergedPerDP = {
    decisionPoint: { id: 'd2', question: 'Drain or observe?', options: ['Drainage', 'Observe'] },
    verdict: 'converged',
    positions: [],
    splitSummary: { verdict: 'converged', stanceCounts: { Drainage: 4 }, sides: null, postDialogue: null },
  };

  test('contested, no red flag → surface the equipoise card (no route, no collapse)', () => {
    const o = buildSynthesizerOutput(contestedPerDP, { requiresImmediateMD: false, treatmentPlan: { phase1: 'prehab' } });
    expect(o.status).toBe('contested');
    expect(o.route_to_human).toBe(false);
    expect(o.route_reason).toBe('none');
    expect(o.collapsed).toBe(false);
    expect(o.collapse_reason).toBeNull();
    expect(o.support_score).toBe(0.5); // 2-2 split
    expect(o.card_json.theSplit).toHaveLength(2);
    expect(o.card_json.whatWouldTipIt.source).toBe('panel_reasoning');
    expect(o.card_json.whatWouldTipIt.toward[0].factors).toContain('active giving-way, secondary meniscal risk');
    expect(o.card_json.deliberationDelta.persisted).toBe(true);
    expect(o.card_json.carePlanHome).toEqual({ phase1: 'prehab' });
  });

  test('contested + requiresImmediateMD → route to urgent surgical consult', () => {
    const o = buildSynthesizerOutput(contestedPerDP, { requiresImmediateMD: true, urgencyLevel: 'immediate' });
    expect(o.route_to_human).toBe(true);
    expect(o.route_reason).toBe('risk_category');
    expect(o.status).toBe('contested'); // status mirrors verdict; v1 never collapses
    expect(o.collapsed).toBe(false);
    expect(o.card_json.route.label).toBe('Urgent surgical consult');
  });

  test('converged, no red flag → consensus card', () => {
    const o = buildSynthesizerOutput(convergedPerDP, { requiresImmediateMD: false });
    expect(o.status).toBe('consensus');
    expect(o.route_to_human).toBe(false);
    expect(o.support_score).toBe(1);
    expect(o.card_json.whatWouldTipIt).toBeNull(); // only on contested
  });

  test('converged + requiresImmediateMD → still routes (any verdict)', () => {
    const o = buildSynthesizerOutput(convergedPerDP, { requiresImmediateMD: true });
    expect(o.route_to_human).toBe(true);
    expect(o.route_reason).toBe('risk_category');
    expect(o.status).toBe('consensus');
  });

  test('archetype-sweep splitSummary → axis-derived "what would tip it"', () => {
    const benchPerDP = {
      decisionPoint: { id: 'd3', question: 'ACL?', options: ['Surgery', 'Rehab'] },
      verdict: 'contested',
      positions: [],
      splitSummary: {
        verdict: 'contested', stanceCounts: { Surgery: 2, Rehab: 2 },
        contestedBy: ['demand_risk'],
        groups: [{ name: 'demand_risk', flipDetected: true, modalByArchetype: { high_demand_low_risk: 'Surgery', low_demand_high_risk: 'Rehab' } }],
        sides: [{ stance: 'Surgery', specialists: [] }, { stance: 'Rehab', specialists: [] }],
      },
    };
    const o = buildSynthesizerOutput(benchPerDP, {});
    expect(o.card_json.whatWouldTipIt.source).toBe('archetype_axis');
    expect(o.card_json.whatWouldTipIt.axes[0].axis).toBe('demand_risk');
  });

  // ---- Issue C: suppress non-binary / unmapped cards (persisted for audit, withheld from view) ----
  test('off-menu converged stance (3rd option) → collapsed with non_binary_unmapped', () => {
    // Triage framed a graded return-to-sport timeline; the panel converged on a 3rd option the binary
    // option_a/option_b layer cannot represent (toStanceEnum would coerce it to abstain).
    const offMenuPerDP = {
      decisionPoint: { id: 'd4', question: 'Return-to-sport timeline?', options: ['3 months', '6 months'] },
      verdict: 'converged',
      positions: [],
      splitSummary: {
        verdict: 'converged',
        stanceCounts: { 'Individualized timeline based on graft maturation': 4 },
        sides: null, postDialogue: null,
      },
    };
    const o = buildSynthesizerOutput(offMenuPerDP, {});
    expect(o.collapsed).toBe(true);
    expect(o.collapse_reason).toBe('non_binary_unmapped');
  });

  test('no substantive stance (all defer/below-floor) → collapsed with non_binary_unmapped', () => {
    const allDeferPerDP = {
      decisionPoint: { id: 'd5', question: 'Operate or observe?', options: ['Operate', 'Observe'] },
      verdict: 'converged',
      positions: [],
      splitSummary: { verdict: 'converged', stanceCounts: {}, sides: null, postDialogue: null },
    };
    const o = buildSynthesizerOutput(allDeferPerDP, {});
    expect(o.collapsed).toBe(true);
    expect(o.collapse_reason).toBe('non_binary_unmapped');
  });

  test('clean binary card (all stances on-menu) is never suppressed', () => {
    expect(buildSynthesizerOutput(contestedPerDP, {}).collapsed).toBe(false);
    expect(buildSynthesizerOutput(convergedPerDP, {}).collapsed).toBe(false);
  });

  // ---- Issue B: the full equipoise panel + specialistType on theSplit ----
  test('card_json.panel surfaces substantive on-menu contributors with specialistType', () => {
    const perDP = {
      decisionPoint: { id: 'd6', question: 'Early reconstruction vs structured rehab?', options: ['Early reconstruction', 'Structured rehab'] },
      verdict: 'contested',
      positions: [
        { specialistType: 'strengthSage', initialStance: 'Early reconstruction', finalStance: 'Early reconstruction', confidence: 0.8, reasoning: 'active giving-way', evidenceGrade: 'B' },
        { specialistType: 'movementDetective', initialStance: 'Structured rehab', finalStance: 'Structured rehab', confidence: 0.75, reasoning: 'rehab is the diagnostic test', evidenceGrade: 'B' },
        { specialistType: 'mindMender', initialStance: 'defer', finalStance: 'defer', confidence: 0, reasoning: 'outside lens', evidenceGrade: 'none' },
        { specialistType: 'painWhisperer', initialStance: 'Early reconstruction', finalStance: 'Early reconstruction', confidence: 0.5, reasoning: 'below floor', evidenceGrade: 'C' },
      ],
      splitSummary: {
        verdict: 'contested',
        stanceCounts: { 'Early reconstruction': 1, 'Structured rehab': 1 },
        sides: [
          { stance: 'Early reconstruction', specialists: [{ specialistType: 'strengthSage', specialist: 'Strength Sage', confidence: 0.8, evidenceGrade: 'B', reasoning: 'active giving-way' }] },
          { stance: 'Structured rehab', specialists: [{ specialistType: 'movementDetective', specialist: 'Movement Detective', confidence: 0.75, evidenceGrade: 'B', reasoning: 'rehab is the diagnostic test' }] },
        ],
        postDialogue: null,
      },
    };
    const o = buildSynthesizerOutput(perDP, {});
    expect(o.collapsed).toBe(false);
    // mindMender (defer→abstain) and painWhisperer (below 0.6 floor) are excluded.
    expect(o.card_json.panel).toEqual([
      { name: 'Strength Sage', specialistType: 'strengthSage', stance: 'option_a', confidence: 0.8, evidenceGrade: 'B', reasoning: 'active giving-way' },
      { name: 'Movement Detective', specialistType: 'movementDetective', stance: 'option_b', confidence: 0.75, evidenceGrade: 'B', reasoning: 'rehab is the diagnostic test' },
    ]);
    // theSplit now carries specialistType so the consult can reconcile participants.
    expect(o.card_json.theSplit[0].specialists[0].specialistType).toBe('strengthSage');
    expect(o.card_json.theSplit[1].specialists[0].specialistType).toBe('movementDetective');
  });

  test('card_json.panel is null when no positions are provided', () => {
    expect(buildSynthesizerOutput(convergedPerDP, {}).card_json.panel).toBeNull();
  });

  test('card_json.panel includes deliberate deferrals (abstain) but drops errored positions', () => {
    const perDP = {
      decisionPoint: { id: 'd7', question: 'Graft source?', options: ['Quad', 'Hamstring'] },
      verdict: 'converged',
      positions: [
        { specialistType: 'strengthSage', initialStance: 'Quad', finalStance: 'Quad', confidence: 0.8, reasoning: 'extensor strength', evidenceGrade: 'B' },
        { specialistType: 'mindMender', initialStance: 'defer', finalStance: 'defer', confidence: 0.72, reasoning: 'graft choice outside my lens', evidenceGrade: 'none' },
        { specialistType: 'painWhisperer', initialStance: 'defer', finalStance: 'defer', confidence: 0, reasoning: 'Position unavailable (timeout)', evidenceGrade: 'none' },
      ],
      splitSummary: { verdict: 'converged', stanceCounts: { Quad: 1 }, sides: null, postDialogue: null },
    };
    const o = buildSynthesizerOutput(perDP, {});
    expect(o.collapsed).toBe(false);
    expect(o.card_json.panel).toEqual([
      { name: 'Strength Sage', specialistType: 'strengthSage', stance: 'option_a', confidence: 0.8, evidenceGrade: 'B', reasoning: 'extensor strength' },
      { name: 'Mind Mender', specialistType: 'mindMender', stance: 'abstain', confidence: 0.72, evidenceGrade: 'none', reasoning: 'graft choice outside my lens' },
    ]); // painWhisperer (confidence 0, errored deferral) is dropped
  });
});

// ---- equipoise persistence helpers: safe no-op without DB -----------------
describe('equipoise persistence (no DATABASE_URL)', () => {
  test('storeSynthesizerOutput is a safe no-op returning null', async () => {
    expect(await storeSynthesizerOutput(null, 1, { status: 'consensus' })).toBeNull();
  });
  test('createQuery / resolveModelVersionId / getSentinelDecisionPointId no-op without sql', async () => {
    expect(await createQuery(null, { questionText: 'q', decisionPointId: 1 })).toBeNull();
    expect(await resolveModelVersionId(null, 'claude-sonnet-4-6')).toBeNull();
    expect(await getSentinelDecisionPointId(null)).toBeNull();
  });
});

// ---- specialist identity mapping ------------------------------------------
describe('resolvePersona', () => {
  test('maps all 5 panel agents + research to canonical { specialistType, specialist }', () => {
    expect(resolvePersona('triage')).toEqual({ specialistType: 'triage', specialist: 'OrthoTriage Master' });
    expect(resolvePersona('painWhisperer')).toEqual({ specialistType: 'painWhisperer', specialist: 'Pain Whisperer' });
    expect(resolvePersona('movementDetective')).toEqual({ specialistType: 'movementDetective', specialist: 'Movement Detective' });
    expect(resolvePersona('strengthSage')).toEqual({ specialistType: 'strengthSage', specialist: 'Strength Sage' });
    expect(resolvePersona('mindMender')).toEqual({ specialistType: 'mindMender', specialist: 'Mind Mender' });
    expect(resolvePersona('research')).toEqual({ specialistType: 'research', specialist: 'Research Agent' });
  });

  test('normalizes snake_case agentType aliases to the canonical camelCase key', () => {
    expect(resolvePersona('pain_whisperer')).toEqual({ specialistType: 'painWhisperer', specialist: 'Pain Whisperer' });
    expect(resolvePersona('movement_detective')).toEqual({ specialistType: 'movementDetective', specialist: 'Movement Detective' });
    expect(resolvePersona('strength_sage')).toEqual({ specialistType: 'strengthSage', specialist: 'Strength Sage' });
    expect(resolvePersona('mind_mender')).toEqual({ specialistType: 'mindMender', specialist: 'Mind Mender' });
    expect(resolvePersona('research_pioneer')).toEqual({ specialistType: 'research', specialist: 'Research Agent' });
  });

  test('falls back to the raw value (no throw) for an unknown identifier', () => {
    expect(resolvePersona('Sports Medicine Specialist')).toEqual({
      specialistType: 'Sports Medicine Specialist', specialist: 'Sports Medicine Specialist',
    });
  });
});

// ---- no clinical-label leak through a real divergence ----------------------
describe('CoordinationConference identity normalization (leak guard)', () => {
  test('every specialist in sides/dialogue/deltas/deferred carries a canonical persona', async () => {
    const conf = new CoordinationConference();
    // Split panel that also reports clinical labels and revises — the conference must
    // normalize all of it to persona identity regardless of what agents return.
    const specialists = new Map([
      ['triage', mockTriage([DP])],
      ['painWhisperer', mockLeakyRevisingSpecialist('Pain Management Specialist', 'surgery', 'rehab')],
      ['movementDetective', mockLeakyRevisingSpecialist('Sports Medicine Specialist', 'rehab')],
      ['strengthSage', mockLeakyRevisingSpecialist('Physical Therapy', 'rehab')],
      ['mindMender', mockLeakyRevisingSpecialist('Psychologist', 'defer')],
    ]);

    const cm = await conf.conductConferenceRound(new Map(), specialists, {}, { mode: 'normal' });
    expect(cm.gateOpen).toBe(true);
    const div = cm.divergences[0];

    const names = [
      ...div.sides.flatMap(s => s.specialists.map(sp => sp.specialist)),
      ...div.dialogue.map(t => t.specialist),
      ...div.postDialogue.deltas.map(d => d.specialist),
      ...div.deferred.map(d => d.specialist),
    ];
    const keys = [
      ...div.sides.flatMap(s => s.specialists.map(sp => sp.specialistType)),
      ...div.dialogue.map(t => t.specialistType),
      ...div.deferred.map(d => d.specialistType),
    ];

    expect(names.length).toBeGreaterThan(0);
    expect(div.postDialogue.deltas.length).toBeGreaterThan(0); // a revision happened
    expect(div.deferred.length).toBeGreaterThan(0);            // mindMender deferred
    for (const n of names) expect(CANONICAL_NAMES.has(n)).toBe(true);
    for (const k of keys) expect(CANONICAL_KEYS.has(k)).toBe(true);
  });
});
