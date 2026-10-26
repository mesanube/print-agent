import { printTimeoutError } from './time-budget.js';

// Everything that can block (the Windows print queue, the GDI module, printer
// enumeration, the printable width query) runs in a separate process that can
// be killed even while stuck inside a native call (KTD1). There is one process
// per printer, so killing the stuck one never touches the others (R3), plus
// one for listing printers.
const LIST_KEY = '__list__';
const CANCEL_PREFIX = '__cancel__:';
const DEFAULT_CANCEL_TIMEOUT_MS = 3000;

/**
 * @param {object} deps
 * @param {(key: string) => {postMessage: Function, on: Function, kill: Function}} deps.launch
 *   Starts a worker process. Injected so the pool is testable without Electron.
 * @param {(line: string) => void} [deps.log]
 * @param {number} [deps.cancelTimeoutMs] Own limit for the job cancellation (KTD3).
 */
export function createPrintWorkerPool({ launch, log = console.log, cancelTimeoutMs = DEFAULT_CANCEL_TIMEOUT_MS }) {
  const workers = new Map(); // key -> { child, pending: Map<id, request> }
  let nextId = 1;

  function spawn(key) {
    const entry = { child: null, pending: new Map() };
    const child = launch(key);
    entry.child = child;

    child.on('message', (msg) => {
      const request = entry.pending.get(msg?.id);
      if (!request) return;
      if (msg.type === 'job') {
        // Reported as soon as the spooler hands out the id, so a timeout can
        // still cancel the job in the Windows queue (KTD3).
        request.jobId = msg.jobId;
        return;
      }
      if (msg.type === 'result') {
        entry.pending.delete(msg.id);
        if (msg.ok) request.resolve(msg.result);
        else request.reject(new Error(msg.error));
      }
    });

    child.on('exit', () => {
      // A process that exits on its own (crash) or after being killed. Only
      // its own pending requests fail; the next request starts a new one.
      if (workers.get(key) === entry) workers.delete(key);
      for (const request of entry.pending.values()) {
        request.reject(new Error(`Print process for "${key}" exited unexpectedly`));
      }
      entry.pending.clear();
    });

    workers.set(key, entry);
    return entry;
  }

  function discard(key, entry) {
    if (workers.get(key) === entry) workers.delete(key);
    try { entry.child.kill(); } catch { /* already gone */ }
  }

  /** Asks a brand-new process to delete a job from the Windows queue (best effort). */
  function cancelJob(printerName, jobId) {
    const key = `${CANCEL_PREFIX}${printerName}`;
    const budget = { remaining: () => cancelTimeoutMs };
    log(`[PrintPool] printer="${printerName}" op=cancelJob job=${jobId} start`);
    return request(key, 'cancelJob', { printerName, jobId }, budget, { cancel: true })
      .then(() => log(`[PrintPool] printer="${printerName}" op=cancelJob job=${jobId} result=ok`))
      .catch((error) => log(`[PrintPool] printer="${printerName}" op=cancelJob job=${jobId} result=failed error="${error.message}"`))
      .finally(() => {
        const entry = workers.get(key);
        if (entry) discard(key, entry);
      });
  }

  /**
   * Sends one operation to the worker of `key` and resolves with its result.
   * Rejects with PRINT_TIMEOUT when the budget runs out; the worker is killed
   * and the job cancelled in the queue if the spooler had assigned an id.
   * @param {string} key Printer name, or LIST_KEY.
   * @param {string} op
   * @param {object} payload
   * @param {{remaining: () => number}} budget
   */
  function request(key, op, payload, budget, { cancel = false } = {}) {
    const printerName = key.startsWith(CANCEL_PREFIX) ? key.slice(CANCEL_PREFIX.length) : key;
    const left = budget.remaining();
    if (left <= 0) {
      log(`[PrintPool] printer="${printerName}" op=${op} result=timeout ms=0 (budget spent before sending)`);
      return Promise.reject(printTimeoutError(`No time left to run ${op} on "${printerName}"`));
    }

    const id = nextId++;
    const startedAt = Date.now();
    const entry = workers.get(key) || spawn(key);

    return new Promise((resolve, reject) => {
      let timer = null;
      const finish = (result, extra = '') => {
        clearTimeout(timer);
        if (!cancel) log(`[PrintPool] printer="${printerName}" op=${op} result=${result} ms=${Date.now() - startedAt}${extra}`);
      };
      const req = {
        jobId: null,
        resolve: (value) => { finish('ok'); resolve(value); },
        reject: (error) => { finish('error', ` error="${error.message}"`); reject(error); },
      };
      entry.pending.set(id, req);

      timer = setTimeout(() => {
        const jobId = req.jobId;
        const waiting = [...entry.pending.values()];
        entry.pending.clear();
        discard(key, entry);
        log(`[PrintPool] printer="${printerName}" op=${op} result=timeout ms=${Date.now() - startedAt}${jobId ? ` job=${jobId}` : ''}`);
        if (cancel) {
          reject(printTimeoutError(`${op} on "${printerName}" did not answer`));
          return;
        }
        for (const other of waiting) {
          if (other === req) clearTimeout(timer);
          else other.reject(printTimeoutError(`Print process for "${printerName}" was stopped because a job did not answer`));
        }
        reject(printTimeoutError(`Printer "${printerName}" did not answer ${op} in time`));
        if (jobId) cancelJob(printerName, jobId);
      }, left);

      if (!cancel) log(`[PrintPool] printer="${printerName}" op=${op} start`);
      try {
        entry.child.postMessage({ id, op, payload });
      } catch (error) {
        entry.pending.delete(id);
        req.reject(error);
      }
    });
  }

  function shutdown() {
    for (const [key, entry] of [...workers]) {
      for (const req of entry.pending.values()) req.reject(new Error('Print agent is shutting down'));
      entry.pending.clear();
      discard(key, entry);
    }
  }

  return { request, shutdown, LIST_KEY };
}
