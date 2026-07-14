/**
 * Panel composition — per-agent model routing. personas_single_model keeps every slot on one model
 * (default path unchanged); same_family_multi_version assigns a distinct Claude model per specialist.
 */
import { modelForAgent, modelMap, SAME_FAMILY_MODELS, DEFAULT_COMPOSITION } from '../detector/panel-composition.js';
import { buildRequests } from '../detector/transport.js';
import { AGENTS } from '../detector/grid.js';

describe('modelForAgent resolver', () => {
  test('default composition returns the single fallback model for every slot', () => {
    for (const a of AGENTS) {
      expect(modelForAgent(DEFAULT_COMPOSITION, a, 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    }
  });

  test('same_family_multi_version returns a distinct per-slot model', () => {
    expect(modelForAgent('same_family_multi_version', 'painWhisperer', 'X')).toBe(SAME_FAMILY_MODELS.painWhisperer);
    expect(modelForAgent('same_family_multi_version', 'strengthSage', 'X')).toBe(SAME_FAMILY_MODELS.strengthSage);
    // the four slots are genuinely distinct models (the point of decorrelation)
    const used = AGENTS.map((a) => modelForAgent('same_family_multi_version', a, 'X'));
    expect(new Set(used).size).toBe(AGENTS.length);
  });

  test('an unknown agent under same-family falls back to the default model', () => {
    expect(modelForAgent('same_family_multi_version', 'notAnAgent', 'FALLBACK')).toBe('FALLBACK');
  });

  test('modelMap builds the full per-agent map', () => {
    const m = modelMap('same_family_multi_version', AGENTS, 'X');
    for (const a of AGENTS) expect(m[a]).toBe(SAME_FAMILY_MODELS[a]);
  });
});

describe('buildRequests routes model per agent', () => {
  const stub = (name) => ({
    getSystemPrompt: () => `sys-${name}`,
    buildPositionPrompt: () => `prompt-${name}`,
  });
  const specialists = new Map(AGENTS.map((a) => [a, stub(a)]));
  const cases = [{ id: 'c1', decision_point: 'op vs non-op?', options: ['operative', 'non-operative'] }];

  test('same-family: each request uses its agent slot model, all Anthropic (one batch)', () => {
    const { entries, requests } = buildRequests(
      cases, { replicates: 1, model: 'claude-sonnet-4-6', maxTokens: 1000, composition: 'same_family_multi_version' }, { specialists }
    );
    expect(requests.length).toBe(entries.length);
    for (let i = 0; i < entries.length; i++) {
      expect(requests[i].params.model).toBe(SAME_FAMILY_MODELS[entries[i].agent]);
      expect(entries[i].model).toBe(SAME_FAMILY_MODELS[entries[i].agent]);
    }
    // all four distinct models appear across the batch
    expect(new Set(requests.map((r) => r.params.model)).size).toBe(AGENTS.length);
  });

  test('default composition: every request uses the single model', () => {
    const { requests } = buildRequests(
      cases, { replicates: 1, model: 'claude-sonnet-4-6', maxTokens: 1000, composition: DEFAULT_COMPOSITION }, { specialists }
    );
    for (const r of requests) expect(r.params.model).toBe('claude-sonnet-4-6');
  });
});
