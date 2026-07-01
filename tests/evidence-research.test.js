/**
 * Pure-unit tests for the Phase 2.5 claim-grounded evidence path (no DB, no live LLM — fits the
 * no-DATABASE_URL test env). Covers the STRICT acceptance rule, enum mapping + degraded defaults,
 * claim-grounding (claim_text drawn from the panel's own reasoning, never invented), supports_stance
 * balance across a contested panel, storeEvidenceCitations shape/no-op, and the no-feedback guard
 * (the evidence path never mutates the panel input).
 */
import { describe, test, expect, afterAll } from '@jest/globals';
import {
  isAccepted,
  deriveClaims,
  buildEvidenceForPanel,
  toLedgerEntries,
  storeEvidenceCitations,
  _resetEvidenceCache,
} from '../src/utils/evidence-research.js';

/** Stub LLM: .withStructuredOutput().invoke() resolves to the canned structured result. */
function stubLLM(canned) {
  return {
    withStructuredOutput() {
      return { invoke: async () => canned };
    },
  };
}

/** Fake ResearchAgent exposing only curateRelevantStudies, returning canned citations. */
function fakeResearchAgent(citations) {
  return { curateRelevantStudies: async () => ({ success: true, citations }) };
}

/** Stub LLM that records the messages passed to invoke (for prompt-content assertions). */
function recordingLLM(canned) {
  const seen = {};
  const llm = {
    withStructuredOutput() {
      return {
        invoke: async (messages) => {
          seen.messages = messages;
          return canned;
        },
      };
    },
    seen,
  };
  return llm;
}

/** Recording fake `sql` tag — captures the bound values of each tagged-template call. */
function fakeSql() {
  const calls = [];
  const tag = async (_strings, ...values) => {
    calls.push(values);
    return [];
  };
  tag.calls = calls;
  return tag;
}

const CONTESTED_PERDP = {
  decisionPoint: { id: 'dp1', question: 'Rehab or surgery for this ACL tear?', options: ['Structured rehab', 'Reconstruction'] },
  verdict: 'contested',
  positions: [
    { specialistType: 'strengthSage', finalStance: 'Reconstruction', reasoning: 'high instability favors reconstruction' },
    { specialistType: 'movementDetective', finalStance: 'Structured rehab', reasoning: 'low demand favors rehab' },
  ],
  splitSummary: {
    verdict: 'contested',
    distinctStances: ['Structured rehab', 'Reconstruction'],
    sides: [
      { stance: 'Structured rehab', specialists: [{ reasoning: 'low demand favors rehab' }] },
      { stance: 'Reconstruction', specialists: [{ reasoning: 'high instability favors reconstruction' }] },
    ],
  },
};

describe('isAccepted — strict acceptance rule (grade × population × study_type)', () => {
  test('high / match / rct → accepted', () => {
    expect(isAccepted({ evidenceGrade: 'high', populationMatch: 'match', studyType: 'rct' })).toBe(true);
  });
  test('moderate / partial / cohort → accepted (boundary)', () => {
    expect(isAccepted({ evidenceGrade: 'moderate', populationMatch: 'partial', studyType: 'cohort' })).toBe(true);
  });
  test('low grade → rejected', () => {
    expect(isAccepted({ evidenceGrade: 'low', populationMatch: 'match', studyType: 'rct' })).toBe(false);
  });
  test('population mismatch → rejected', () => {
    expect(isAccepted({ evidenceGrade: 'high', populationMatch: 'mismatch', studyType: 'rct' })).toBe(false);
  });
  test('population unknown → rejected', () => {
    expect(isAccepted({ evidenceGrade: 'high', populationMatch: 'unknown', studyType: 'rct' })).toBe(false);
  });
  test('case_series study type → rejected', () => {
    expect(isAccepted({ evidenceGrade: 'high', populationMatch: 'match', studyType: 'case_series' })).toBe(false);
  });
});

