import { AsyncLocalStorage } from 'async_hooks';

// Total time one print request may take (KTD2). It covers the wait in the
// render queue, the HTML capture, the printer list, the printable width query
// and the write: every step gets what is left, not a limit of its own. It
// stays under the web client's 10 s timeout for tickets and invoices so the
// client receives the agent's PRINT_TIMEOUT instead of aborting first.
export const PRINT_BUDGET_MS = 9000;

export const PRINT_TIMEOUT_CODE = 'PRINT_TIMEOUT';

export function printTimeoutError(message) {
  const error = new Error(message);
  error.code = PRINT_TIMEOUT_CODE;
  return error;
}

export const isPrintTimeout = (error) => error?.code === PRINT_TIMEOUT_CODE;

/**
 * A fixed deadline shared by every step of one print request.
 * @param {number} totalMs
 * @param {{now?: () => number}} [deps]
 */
export function createBudget(totalMs = PRINT_BUDGET_MS, { now = Date.now } = {}) {
  const deadline = now() + totalMs;
  return {
    remaining: () => Math.max(0, deadline - now()),
    expired: () => now() >= deadline,
    /** Settles like `promise`, or rejects with PRINT_TIMEOUT when the deadline passes first. */
    race(promise, label = 'Print request') {
      const left = deadline - now();
      if (left <= 0) {
        // Keep the abandoned promise from turning into an unhandled rejection.
        Promise.resolve(promise).catch(() => {});
        return Promise.reject(printTimeoutError(`${label} exceeded the ${totalMs} ms time limit`));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(printTimeoutError(`${label} exceeded the ${totalMs} ms time limit`)),
          left,
        );
        Promise.resolve(promise).then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });
    },
  };
}

// The budget travels with the request through every await (queue, capture,
// pool calls) without being threaded through each signature.
const storage = new AsyncLocalStorage();

/** Runs `fn` with a fresh budget, unless one is already active (nested calls share it). */
export function runWithBudget(fn, { totalMs = PRINT_BUDGET_MS, now } = {}) {
  if (storage.getStore()) return fn();
  return storage.run(createBudget(totalMs, { now }), fn);
}

export const currentBudget = () => storage.getStore() ?? null;
