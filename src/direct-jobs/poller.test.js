import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const memory = vi.hoisted(() => new Map());
vi.mock('../core/store.js', () => ({
  getInstallationId: () => memory.get('installationId') ?? null,
  setInstallationId: (id) => memory.set('installationId', id),
  getPrintAgentLink: () => memory.get('link') ?? null,
  setPrintAgentLink: (link) => (link ? memory.set('link', link) : memory.delete('link')),
  getDirectJobsState: () => memory.get('directJobsState') ?? null,
  setDirectJobsState: (state) => memory.set('directJobsState', JSON.parse(JSON.stringify(state))),
}));

const getSystemPrinters = vi.hoisted(() => vi.fn());
vi.mock('../printing/printer-manager.js', () => ({ getSystemPrinters }));

const printing = vi.hoisted(() => ({
  printReceipt: vi.fn(),
  printInvoice: vi.fn(),
  printOrder: vi.fn(),
  printOrderUpdate: vi.fn(),
}));
vi.mock('../printing/index.js', () => printing);

const linkA = { token: 'token-a', apiBaseUrl: 'https://api.mesanube.ar', agentId: 'agent-1', organizationId: 'org-1', locationId: 'loc-1', registerId: null };
const linkB = { ...linkA, token: 'token-b', agentId: 'agent-2' };

const json = (status, data = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

// A scriptable server. `script.poll` and `script.ack`/`fail` return a response
// (or a promise of one) and may throw to simulate a network error.
let script;
let calls;
let fetchImpl;

const makeEnv = async () => {
  vi.resetModules();
  const linkStore = await import('./link-store.js');
  const linkStatus = await import('./link-status.js');
  const { createPoller } = await import('./poller.js');
  const { resetJobDedup } = await import('../printing/job-dedup.js');
  resetJobDedup();
  return { linkStore, linkStatus, createPoller };
};

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const pollCalls = () => calls.filter((c) => c.path === 'poll');
const order = (id) => ({ jobId: id, kind: 'kitchen', endpoint: 'order', body: { kitchenTicketId: id, printerName: 'Cocina' } });
const receipt = (id) => ({ jobId: id, kind: 'receipt', endpoint: 'receipt', body: { jobId: id, printerName: 'Caja' } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  memory.clear();
  vi.clearAllMocks();
  for (const fn of Object.values(printing)) fn.mockReset();
  getSystemPrinters.mockReset();
  getSystemPrinters.mockResolvedValue([{ name: 'Caja', isDefault: true }, { name: 'Cocina' }]);
  calls = [];
  script = {
    poll: () => json(200, { jobs: [] }),
    ack: () => json(200, { confirmed: true }),
    fail: () => json(200, {}),
  };
  fetchImpl = vi.fn(async (url, init) => {
    const path = url.split('/v1/print-agents/')[1];
    const body = JSON.parse(init.body);
    calls.push({ path, body, url, headers: init.headers, at: Date.now() });
    return script[path.replace('jobs/', '')](body);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const startLinked = async (link = linkA) => {
  const env = await makeEnv();
  env.linkStore.saveLink(link);
  const poller = env.createPoller({ fetchImpl, version: '1.9.2', hostname: 'PC-CAJA' });
  poller.start();
  return { ...env, poller };
};

describe('polling request (KTD12)', () => {
  it('Covers R2: polls at start with the printer names, version and hostname, authenticated with the token', async () => {
    const { poller } = await startLinked();
    await tick();
    expect(pollCalls()).toHaveLength(1);
    const [call] = pollCalls();
    expect(call.url).toBe('https://api.mesanube.ar/v1/print-agents/poll');
    expect(call.headers.Authorization).toBe('Bearer token-a');
    expect(call.body).toEqual({ printers: ['Caja', 'Cocina'], version: '1.9.2', hostname: 'PC-CAJA' });
    poller.stop();
  });

  it('polls again 3 seconds later and keeps going', async () => {
    const { poller } = await startLinked();
    await tick();
    await tick(2999);
    expect(pollCalls()).toHaveLength(1);
    await tick(1);
    expect(pollCalls()).toHaveLength(2);
    await tick(3000);
    expect(pollCalls()).toHaveLength(3);
    poller.stop();
  });
});

describe('no overlap', () => {
  it('a slow poll is not overlapped by the next cycle', async () => {
    let release;
    script.poll = () => new Promise((resolve) => { release = () => resolve(json(200, { jobs: [] })); });
    const { poller } = await startLinked();
    await tick(20000);
    expect(pollCalls()).toHaveLength(1);
    release();
    await tick(2999);
    expect(pollCalls()).toHaveLength(1);
    await tick(1);
    expect(pollCalls()).toHaveLength(2);
    poller.stop();
  });

  it('the 3 seconds are measured from the end of the cycle, not from its start', async () => {
    script.poll = () => new Promise((resolve) => setTimeout(() => resolve(json(200, { jobs: [] })), 5000));
    const { poller } = await startLinked();
    await tick(5000); // first cycle ends at t=5s
    await tick(2999); // t=7.999s
    expect(pollCalls()).toHaveLength(1);
    await tick(1); // t=8s
    expect(pollCalls()).toHaveLength(2);
    poller.stop();
  });

  it('the wait also starts after the jobs were printed, not after the poll', async () => {
    script.poll = () => json(200, { jobs: [order('t1')] });
    printing.printOrder.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 4000)));
    const { poller } = await startLinked();
    await tick(4000); // printed, acked: the cycle ends here
    await tick(2999);
    expect(pollCalls()).toHaveLength(1);
    await tick(1);
    expect(pollCalls()).toHaveLength(2);
    poller.stop();
  });
});

describe('printing the received jobs (R1)', () => {
  it('prints the jobs one at a time, in order, acking each', async () => {
    const events = [];
    script.poll = () => json(200, { jobs: [order('t1'), receipt('r1')] });
    script.ack = (body) => { events.push(`ack:${body.jobId}`); return json(200, { confirmed: true }); };
    let releaseFirst;
    printing.printOrder.mockImplementation(() => new Promise((resolve) => {
      events.push('start:t1');
      releaseFirst = () => { events.push('end:t1'); resolve(); };
    }));
    printing.printReceipt.mockImplementation(async () => { events.push('start:r1'); });

    const { poller } = await startLinked();
    await tick();
    expect(events).toEqual(['start:t1']); // the second one waits for the first
    releaseFirst();
    await tick();
    expect(events).toEqual(['start:t1', 'end:t1', 'ack:t1', 'start:r1', 'ack:r1']);
    poller.stop();
  });

  it('a job that fails does not stop the rest of the batch', async () => {
    script.poll = () => json(200, { jobs: [order('t1'), receipt('r1')] });
    printing.printOrder.mockRejectedValueOnce(new Error('paper out'));
    const { poller } = await startLinked();
    await tick();
    expect(printing.printReceipt).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.path === 'jobs/fail').map((c) => c.body.jobId)).toEqual(['t1']);
    expect(calls.filter((c) => c.path === 'jobs/ack').map((c) => c.body.jobId)).toEqual(['r1']);
    poller.stop();
  });
});