describe('deriveClaims — panel-grounded per-stance claims', () => {
  test('contested: both sides → option_a/option_b claims grounded in side reasoning', () => {
    const { optionALabel, optionBLabel, claims } = deriveClaims(CONTESTED_PERDP);
    expect(optionALabel).toBe('Structured rehab');
    expect(optionBLabel).toBe('Reconstruction');
    expect(claims.option_a.claimText).toContain('low demand favors rehab');
    expect(claims.option_b.claimText).toContain('high instability');
  });

  test('converged: only the modal stance gets a claim, grounded in positions reasoning', () => {
    const converged = {
      decisionPoint: { id: 'dp2', question: 'Operate this displaced fracture?', options: ['Nonoperative', 'Surgery'] },
      verdict: 'converged',
      positions: [{ specialistType: 'strengthSage', finalStance: 'Surgery', reasoning: 'displaced intra-articular' }],
      splitSummary: { verdict: 'converged', distinctStances: ['Surgery'], sides: null },
    };
    const { claims } = deriveClaims(converged);
    expect(claims.option_a).toBeUndefined();
    expect(claims.option_b.claimText).toContain('displaced intra-articular');
  });
});

describe('buildEvidenceForPanel — classification, mapping, grounding, balance', () => {
  test('no research agent → []', async () => {
    expect(await buildEvidenceForPanel(null, { perDP: CONTESTED_PERDP })).toEqual([]);
  });

  test('no citations → []', async () => {
    const rows = await buildEvidenceForPanel(fakeResearchAgent([]), { perDP: CONTESTED_PERDP, llm: stubLLM({ classifications: [] }) });
    expect(rows).toEqual([]);
  });

  test('balanced contested panel: one citation per stance, accepted, claim_text grounded', async () => {
    const citations = [
      { pmid: '111', title: 'RCT of rehab', studyType: 'Randomized Controlled Trial', abstract: 'a' },
      { pmid: '222', title: 'Cohort of reconstruction', studyType: 'Other', abstract: 'b' },
    ];
    const canned = {
      classifications: [
        { ref: 1, supportsStance: 'option_a', studyType: 'rct', evidenceGrade: 'high', populationMatch: 'match', rationale: 'rehab non-inferior' },
        { ref: 2, supportsStance: 'option_b', studyType: 'cohort', evidenceGrade: 'moderate', populationMatch: 'partial', rationale: 'recon better stability' },
      ],
    };
    const rows = await buildEvidenceForPanel(fakeResearchAgent(citations), { perDP: CONTESTED_PERDP, llm: stubLLM(canned) });
    expect(rows).toHaveLength(2);
    // balance: one option_a, one option_b
    expect(rows.map((r) => r.supportsStance).sort()).toEqual(['option_a', 'option_b']);
    // both clear the strict bar
    expect(rows.every((r) => r.accepted)).toBe(true);
    // claim_text is grounded in the PANEL reasoning, NOT the LLM rationale
    const a = rows.find((r) => r.supportsStance === 'option_a');
    expect(a.claimText).toContain('low demand favors rehab');
    expect(a.claimText).not.toContain('rehab non-inferior');
    expect(a.pmid).toBe('111');
  });

  test('degraded path (LLM returns nothing): hint-derived study_type, population unknown → not accepted, abstain claim=question', async () => {
    const citations = [{ pmid: '333', title: 'A review', studyType: 'Review', abstract: 'c' }];
    const rows = await buildEvidenceForPanel(fakeResearchAgent(citations), { perDP: CONTESTED_PERDP, llm: stubLLM({ classifications: [] }) });
    expect(rows).toHaveLength(1);
    expect(rows[0].studyType).toBe('expert_opinion'); // Review → expert_opinion hint
    expect(rows[0].populationMatch).toBe('unknown');
    expect(rows[0].accepted).toBe(false);
    expect(rows[0].supportsStance).toBe('abstain');
    expect(rows[0].claimText).toBe(CONTESTED_PERDP.decisionPoint.question);
  });

  test('population strictness mode is wired by decision_type (lenient for which_operation)', async () => {
    const citations = [{ pmid: '777', title: 'graft MA', studyType: 'Meta-Analysis', abstract: 'g' }];
    const canned = { classifications: [{ ref: 1, supportsStance: 'option_a', studyType: 'meta_analysis', evidenceGrade: 'high', populationMatch: 'partial', rationale: 'r' }] };

    const lenientLLM = recordingLLM(canned);
    await buildEvidenceForPanel(fakeResearchAgent(citations), { perDP: CONTESTED_PERDP, decisionType: 'which_operation', llm: lenientLLM });
    expect(JSON.stringify(lenientLLM.seen.messages)).toContain('LENIENT');

    const strictLLM = recordingLLM(canned);
    await buildEvidenceForPanel(fakeResearchAgent(citations), { perDP: CONTESTED_PERDP, decisionType: 'conservative_vs_operative', llm: strictLLM });
    expect(JSON.stringify(strictLLM.seen.messages)).toContain('STRICT');
  });

  test('population-mode card → LENIENT regardless of decision_type (so a population card is not starved of a ledger)', async () => {
    const citations = [{ pmid: '888', title: 'op-vs-nonop RCT', studyType: 'Randomized Controlled Trial', abstract: 'a' }];
    const canned = { classifications: [{ ref: 1, supportsStance: 'option_a', studyType: 'rct', evidenceGrade: 'high', populationMatch: 'partial', rationale: 'r' }] };

    // A normally-STRICT decision type, but the panel ran at population level → lenient matching.
    const popLLM = recordingLLM(canned);
    await buildEvidenceForPanel(fakeResearchAgent(citations), {
      perDP: CONTESTED_PERDP, decisionType: 'conservative_vs_operative', population: true, llm: popLLM,
    });
    expect(JSON.stringify(popLLM.seen.messages)).toContain('LENIENT');
  });

  test('LLM throwing → rows still persist with defaults (best-effort, never throws)', async () => {
    const throwing = { withStructuredOutput() { return { invoke: async () => { throw new Error('boom'); } }; } };
    const citations = [{ pmid: '444', title: 'X', studyType: 'Meta-Analysis', abstract: 'd' }];
    const rows = await buildEvidenceForPanel(fakeResearchAgent(citations), { perDP: CONTESTED_PERDP, llm: throwing });
    expect(rows).toHaveLength(1);
    expect(rows[0].studyType).toBe('meta_analysis');
    expect(rows[0].accepted).toBe(false); // population unknown on the degraded path
  });
});

