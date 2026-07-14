/**
 * Transport retry wrapper — transient failures retry, non-transient throw immediately.
 */
import { withRetry, createBatchIdempotent } from '../validation/transport.js';

/** Minimal fake of the Anthropic batches client for createBatchIdempotent. */
function fakeClient({ createBehavior, listData = [] }) {
  let call = 0;
  return {
    beta: { messages: { batches: {
      create: async () => { const r = createBehavior(call++); if (r instanceof Error) throw r; return r; },
      list: async () => ({ data: listData }),
    } } },
  };
}
const err = (status, message) => { const e = new Error(message || 'x'); if (status) e.status = status; return e; };
const rc = (n) => ({ request_counts: { succeeded: n } });

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

describe('createBatchIdempotent', () => {
  test('adopts a phantom batch created despite a premature-close (no duplicate create)', async () => {
    // create throws premature-close; a NEW batch with the matching request count now exists → adopt it.
    const client = fakeClient({
      createBehavior: () => err(400, 'Invalid response body ... Premature close'),
      listData: [{ id: 'msgbatch_phantom', ...rc(912) }],
    });
    // before-snapshot lists the same data, so we must distinguish new vs old by NOT pre-including it:
    // simulate emptiness at snapshot time by making the first list empty, then populated.
    let listCall = 0;
    client.beta.messages.batches.list = async () => ({ data: listCall++ === 0 ? [] : [{ id: 'msgbatch_phantom', ...rc(912) }] });
    const id = await createBatchIdempotent(client, new Array(912), { tries: 3, baseMs: 1 });
    expect(id).toBe('msgbatch_phantom');
  });

  test('retries a 502 with no phantom, then succeeds', async () => {
    const client = fakeClient({
      createBehavior: (n) => (n === 0 ? err(502, 'bad gateway') : { id: 'msgbatch_ok' }),
      listData: [], // no phantom ever
    });
    const id = await createBatchIdempotent(client, new Array(10), { tries: 4, baseMs: 1 });
    expect(id).toBe('msgbatch_ok');
  });

  test('gives up and throws when create keeps failing and no phantom appears', async () => {
    const client = fakeClient({ createBehavior: () => err(502, 'bad gateway'), listData: [] });
    await expect(createBatchIdempotent(client, new Array(5), { tries: 2, baseMs: 1 })).rejects.toThrow('bad gateway');
  });
});
