/**
 * Validation harness prompt builders (pure): masked-evidence strips topic identity; cue pairs differ
 * only in the cue line.
 */
import { buildMaskedPrompt, stripTopicIdentity, fabricatedEvidence, NEUTRAL_OPTIONS } from '../validation/masked-evidence/build.js';
import { buildPair, CUES } from '../validation/cue-injection/pairs.js';
import { analyzeMasked, analyzeCue } from '../validation/analyze.js';

const aclCase = {
  id: 'acl-graft-choice',
  decision_point: 'When ACL reconstruction is chosen, is a BPTB or hamstring autograft preferred?',
  options: ['BPTB autograft', 'Hamstring autograft'],
  provenance: { legacy_body_region: 'knee' },
};

describe('masked-evidence build', () => {
  test('strips topic identity — no condition/option text leaks into the prompt', () => {
    const { userPrompt, options, audit } = buildMaskedPrompt(aclCase, { effect_direction: 'A', effect_size: 'large', certainty: 'high', n_trials: 4 });
    expect(userPrompt).not.toMatch(/ACL/i);
    expect(userPrompt).not.toMatch(/BPTB/i);
    expect(userPrompt).not.toMatch(/hamstring/i);
    expect(userPrompt).not.toMatch(/knee/i);
    expect(options).toEqual(NEUTRAL_OPTIONS);
    // what was removed is recorded for inspection
    expect(audit.removed.join()).toMatch(/ACL/);
    expect(audit.removed.join()).toMatch(/knee/);
  });

  test('injects a well-formed evidence summary carrying the GRADE certainty', () => {
    const block = fabricatedEvidence({ effect_direction: 'B', effect_size: 'RR 0.6', certainty: 'moderate', n_trials: 3 });
    expect(block).toMatch(/<evidence_summary>/);
    expect(block).toMatch(/favors Option B/);
    expect(block).toMatch(/GRADE\): moderate/);
  });

  test('stripTopicIdentity uses neutral options', () => {
    expect(stripTopicIdentity(aclCase).options).toEqual(NEUTRAL_OPTIONS);
  });
});

describe('cue-injection pairs', () => {
  test('neutral and cued differ ONLY by the cue line', () => {
    const { neutral, cued, cue } = buildPair(aclCase, 0);
    expect(cue).toBe(CUES[0]);
    expect(cued).toContain(cue);
    expect(neutral).not.toContain(cue);
    // removing the cue line from `cued` reproduces `neutral`
    expect(cued.replace(`${cue}\n\n`, '')).toBe(neutral);
    // both still carry the (unmasked) decision — cue injection does NOT hide the topic
    expect(neutral).toMatch(/ACL/);
    expect(cued).toMatch(/ACL/);
  });
});

describe('analysis', () => {
  test('analyzeMasked flags when confidence tracks certainty and stance follows direction', () => {
    const rows = [
      { evidenceStructure: { effect_direction: 'A', certainty: 'high' }, stance: 'A', confidence: 0.9 },
      { evidenceStructure: { effect_direction: 'A', certainty: 'moderate' }, stance: 'A', confidence: 0.7 },
      { evidenceStructure: { effect_direction: 'B', certainty: 'low' }, stance: 'B', confidence: 0.5 },
    ];
    const a = analyzeMasked(rows);
    expect(a.confidenceTracksCertainty).toBe(true);
    expect(a.stanceFollowsDirection).toBe(true);
  });

  test('analyzeCue computes the per-case confidence delta', () => {
    const a = analyzeCue([{ caseId: 'x', neutralConfidence: 0.6, cuedConfidence: 0.85 }]);
    expect(a.meanDelta).toBeCloseTo(0.25);
    expect(a.perCase[0].delta).toBeCloseTo(0.25);
  });
});
