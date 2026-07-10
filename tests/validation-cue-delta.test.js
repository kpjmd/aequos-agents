/**
 * Cue-injection delta grouping — mean (cued − neutral) confidence by stratum / agent.
 */
import { deltaByGroup } from '../validation/analyze.js';

const rows = [
  // editorialized: cue inflates confidence (+0.2)
  { stratum: 'editorialized', agent: 'painWhisperer', phrasing: 'neutral', confidence: 0.6 },
  { stratum: 'editorialized', agent: 'painWhisperer', phrasing: 'cued', confidence: 0.8 },
  // quietly_contested: cue does nothing (0)
  { stratum: 'quietly_contested', agent: 'strengthSage', phrasing: 'neutral', confidence: 0.5 },
  { stratum: 'quietly_contested', agent: 'strengthSage', phrasing: 'cued', confidence: 0.5 },
];

describe('deltaByGroup', () => {
  test('groups cue-delta by stratum', () => {
    const g = deltaByGroup(rows, 'stratum');
    expect(g.editorialized.delta).toBeCloseTo(0.2);
    expect(g.quietly_contested.delta).toBeCloseTo(0);
    expect(g.editorialized.n).toBe(2);
  });
  test('groups cue-delta by agent', () => {
    const g = deltaByGroup(rows, 'agent');
    expect(g.painWhisperer.delta).toBeCloseTo(0.2);
    expect(g.strengthSage.delta).toBeCloseTo(0);
  });
  test('ignores rows missing the key or a numeric confidence', () => {
    const g = deltaByGroup([...rows, { stratum: null, phrasing: 'cued', confidence: 0.9 }, { stratum: 'editorialized', phrasing: 'cued', confidence: 'x' }], 'stratum');
    expect(g.editorialized.n).toBe(2); // the bad rows dropped
  });
});
