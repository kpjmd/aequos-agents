/**
 * Pure-unit tests for the Phase 2c production slug-classifier (no DB, no live LLM — fits the
 * no-DATABASE_URL test env). Covers the anchoring rule (normalizeResult: anchor only on exact +
 * a real catalog slug; surface nearMissSlug on related; downgrade hallucinated slugs) and the
 * end-to-end classifyDecisionPoint path with a stubbed structured-output LLM.
 */
import { describe, test, expect, afterAll } from '@jest/globals';
import { classifyDecisionPoint, normalizeResult, _resetClassifierCache } from '../src/utils/dp-classifier.js';

const CATALOG = [
  { slug: 'acl-recon-vs-rehab', decision_type: 'conservative_vs_operative', canonical_question: 'In an active adult with an ACL tear, is reconstruction or structured rehab preferred?', option_a_label: 'Structured rehab', option_b_label: 'Reconstruction' },
  { slug: 'acl-graft-choice', decision_type: 'which_operation', canonical_question: 'In an adult undergoing ACL reconstruction, is BTB autograft or hamstring autograft preferred?', option_a_label: 'BTB autograft', option_b_label: 'Hamstring autograft' },
  { slug: 'proximal-humerus-3-4-part-elderly', decision_type: 'conservative_vs_operative', canonical_question: 'In an older adult with a displaced 3- or 4-part proximal humerus fracture, is nonoperative management or surgery preferred?', option_a_label: 'Nonoperative management', option_b_label: 'Surgical management' },
];
const SLUGS = new Set(CATALOG.map((r) => r.slug));

/** Stub LLM: .withStructuredOutput().invoke() resolves to the canned structured result. */
function stubLLM(canned) {
  return {
    withStructuredOutput() {
      return { invoke: async () => canned };
    },
  };
}

describe('normalizeResult — anchoring rule', () => {
  test('exact + real slug → anchors', () => {
    expect(normalizeResult({ matchQuality: 'exact', slug: 'acl-recon-vs-rehab', reasoning: 'r' }, SLUGS))
      .toEqual({ slug: 'acl-recon-vs-rehab', matchQuality: 'exact', nearMissSlug: null, reasoning: 'r' });
  });

  test('related → never anchors, surfaces nearMissSlug', () => {
    expect(normalizeResult({ matchQuality: 'related', slug: 'acl-graft-choice', reasoning: 'diff fork' }, SLUGS))
      .toEqual({ slug: null, matchQuality: 'related', nearMissSlug: 'acl-graft-choice', reasoning: 'diff fork' });
  });

  test('none → null', () => {
    expect(normalizeResult({ matchQuality: 'none', slug: null, reasoning: 'nothing' }, SLUGS))
      .toEqual({ slug: null, matchQuality: 'none', nearMissSlug: null, reasoning: 'nothing' });
  });

  test('exact but hallucinated/unknown slug → downgraded to none (guard)', () => {
    expect(normalizeResult({ matchQuality: 'exact', slug: 'not-in-catalog', reasoning: 'made up' }, SLUGS))
      .toEqual({ slug: null, matchQuality: 'none', nearMissSlug: null, reasoning: 'made up' });
  });

  test('related with unknown slug → related but no near-miss recorded', () => {
    expect(normalizeResult({ matchQuality: 'related', slug: 'ghost', reasoning: 'r' }, SLUGS))
      .toEqual({ slug: null, matchQuality: 'related', nearMissSlug: null, reasoning: 'r' });
  });
});

describe('classifyDecisionPoint — end to end (stubbed LLM)', () => {
  test('empty catalog → none without invoking the LLM', async () => {
    const out = await classifyDecisionPoint({ question: 'A vs B?', options: ['A', 'B'] }, [], stubLLM(null));
    expect(out).toEqual({ slug: null, matchQuality: 'none', nearMissSlug: null, reasoning: null });
  });

  test('missing question → none (guard)', async () => {
    const out = await classifyDecisionPoint({ options: ['A', 'B'] }, CATALOG, stubLLM({ matchQuality: 'exact', slug: 'acl-recon-vs-rehab' }));
    expect(out.matchQuality).toBe('none');
    expect(out.slug).toBeNull();
  });

  test('exact match flows through', async () => {
    const dp = { id: 'acl-q', question: 'Should this ACL be reconstructed or rehabbed?', options: ['Reconstruct', 'Rehab'] };
    const out = await classifyDecisionPoint(dp, CATALOG, stubLLM({ matchQuality: 'exact', slug: 'acl-recon-vs-rehab', reasoning: 'same condition + operative-vs-nonop fork' }));
    expect(out.slug).toBe('acl-recon-vs-rehab');
    expect(out.matchQuality).toBe('exact');
  });

  test('same-condition-different-fork → related near-miss, no anchor', async () => {
    const dp = { id: 'acl-graft', question: 'Which graft for this ACL reconstruction?', options: ['BTB', 'Hamstring'] };
    const out = await classifyDecisionPoint(dp, CATALOG, stubLLM({ matchQuality: 'related', slug: 'acl-recon-vs-rehab', reasoning: 'graft choice, not operate-or-not' }));
    expect(out.slug).toBeNull();
    expect(out.nearMissSlug).toBe('acl-recon-vs-rehab');
  });

  test('LLM throwing → none (best-effort, never throws)', async () => {
    const throwing = { withStructuredOutput() { return { invoke: async () => { throw new Error('boom'); } }; } };
    const out = await classifyDecisionPoint({ question: 'A vs B?', options: ['A', 'B'] }, CATALOG, throwing);
    expect(out).toEqual({ slug: null, matchQuality: 'none', nearMissSlug: null, reasoning: null });
  });

  afterAll(() => _resetClassifierCache());
});
