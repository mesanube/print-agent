import { describe, it, expect, vi, beforeEach } from 'vitest';

const memory = vi.hoisted(() => new Map());
vi.mock('../core/store.js', () => ({
  getDirectJobsState: () => memory.get('directJobsState') ?? null,
  setDirectJobsState: (state) => memory.set('directJobsState', JSON.parse(JSON.stringify(state))),
}));

const printing = vi.hoisted(() => ({
  printReceipt: vi.fn(),
  printInvoice: vi.fn(),
  printOrder: vi.fn(),
  printOrderUpdate: vi.fn(),
}));
vi.mock('../printing/index.js', () => printing);

const { currentBudget } = await import('../printing/worker/time-budget.js');
const { resetJobDedup, isDuplicateJob, recordJob } = await import('../printing/job-dedup.js');
const { runJob, flushPendingAcks } = await import('./job-runner.js');
const printedJobs = await import('./printed-jobs.js');
const { AgentApiError } = await import('./agent-api.js');

const makeApi = () => ({ ack: vi.fn(async () => ({})), fail: vi.fn(async () => ({})) });
const timeoutError = () => Object.assign(new Error('Print order failed: stuck'), { code: 'PRINT_TIMEOUT' });

const orderJob = (id = 'ticket-1') => ({
  jobId: id,
  kind: 'kitchen',
  endpoint: 'order',
  body: { kitchenTicketId: id, order: { n: 1 }, restaurant: { name: 'R' }, printerName: 'Cocina' },
});

beforeEach(() => {
  vi.clearAllMocks();
  memory.clear();
  resetJobDedup();
  for (const fn of Object.values(printing)) fn.mockReset();
});

describe('endpoint to print function (KTD10)', () => {
  it('Covers AE1: a comanda calls printOrder with the received body and the printer name, then acks', async () => {
    const api = makeApi();
    const job = orderJob();
    await runJob(job, api);
    expect(printing.printOrder).toHaveBeenCalledTimes(1);
    const [body, printerName, timing] = printing.printOrder.mock.calls[0];
    expect(body).toBe(job.body);
    expect(printerName).toBe('Cocina');
    expect(typeof timing.mark).toBe('function');
    expect(api.ack).toHaveBeenCalledWith('ticket-1');
    expect(api.fail).not.toHaveBeenCalled();
  });

  it.each([
    ['receipt', 'printReceipt', { jobId: 'j-r', printerName: 'Caja' }],
    ['invoice', 'printInvoice', { jobId: 'j-i', printerName: 'Caja' }],
    ['order-update', 'printOrderUpdate', { type: 'kitchen-update', kitchenTicketId: 'j-u', printerName: 'Cocina' }],
  ])('%s calls %s with the body and the printer name', async (endpoint, fnName, body) => {
    const api = makeApi();
    const jobId = body.jobId || body.kitchenTicketId;
    await runJob({ jobId, endpoint, body }, api);
    expect(printing[fnName]).toHaveBeenCalledTimes(1);
    expect(printing[fnName].mock.calls[0][0]).toBe(body);
    expect(printing[fnName].mock.calls[0][1]).toBe(body.printerName);
    expect(api.ack).toHaveBeenCalledWith(jobId);
  });

  it('prints inside the 9 s time budget, like the HTTP routes', async () => {
    let budget = null;
    printing.printOrder.mockImplementation(async () => { budget = currentBudget(); });
    await runJob(orderJob(), makeApi());
    expect(budget).not.toBeNull();
  });

  it('an unknown endpoint is reported with fail and never printed', async () => {
    const api = makeApi();
    await runJob({ jobId: 'x', endpoint: 'cash-close', body: {} }, api);
    expect(api.fail).toHaveBeenCalledWith({ jobId: 'x', code: 'UNKNOWN_ENDPOINT', error: expect.any(String) });
    expect(api.ack).not.toHaveBeenCalled();
  });
});

