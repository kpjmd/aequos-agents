/**
 * Grounding module — query derivation, evidence-table normalization, grounded prompt injection.
 * Uses an injected fake ResearchAgent so there is NO network / model call in tests.
 */
import { buildGroundingQuery, buildEvidenceTable } from '../grounding/build.js';
import { groundedPrompt, renderEvidenceTable } from '../grounding/prompt.js';

const caseObj = {
  id: 'acl-graft-choice',
  decision_point: 'ACL reconstruction graft: autograft vs allograft',
  options: ['Autograft', 'Allograft'],
  provenance: { legacy_body_region: 'knee' },
};

describe('buildGroundingQuery', () => {
  test('derives a structured query from the case', () => {
    const q = buildGroundingQuery(caseObj);
    expect(q.rawQuery).toContain('ACL');
    expect(q.procedure).toBe('Autograft vs Allograft');
    expect(q.bodyPart).toBe('knee');
  });
});

describe('buildEvidenceTable', () => {
  const fakeAgent = {
    async curateRelevantStudies(query, tier) {
      return {
        success: true,
        totalFound: 2,
        searchQuery: '(anterior cruciate ligament) AND (graft)',
        intro: 'Evidence is mixed on graft choice.',
        citations: [
          { pmid: '1', title: 'RCT of grafts', journal: 'AJSM', year: 2020, studyType: 'RCT', evidenceGrade: 'A', combinedScore: 8, extra: 'dropme' },
          { pmid: '2', title: 'Cohort study', journal: 'KSSTA', year: 2019, studyType: 'cohort', evidenceGrade: 'B', combinedScore: 6 },
        ],
        _tier: tier,
      };
    },
  };

  test('normalizes citations and computes the most-favorable overall grade', async () => {
    const table = await buildEvidenceTable(caseObj, fakeAgent, { tier: 'premium' });
    expect(table.caseId).toBe('acl-graft-choice');
    expect(table.citations).toHaveLength(2);
    expect(table.citations[0].extra).toBeUndefined(); // normalized shape only
    expect(table.overall_grade).toBe('A'); // A beats B
    expect(table.summary).toContain('mixed');
    expect(table.success).toBe(true);
  });

  test('empty result → null overall grade', async () => {
    const empty = { async curateRelevantStudies() { return { success: false, citations: [] }; } };
    const table = await buildEvidenceTable(caseObj, empty);
    expect(table.overall_grade).toBeNull();
    expect(table.citations).toHaveLength(0);
  });
});

describe('groundedPrompt', () => {
  test('injects the evidence table before the stance question', () => {
    const table = { citations: [{ evidenceGrade: 'A', studyType: 'RCT', title: 'X', journal: 'AJSM', year: 2020 }], overall_grade: 'A' };
    const { userPrompt, options } = groundedPrompt(caseObj, table);
    expect(userPrompt).toContain('<evidence_summary>');
    expect(userPrompt).toContain('GRADE A');
    expect(userPrompt.indexOf('<evidence_summary>')).toBeLessThan(userPrompt.indexOf('State whether'));
    expect(options).toEqual(['Autograft', 'Allograft']);
  });

  test('empty/dry-run table renders a placeholder block', () => {
    expect(renderEvidenceTable(null)).toContain('no evidence retrieved');
  });
});
