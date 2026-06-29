/**
 * Unit tests for getEquipoiseCardsByConsultation — the read path behind
 * GET /consultation/:consultationId/equipoise-cards (no DB; sql stubbed).
 */
import { describe, test, expect } from '@jest/globals';
import { getEquipoiseCardsByConsultation } from '../src/utils/synthesizer.js';

/** Fake `sql` tag that resolves to canned rows and records the bound values + template strings. */
function fakeSql(rows) {
  const calls = [];
  const queries = [];
  const tag = async (strings, ...values) => {
    calls.push(values);
    queries.push(strings.join('?'));
    return rows;
  };
  tag.calls = calls;
  tag.queries = queries;
  return tag;
}

describe('getEquipoiseCardsByConsultation', () => {
  test('null sql → [] (no-op)', async () => {
    expect(await getEquipoiseCardsByConsultation(null, 'c1')).toEqual([]);
  });

  test('missing consultationId → [] (guard)', async () => {
    expect(await getEquipoiseCardsByConsultation(fakeSql([]), '')).toEqual([]);
  });

  test('maps card_json out of the rows and binds the consultationId', async () => {
    const sql = fakeSql([{ card_json: { verdict: 'contested' } }, { card_json: { verdict: 'converged' } }]);
    const cards = await getEquipoiseCardsByConsultation(sql, 'consultation_42');
    expect(cards).toEqual([{ verdict: 'contested' }, { verdict: 'converged' }]);
    expect(sql.calls[0][0]).toBe('consultation_42'); // first bound value is the consultationId
  });

  test('filters out null card_json rows', async () => {
    const sql = fakeSql([{ card_json: { verdict: 'contested' } }, { card_json: null }]);
    expect(await getEquipoiseCardsByConsultation(sql, 'c1')).toEqual([{ verdict: 'contested' }]);
  });

  test('DB error → [] (best-effort, never throws)', async () => {
    const throwing = async () => { throw new Error('boom'); };
    expect(await getEquipoiseCardsByConsultation(throwing, 'c1')).toEqual([]);
  });

  test('excludes collapsed (suppressed non-binary) cards from the clinician view', async () => {
    const sql = fakeSql([{ card_json: { verdict: 'contested' } }]);
    await getEquipoiseCardsByConsultation(sql, 'c1');
    expect(sql.queries[0]).toMatch(/so\.collapsed\s*=\s*false/);
  });
});