describe('lost ack across cycles (KTD8)', () => {
  it('the ack that failed is sent first in the next cycle, before the poll', async () => {
    let jobs = [order('t1')];
    script.poll = () => json(200, { jobs });
    let ackShouldFail = true;
    script.ack = () => {
      if (ackShouldFail) throw new Error('network down');
      return json(200, { confirmed: true });
    };
    const { poller } = await startLinked();
    await tick();
    expect(calls.map((c) => c.path)).toEqual(['poll', 'jobs/ack']);

    ackShouldFail = false;
    jobs = [];
    await tick(3000);
    expect(calls.map((c) => c.path)).toEqual(['poll', 'jobs/ack', 'jobs/ack', 'poll']);
    expect(calls[2].body).toEqual({ jobId: 't1' });

    await tick(3000);
    expect(calls.filter((c) => c.path === 'jobs/ack')).toHaveLength(2); // confirmed: not sent again
    poller.stop();
  });

  it('the same job coming back while the server is still unreachable for acks is not printed twice', async () => {
    script.poll = () => json(200, { jobs: [order('t1')] });
    script.ack = () => { throw new Error('network down'); };
    const { poller } = await startLinked();
    await tick();
    await tick(3000);
    await tick(3000);
    expect(printing.printOrder).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});

describe('errors of the poll (R2, KTD12)', () => {
  it('a network error does not stop the loop: it keeps polling every 3 seconds and recovers', async () => {
    let down = true;
    script.poll = () => {
      if (down) throw new Error('fetch failed');
      return json(200, { jobs: [] });
    };
    const { poller, linkStatus } = await startLinked();
    await tick();
    await tick(3000);
    await tick(3000);
    expect(pollCalls()).toHaveLength(3);
    expect(linkStatus.getLinkState()).toBe('offline');

    down = false;
    await tick(3000);
    expect(pollCalls()).toHaveLength(4);
    expect(linkStatus.getLinkState()).toBe('linked');
    poller.stop();
  });

  it('a 5xx keeps polling and counts as a failed poll', async () => {
    script.poll = () => json(503);
    const { poller, linkStatus } = await startLinked();
    await tick();
    await tick(3000);
    await tick(3000);
    expect(pollCalls()).toHaveLength(3);
    expect(linkStatus.getLinkState()).toBe('offline');
    poller.stop();
  });

  it('a 200 with a body that is not JSON is a network-class error: no success is marked and it keeps polling', async () => {
    script.poll = () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
    const { poller, linkStatus } = await startLinked();
    await tick();
    await tick(3000);
    await tick(3000);
    expect(pollCalls()).toHaveLength(3);
    expect(linkStatus.getLinkState()).toBe('offline');
    poller.stop();
  });

  it('a 401 stops the loop, forgets the link and the state becomes unlinked', async () => {
    script.poll = () => json(401);
    const { poller, linkStore, linkStatus } = await startLinked();
    await tick();
    expect(linkStatus.getLinkState()).toBe('unlinked');
    expect(linkStore.getLink()).toBeNull();
    await tick(30000);
    expect(pollCalls()).toHaveLength(1);
    poller.stop();
  });

  it('after a 401, a new link starts the loop again', async () => {
    script.poll = () => json(401);
    const { poller, linkStore, linkStatus } = await startLinked();
    await tick();
    expect(pollCalls()).toHaveLength(1);

    script.poll = () => json(200, { jobs: [] });
    linkStore.saveLink(linkB);
    await tick();
    expect(pollCalls()).toHaveLength(2);
    expect(pollCalls()[1].headers.Authorization).toBe('Bearer token-b');
    expect(linkStatus.getLinkState()).toBe('linked');
    poller.stop();
  });

  it('a 401 answered to a request sent with a link that was replaced meanwhile does not drop the new link', async () => {
    let answer;
    script.poll = () => new Promise((resolve) => { answer = resolve; });
    const { poller, linkStore } = await startLinked(linkA);
    await tick();
    linkStore.saveLink(linkB); // the browser relinks while the poll of A is in flight
    script.poll = () => json(200, { jobs: [] });
    answer(json(401));
    await tick(3000);
    expect(linkStore.getLink().token).toBe('token-b');
    expect(pollCalls().some((c) => c.headers.Authorization === 'Bearer token-b')).toBe(true);
    poller.stop();
  });

  it('a 403 (blocked organization or location) keeps polling at the normal cadence and is not a success', async () => {
    script.poll = () => json(500);
    const { poller, linkStatus } = await startLinked();
    await tick();
    await tick(3000);
    await tick(3000);
    expect(linkStatus.getLinkState()).toBe('offline');

    script.poll = () => json(403);
    await tick(3000);
    await tick(3000);
    expect(pollCalls()).toHaveLength(5);
    expect(linkStatus.getLinkState()).toBe('offline'); // a success would have put it back to linked
    poller.stop();
  });

  it('a failure listing the printers is not a network error and does not stop the loop', async () => {
    getSystemPrinters.mockRejectedValueOnce(new Error('spooler down'));
    const { poller, linkStatus } = await startLinked();
    await tick();
    expect(pollCalls()).toHaveLength(0);
    await tick(3000);
    expect(pollCalls()).toHaveLength(1);
    expect(linkStatus.getLinkState()).toBe('linked');
    poller.stop();
  });
});

describe('start and stop (R2, U6)', () => {
  it('Covers R2: without a link it does not poll', async () => {
    const env = await makeEnv();
    const poller = env.createPoller({ fetchImpl, version: '1.9.2', hostname: 'PC' });
    poller.start();
    await tick(30000);
    expect(fetchImpl).not.toHaveBeenCalled();
    poller.stop();
  });

  it('a POST /link while running without a link starts polling right away', async () => {
    const env = await makeEnv();
    const poller = env.createPoller({ fetchImpl, version: '1.9.2', hostname: 'PC' });
    poller.start();
    await tick(10000);
    expect(fetchImpl).not.toHaveBeenCalled();
    env.linkStore.saveLink(linkA);
    await tick();
    expect(pollCalls()).toHaveLength(1);
    poller.stop();
  });

  it('a new link while the loop is already running does not start a second loop', async () => {
    const { poller, linkStore } = await startLinked();
    await tick();
    linkStore.saveLink(linkB);
    await tick();
    await tick(3000);
    await tick(3000);
    // One loop: initial poll, then one every 3 s (the relink does not add a parallel one).
    expect(pollCalls()).toHaveLength(3);
    poller.stop();
  });

  it('stop() ends the loop, including the pending wait', async () => {
    const { poller } = await startLinked();
    await tick();
    poller.stop();
    await tick(30000);
    expect(pollCalls()).toHaveLength(1);
  });

  it('stop() also ignores later links', async () => {
    const env = await makeEnv();
    const poller = env.createPoller({ fetchImpl, version: '1.9.2', hostname: 'PC' });
    poller.start();
    poller.stop();
    env.linkStore.saveLink(linkA);
    await tick(10000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an unlink while waiting (link cleared elsewhere) ends the loop without another poll', async () => {
    const { poller, linkStore } = await startLinked();
    await tick();
    linkStore.clearLink();
    await tick(10000);
    expect(pollCalls()).toHaveLength(1);
    poller.stop();
  });
});