describe('toLedgerEntries — card shows accepted only', () => {
  test('filters to accepted rows and projects card fields', () => {
    const rows = [
      { accepted: true, pmid: '1', title: 't', studyType: 'rct', evidenceGrade: 'high', populationMatch: 'match', supportsStance: 'option_a', claimText: 'c', rationale: 'r' },
      { accepted: false, pmid: '2', title: 'u', studyType: 'case_series', evidenceGrade: 'low', populationMatch: 'mismatch', supportsStance: 'abstain', claimText: 'q', rationale: 'r2' },
    ];
    const ledger = toLedgerEntries(rows);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].pmid).toBe('1');
    expect(ledger[0]).not.toHaveProperty('accepted');
  });
});

describe('storeEvidenceCitations — best-effort persistence', () => {
  test('null sql → 0 (no-op)', async () => {
    expect(await storeEvidenceCitations(null, 1, [{ claimText: 'c' }])).toBe(0);
  });
  test('empty rows → 0 (no-op)', async () => {
    expect(await storeEvidenceCitations(fakeSql(), 1, [])).toBe(0);
  });
  test('inserts one row per citation, binding panel_run_id', async () => {
    const sql = fakeSql();
    const rows = [
      { supportsStance: 'option_a', claimText: 'c1', pmid: '1', title: 't1', studyType: 'rct', evidenceGrade: 'high', populationMatch: 'match', accepted: true, rationale: 'r' },
      { supportsStance: 'abstain', claimText: 'c2', pmid: '2', title: 't2', studyType: 'cohort', evidenceGrade: 'moderate', populationMatch: 'partial', accepted: false, rationale: null },
    ];
    const stored = await storeEvidenceCitations(sql, 42, rows);
    expect(stored).toBe(2);
    expect(sql.calls).toHaveLength(2);
    expect(sql.calls[0][0]).toBe(42); // first bound value is panelRunId
  });
});

describe('no-feedback guard — evidence path never mutates the panel input', () => {
  test('buildEvidenceForPanel leaves perDP (verdict/positions/splitSummary) untouched', async () => {
    const perDP = JSON.parse(JSON.stringify(CONTESTED_PERDP));
    const before = JSON.stringify(perDP);
    const citations = [{ pmid: '999', title: 'Y', studyType: 'Randomized Controlled Trial', abstract: 'e' }];
    await buildEvidenceForPanel(fakeResearchAgent(citations), {
      perDP,
      llm: stubLLM({ classifications: [{ ref: 1, supportsStance: 'option_b', studyType: 'rct', evidenceGrade: 'high', populationMatch: 'match', rationale: 'r' }] }),
    });
    expect(JSON.stringify(perDP)).toBe(before);
  });
});

afterAll(() => _resetEvidenceCache());
