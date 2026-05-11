import { describe, it, expect } from '@jest/globals';
import { consultationSchema } from '../src/schemas/consultation.js';
import { caseDataSchema } from '../src/schemas/case-data.js';

const minimalCaseData = { primaryComplaint: 'knee pain' };

describe('caseDataSchema — priorConsultations', () => {
  it('accepts a number', () => {
    const result = caseDataSchema.safeParse({ ...minimalCaseData, priorConsultations: 3 });
    expect(result.success).toBe(true);
  });

  it('accepts an empty array (frontend default)', () => {
    const result = caseDataSchema.safeParse({ ...minimalCaseData, priorConsultations: [] });
    expect(result.success).toBe(true);
  });

  it('accepts an array of items', () => {
    const result = caseDataSchema.safeParse({ ...minimalCaseData, priorConsultations: [{ id: 'abc' }] });
    expect(result.success).toBe(true);
  });

  it('rejects a negative number', () => {
    const result = caseDataSchema.safeParse({ ...minimalCaseData, priorConsultations: -1 });
    expect(result.success).toBe(false);
  });
});

describe('caseDataSchema — platformContext', () => {
  it('accepts platformContext nested in caseData', () => {
    const result = caseDataSchema.safeParse({
      ...minimalCaseData,
      platformContext: { source: 'web_app', version: '1.0.0' },
    });
    expect(result.success).toBe(true);
  });
});

describe('consultationSchema — comprehensive upgrade payload shape', () => {
  const payload = {
    caseData: {
      primaryComplaint: 'right knee pain after running',
      rawQuery: 'I have right knee pain after running',
      enableDualTrack: true,
      priorConsultations: [],          // frontend always sends empty array
      isReturningUser: false,
      userId: '12345',
      platformContext: { source: 'web_app', version: '1.0.0' },
      symptoms: 'right knee symptoms',
      painLevel: 6,
      duration: 'acute',
      age: 30,
      location: 'right knee',
    },
    mode: 'normal',
  };

  it('accepts the standard comprehensive-upgrade payload', () => {
    const result = consultationSchema.safeParse(payload);
    if (!result.success) {
      console.error('Zod issues:', JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('accepts an optional queryType', () => {
    const result = consultationSchema.safeParse({ ...payload, queryType: 'clinical' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown top-level field (strict enforcement)', () => {
    const result = consultationSchema.safeParse({ ...payload, unknownField: 'boom' });
    expect(result.success).toBe(false);
  });
});
