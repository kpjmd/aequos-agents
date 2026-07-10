/**
 * Transport retry wrapper — transient failures retry, non-transient throw immediately.
 */
import { withRetry } from '../validation/transport.js';

describe('withRetry', () => {
  test('retries a transient (502) failure then succeeds', async () => {
    let calls = 0;
    const fn = async () => { calls++; if (calls < 3) { const e = new Error('bad gateway'); e.status = 502; throw e; } return 'ok'; };
    const r = await withRetry(fn, { tries: 5, baseMs: 1, label: 'test' });
    expect(r).toBe('ok');
    expect(calls).toBe(3);
  });

  test('throws immediately on a non-transient (401) error', async () => {
    let calls = 0;
    const fn = async () => { calls++; const e = new Error('unauthorized'); e.status = 401; throw e; };
    await expect(withRetry(fn, { tries: 5, baseMs: 1 })).rejects.toThrow('unauthorized');
    expect(calls).toBe(1);
  });

  test('gives up after the last try and rethrows', async () => {
    let calls = 0;
    const fn = async () => { calls++; const e = new Error('overloaded'); e.status = 529; throw e; };
    await expect(withRetry(fn, { tries: 3, baseMs: 1 })).rejects.toThrow('overloaded');
    expect(calls).toBe(3);
  });

  test('network errors (no status) are treated as transient', async () => {
    let calls = 0;
    const fn = async () => { calls++; if (calls < 2) throw new Error('ECONNRESET'); return 42; };
    expect(await withRetry(fn, { tries: 4, baseMs: 1 })).toBe(42);
  });
});