describe('print failure (R5, KTD8)', () => {
  it('reports fail with the error code and message, and does not ack', async () => {
    printing.printOrder.mockRejectedValueOnce(Object.assign(new Error('paper out'), { code: 'EPAPER' }));
    const api = makeApi();
    await runJob(orderJob(), api);
    expect(api.fail).toHaveBeenCalledWith({ jobId: 'ticket-1', code: 'EPAPER', error: 'paper out' });
    expect(api.ack).not.toHaveBeenCalled();
  });

  it('PRINT_TIMEOUT is reported with fail, not acked', async () => {
    printing.printOrder.mockRejectedValueOnce(timeoutError());
    const api = makeApi();
    await runJob(orderJob(), api);
    expect(api.fail).toHaveBeenCalledWith({ jobId: 'ticket-1', code: 'PRINT_TIMEOUT', error: 'Print order failed: stuck' });
    expect(api.ack).not.toHaveBeenCalled();
  });

  it('a printer that vanished (error without a code) is reported with fail and a generic code', async () => {
    printing.printReceipt.mockRejectedValueOnce(new Error('Printer "Caja" not found. Available printers: A, B'));
    const api = makeApi();
    await runJob({ jobId: 'r1', endpoint: 'receipt', body: { jobId: 'r1', printerName: 'Caja' } }, api);
    expect(api.fail).toHaveBeenCalledWith({ jobId: 'r1', code: 'PRINT_FAILED', error: 'Printer "Caja" not found. Available printers: A, B' });
    expect(api.ack).not.toHaveBeenCalled();
  });

  it('keeps the error text within the 1000 characters the server accepts', async () => {
    printing.printOrder.mockRejectedValueOnce(new Error('x'.repeat(5000)));
    const api = makeApi();
    await runJob(orderJob(), api);
    expect(api.fail.mock.calls[0][0].error).toHaveLength(1000);
  });

  it('a failed job is not recorded as printed, and when the server offers it again it prints', async () => {
    printing.printOrder.mockRejectedValueOnce(new Error('paper out'));
    const api = makeApi();
    await runJob(orderJob(), api);
    expect(printedJobs.wasJobPrinted('ticket-1')).toBe(false);
    expect(isDuplicateJob('ticket-1')).toBe(false);

    printing.printOrder.mockResolvedValueOnce();
    await runJob(orderJob(), api);
    expect(printing.printOrder).toHaveBeenCalledTimes(2);
    expect(api.ack).toHaveBeenCalledWith('ticket-1');
  });

  it('a failure to report the failure does not throw: the lease expires and the server offers the job again', async () => {
    printing.printOrder.mockRejectedValueOnce(new Error('paper out'));
    const api = makeApi();
    api.fail.mockRejectedValueOnce(new AgentApiError('down'));
    await expect(runJob(orderJob(), api)).resolves.not.toThrow();
  });

  it('a 401 while reporting the failure reaches the caller', async () => {
    printing.printOrder.mockRejectedValueOnce(new Error('paper out'));
    const api = makeApi();
    api.fail.mockRejectedValueOnce(new AgentApiError('revoked', { status: 401, token: 't' }));
    await expect(runJob(orderJob(), api)).rejects.toMatchObject({ status: 401 });
  });
});

