import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./link-store.js', () => ({ getLink: vi.fn() }));

const { createAgentApi, AgentApiError } = await import('./agent-api.js');

const link = { token: 'token-a', apiBaseUrl: 'https://api.mesanube.ar', agentId: 'agent-1' };
const readLink = () => link;
const TIMEOUT_MS = 15000;

// A response whose body behaves as the test scripts it. `headers` mirrors the
// fetch Headers API for the one header the client reads.
const response = ({ status = 200, json, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: json ?? (async () => ({})),
});

const makeApi = (fetchImpl) => createAgentApi({ fetchImpl, readLink, timeoutMs: TIMEOUT_MS });

// Resolves with the error a promise rejects with, so a test can assert on it.
const rejection = (promise) => promise.then(() => null, (error) => error);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('agent api responses', () => {
  it('parses a normal JSON answer', async () => {
    const fetchImpl = vi.fn(async () => response({ json: async () => ({ jobs: [{ jobId: 'j1' }] }) }));
    await expect(makeApi(fetchImpl).poll({ printers: [], version: '1', hostname: 'h' })).resolves.toEqual({ jobs: [{ jobId: 'j1' }] });
  });

  it('treats an empty 204 as success without reading the body', async () => {
    const json = vi.fn(async () => { throw new SyntaxError('Unexpected end of JSON input'); });
    const fetchImpl = vi.fn(async () => response({ status: 204, json }));
    await expect(makeApi(fetchImpl).ack('j1')).resolves.toEqual({});
    expect(json).not.toHaveBeenCalled();
  });

  it('treats a 200 with content-length 0 as an empty success', async () => {
    const json = vi.fn(async () => { throw new SyntaxError('Unexpected end of JSON input'); });
    const fetchImpl = vi.fn(async () => response({ headers: { 'content-length': '0' }, json }));
    await expect(makeApi(fetchImpl).ack('j1')).resolves.toEqual({});
  });

  it('a 200 whose body is not JSON is a network-class AgentApiError (status null), not an empty success', async () => {
    const fetchImpl = vi.fn(async () => response({ json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } }));
    const error = await rejection(makeApi(fetchImpl).poll({ printers: [], version: '1', hostname: 'h' }));
    expect(error).toBeInstanceOf(AgentApiError);
    expect(error.status).toBeNull();
    expect(error.token).toBe('token-a');
  });

  it('a truncated body is also a network-class AgentApiError', async () => {
    const fetchImpl = vi.fn(async () => response({ json: async () => { throw new TypeError('terminated'); } }));
    const error = await rejection(makeApi(fetchImpl).fail({ jobId: 'j1', code: 'X', error: 'e' }));
    expect(error).toBeInstanceOf(AgentApiError);
    expect(error.status).toBeNull();
  });

  it('a body that stalls is aborted by the request timeout and becomes a status null error', async () => {
    // Headers arrive, the body never does. Any timer cleared before the body
    // is read would leave this hanging forever.
    const fetchImpl = vi.fn(async () => response({ json: () => new Promise(() => {}) }));
    const pending = rejection(makeApi(fetchImpl).poll({ printers: [], version: '1', hostname: 'h' }));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);

    const error = await pending;
    expect(error).toBeInstanceOf(AgentApiError);
    expect(error.status).toBeNull();
  });

  it('a body that stalls on a real abortable stream is aborted by the timeout', async () => {
    const fetchImpl = vi.fn(async (_url, { signal }) => response({
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
      }),
    }));
    const pending = rejection(makeApi(fetchImpl).poll({ printers: [], version: '1', hostname: 'h' }));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);

    const error = await pending;
    expect(error).toBeInstanceOf(AgentApiError);
    expect(error.status).toBeNull();
  });

  it('a body that arrives before the timeout is not aborted', async () => {
    const fetchImpl = vi.fn(async () => response({
      json: () => new Promise((resolve) => setTimeout(() => resolve({ jobs: [] }), TIMEOUT_MS - 1000)),
    }));
    const pending = makeApi(fetchImpl).poll({ printers: [], version: '1', hostname: 'h' });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1000);
    await expect(pending).resolves.toEqual({ jobs: [] });
  });

  it('keeps the status of a non 2xx answer', async () => {
    const fetchImpl = vi.fn(async () => response({ status: 401 }));
    const error = await rejection(makeApi(fetchImpl).poll({ printers: [], version: '1', hostname: 'h' }));
    expect(error).toBeInstanceOf(AgentApiError);
    expect(error.status).toBe(401);
    expect(error.token).toBe('token-a');
  });

  it('a network failure of fetch is a status null error', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const error = await rejection(makeApi(fetchImpl).poll({ printers: [], version: '1', hostname: 'h' }));
    expect(error).toBeInstanceOf(AgentApiError);
    expect(error.status).toBeNull();
  });
});
