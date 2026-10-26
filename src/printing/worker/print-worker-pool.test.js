import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPrintWorkerPool } from './print-worker-pool.js';
import { createBudget } from './time-budget.js';

// A fake utility process. `behavior(msg, child)` decides how it answers, so a
// test can make one printer answer and another never respond.
function createFakeLauncher(behavior) {
  const children = [];
  const launch = (key) => {
    const handlers = { message: [], exit: [] };
    const child = {
      key,
      killed: false,
      received: [],
      postMessage(msg) {
        child.received.push(msg);
        behavior(msg, child);
      },
      emit(msg) { handlers.message.forEach((h) => h(msg)); },
      die() { handlers.exit.forEach((h) => h(1)); },
      on(event, handler) { handlers[event].push(handler); },
      kill() { child.killed = true; },
    };
    children.push(child);
    return child;
  };
  return { launch, children };
}

const ok = (result) => (msg, child) => child.emit({ type: 'result', id: msg.id, ok: true, result });
const silent = () => {};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('print worker pool', () => {
  it('resolves a request with the worker result', async () => {
    const { launch } = createFakeLauncher(ok({ written: 3 }));
    const pool = createPrintWorkerPool({ launch, log: silent });
    await expect(pool.request('Caja', 'writeRaw', { bytes: [1] }, createBudget())).resolves.toEqual({ written: 3 });
  });

  it('surfaces a native error with its message and without PRINT_TIMEOUT', async () => {
    const { launch } = createFakeLauncher((msg, child) =>
      child.emit({ type: 'result', id: msg.id, ok: false, error: 'WritePrinter failed (error 5)' }));
    const pool = createPrintWorkerPool({ launch, log: silent });
    const error = await pool.request('Caja', 'writeRaw', {}, createBudget()).catch((e) => e);
    expect(error.message).toBe('WritePrinter failed (error 5)');
    expect(error.code).toBeUndefined();
  });

  it('Covers AE1: a hung printer times out while another printer still prints', async () => {
    const { launch } = createFakeLauncher((msg, child) => {
      if (child.key === 'Cocina') child.emit({ type: 'result', id: msg.id, ok: true, result: 'ok' });
    });
    const pool = createPrintWorkerPool({ launch, log: silent });
    const stuck = pool.request('Caja', 'writeRaw', {}, createBudget(9000)).catch((e) => e);
    const other = pool.request('Cocina', 'writeRaw', {}, createBudget(9000));
    await expect(other).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(9000);
    const error = await stuck;
    expect(error.code).toBe('PRINT_TIMEOUT');
  });

  it('kills only the hung printer process and uses a new one for the next request', async () => {
    let hang = true;
    const { launch, children } = createFakeLauncher((msg, child) => {
      if (!hang || child.key !== 'Caja') child.emit({ type: 'result', id: msg.id, ok: true, result: 'ok' });
    });
    const pool = createPrintWorkerPool({ launch, log: silent });
    const cocina = await pool.request('Cocina', 'writeRaw', {}, createBudget());
    expect(cocina).toBe('ok');
    const stuck = pool.request('Caja', 'writeRaw', {}, createBudget(9000)).catch((e) => e);
    await vi.advanceTimersByTimeAsync(9000);
    await stuck;
    const [cocinaChild, cajaChild] = children;
    expect(cajaChild.killed).toBe(true);
    expect(cocinaChild.killed).toBe(false);
    hang = false;
    await expect(pool.request('Caja', 'writeRaw', {}, createBudget())).resolves.toBe('ok');
    expect(children.filter((c) => c.key === 'Caja' && !c.killed)).toHaveLength(1);
  });

  it('asks a fresh process to cancel the job id the printer process reported before hanging', async () => {
    const { launch, children } = createFakeLauncher((msg, child) => {
      if (msg.op === 'writeRaw') child.emit({ type: 'job', id: msg.id, jobId: 42 });
      if (msg.op === 'cancelJob') child.emit({ type: 'result', id: msg.id, ok: true, result: true });
    });
    const pool = createPrintWorkerPool({ launch, log: silent });
    const stuck = pool.request('Caja', 'writeRaw', {}, createBudget(9000)).catch((e) => e);
    await vi.advanceTimersByTimeAsync(9000);
    expect((await stuck).code).toBe('PRINT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(0);
    const cancel = children.flatMap((c) => c.received).find((m) => m.op === 'cancelJob');
    expect(cancel.payload).toEqual({ printerName: 'Caja', jobId: 42 });
    expect(children.find((c) => c.received.includes(cancel))).not.toBe(children[0]);
  });

  it('gives up on a cancel that never answers without blocking the next request', async () => {
    const { launch, children } = createFakeLauncher((msg, child) => {
      if (msg.op === 'writeRaw' && child === children[0]) child.emit({ type: 'job', id: msg.id, jobId: 7 });
      if (msg.op === 'writeRaw' && child !== children[0]) child.emit({ type: 'result', id: msg.id, ok: true, result: 'next' });
    });
    const pool = createPrintWorkerPool({ launch, log: silent, cancelTimeoutMs: 3000 });
    const stuck = pool.request('Caja', 'writeRaw', {}, createBudget(9000)).catch((e) => e);
    await vi.advanceTimersByTimeAsync(9000);
    await stuck;
    await expect(pool.request('Caja', 'writeRaw', {}, createBudget(9000))).resolves.toBe('next');
    await vi.advanceTimersByTimeAsync(3000);
    const cancelChild = children.find((c) => c.received.some((m) => m.op === 'cancelJob'));
    expect(cancelChild.killed).toBe(true);
  });

  it('rejects only the requests of a process that dies by itself and recreates it', async () => {
    const { launch, children } = createFakeLauncher((msg, child) => {
      if (child.key === 'Cocina') child.emit({ type: 'result', id: msg.id, ok: true, result: 'ok' });
    });
    const pool = createPrintWorkerPool({ launch, log: silent });
    const pending = pool.request('Caja', 'writeRaw', {}, createBudget()).catch((e) => e);
    children[0].die();
    const error = await pending;
    expect(error.message).toMatch(/exited/);
    expect(error.code).toBeUndefined();
    await expect(pool.request('Cocina', 'writeRaw', {}, createBudget())).resolves.toBe('ok');
    pool.request('Caja', 'writeRaw', {}, createBudget()).catch(() => {});
    expect(children.filter((c) => c.key === 'Caja')).toHaveLength(2);
  });

  it('a hung printer list does not affect printer processes', async () => {
    const { launch } = createFakeLauncher((msg, child) => {
      if (child.key !== pool.LIST_KEY) child.emit({ type: 'result', id: msg.id, ok: true, result: 'ok' });
    });
    const pool = createPrintWorkerPool({ launch, log: silent });
    const listing = pool.request(pool.LIST_KEY, 'listPrinters', {}, createBudget(9000)).catch((e) => e);
    await expect(pool.request('Caja', 'writeRaw', {}, createBudget())).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(9000);
    expect((await listing).code).toBe('PRINT_TIMEOUT');
    await expect(pool.request('Caja', 'writeRaw', {}, createBudget())).resolves.toBe('ok');
  });

  it('rejects at once when the budget is already spent, without touching a process', async () => {
    const { launch, children } = createFakeLauncher(ok('x'));
    const pool = createPrintWorkerPool({ launch, log: silent });
    const budget = createBudget(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pool.request('Caja', 'writeRaw', {}, budget).catch((e) => e);
    expect(error.code).toBe('PRINT_TIMEOUT');
    expect(children).toHaveLength(0);
  });

  it('shutdown kills every process', async () => {
    const { launch, children } = createFakeLauncher(ok('x'));
    const pool = createPrintWorkerPool({ launch, log: silent });
    await pool.request('Caja', 'writeRaw', {}, createBudget());
    await pool.request('Cocina', 'writeRaw', {}, createBudget());
    pool.shutdown();
    expect(children.every((c) => c.killed)).toBe(true);
  });

  it('logs start, end, duration and result of each call', async () => {
    const lines = [];
    const { launch } = createFakeLauncher(ok('x'));
    const pool = createPrintWorkerPool({ launch, log: (l) => lines.push(l) });
    await pool.request('Caja', 'writeRaw', {}, createBudget());
    expect(lines.some((l) => /op=writeRaw/.test(l) && /start/.test(l))).toBe(true);
    expect(lines.some((l) => /op=writeRaw/.test(l) && /result=ok/.test(l) && /ms=\d+/.test(l))).toBe(true);
  });
});