describe('lost ack (KTD8)', () => {
  it('Covers F2: an ack that fails leaves the jobId in the queue, and a later flush sends it', async () => {
    const api = makeApi();
    api.ack.mockRejectedValueOnce(new AgentApiError('offline'));
    await runJob(orderJob(), api);
    expect(printedJobs.getPendingAcks()).toEqual(['ticket-1']);

    await flushPendingAcks(api);
    expect(api.ack).toHaveBeenLastCalledWith('ticket-1');
    expect(printedJobs.getPendingAcks()).toEqual([]);
  });

  it('a flush that fails again keeps the jobId queued', async () => {
    const api = makeApi();
    printedJobs.queueAck('ticket-1');
    api.ack.mockRejectedValue(new AgentApiError('offline'));
    await flushPendingAcks(api);
    expect(printedJobs.getPendingAcks()).toEqual(['ticket-1']);
  });

  it('a flush that fails on the first jobId still tries the next ones', async () => {
    const api = makeApi();
    printedJobs.queueAck('a');
    printedJobs.queueAck('b');
    api.ack.mockRejectedValueOnce(new AgentApiError('hiccup'));
    await flushPendingAcks(api);
    expect(api.ack.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(printedJobs.getPendingAcks()).toEqual(['a']);
  });

  it('a flush answered 401 stops and reaches the caller', async () => {
    const api = makeApi();
    printedJobs.queueAck('a');
    api.ack.mockRejectedValueOnce(new AgentApiError('revoked', { status: 401, token: 't' }));
    await expect(flushPendingAcks(api)).rejects.toMatchObject({ status: 401 });
  });

  it('the same job coming back after a lost ack is not printed again, only acked', async () => {
    const api = makeApi();
    api.ack.mockRejectedValueOnce(new AgentApiError('offline'));
    await runJob(orderJob(), api);
    expect(printing.printOrder).toHaveBeenCalledTimes(1);

    await runJob(orderJob(), api);
    expect(printing.printOrder).toHaveBeenCalledTimes(1);
    expect(api.ack).toHaveBeenCalledTimes(2);
    expect(printedJobs.getPendingAcks()).toEqual([]);
  });

  it('after a restart, a jobId printed 2 hours ago and never confirmed comes back: it is acked, not printed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
    printedJobs.markJobPrinted('ticket-1');
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    resetJobDedup(); // the in-memory cache does not survive a restart
    try {
      const api = makeApi();
      await runJob(orderJob(), api);
      expect(printing.printOrder).not.toHaveBeenCalled();
      expect(api.ack).toHaveBeenCalledWith('ticket-1');
      expect(api.fail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a jobId printed more than 24 hours ago is a new job and prints', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    printedJobs.markJobPrinted('ticket-1');
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    resetJobDedup();
    try {
      await runJob(orderJob(), makeApi());
      expect(printing.printOrder).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a successful print is recorded on disk before the ack leaves', async () => {
    const api = makeApi();
    let recordedWhenAcked = null;
    // Captured, not asserted inside: an error thrown by the ack is swallowed by the runner.
    api.ack.mockImplementation(async () => { recordedWhenAcked = printedJobs.wasJobPrinted('ticket-1'); });
    await runJob(orderJob(), api);
    expect(recordedWhenAcked).toBe(true);
  });
});

describe('shared dedup with the HTTP path (R4)', () => {
  it('a jobId the browser route already printed in this process is acked and not printed', async () => {
    recordJob('ticket-1'); // what the HTTP route does for a print it accepted
    const api = makeApi();
    await runJob(orderJob(), api);
    expect(printing.printOrder).not.toHaveBeenCalled();
    expect(api.ack).toHaveBeenCalledWith('ticket-1');
    expect(api.fail).not.toHaveBeenCalled();
  });

  // In production the server jobId equals these body ids; they differ here on
  // purpose so the test proves which field the dedup is keyed by (the one the
  // HTTP routes use).
  it.each([
    ['receipt', 'printReceipt', { jobId: 'body-id', printerName: 'Caja' }, 'body-id'],
    ['invoice', 'printInvoice', { jobId: 'body-id', printerName: 'Caja' }, 'body-id'],
    ['order', 'printOrder', { kitchenTicketId: 'body-id', printerName: 'Cocina' }, 'body-id'],
    ['order-update', 'printOrderUpdate', { kitchenTicketId: 'body-id', printerName: 'Cocina' }, 'body-id'],
  ])('%s is deduplicated by the id the HTTP route uses', async (endpoint, fnName, body, key) => {
    recordJob(key);
    const api = makeApi();
    await runJob({ jobId: 'server-job-id', endpoint, body }, api);
    expect(printing[fnName]).not.toHaveBeenCalled();
    expect(api.ack).toHaveBeenCalledWith('server-job-id');
  });

  it('records what it printed so the HTTP route sees it as a duplicate', async () => {
    await runJob(orderJob(), makeApi());
    expect(isDuplicateJob('ticket-1')).toBe(true);
  });
});
