import os from 'os';
import { getSystemPrinters } from '../printing/printer-manager.js';
import { getLink, onLinked } from './link-store.js';
import { markPollSuccess, markNetworkError, markUnauthorized } from './link-status.js';
import { createAgentApi } from './agent-api.js';
import { runJob, flushPendingAcks } from './job-runner.js';

// The wait between cycles is counted from the END of a cycle (R2, KTD12): a slow
// poll or a slow print pushes the next one back instead of overlapping it.
export const POLL_INTERVAL_MS = 3000;

/**
 * The loop of the linked agent: each cycle sends the pending acks, polls with
 * the printer list, prints the returned jobs one at a time reporting each
 * result, and waits. Never overlaps itself.
 *
 * `start()` arms the poller: it begins looping if the agent is linked and again
 * whenever a link is saved (POST /link). The loop itself ends on a 401 or when
 * the link disappears, and `start()`'s subscription brings it back with the next
 * link. `stop()` ends both.
 * @param {{fetchImpl?: typeof fetch, version?: string, hostname?: string, intervalMs?: number}} [deps]
 */
export function createPoller({ fetchImpl, version = null, hostname = os.hostname(), intervalMs = POLL_INTERVAL_MS } = {}) {
  const api = createAgentApi({ fetchImpl });
  let unsubscribe = null;
  let activeLoop = null; // { active: boolean, wake: () => void }

  // Waits `ms`, or less if the loop is stopped meanwhile.
  const sleep = (loop, ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    loop.wake = () => { clearTimeout(timer); resolve(); };
  });

  // A 401 means the credential was revoked or unknown. It only counts for the
  // link the request was sent with: if the browser relinked while it flew, the
  // new link is valid and must stay.
  function handleUnauthorized(loop, error) {
    if (getLink()?.token !== error.token) return;
    markUnauthorized();
    loop.active = false;
  }

  async function cycle(loop) {
    try {
      await flushPendingAcks(api);
      const printers = (await getSystemPrinters()).map((printer) => printer.name);
      const response = await api.poll({ printers, version, hostname });
      markPollSuccess();
      const jobs = Array.isArray(response?.jobs) ? response.jobs : [];
      // One at a time, in the order the server sent them (oldest first).
      for (const job of jobs) {
        if (!loop.active) return;
        await runJob(job, api);
      }
    } catch (error) {
      if (error?.name !== 'AgentApiError') {
        // Not a server problem (for example the printer list): try again next cycle.
        console.warn(`[DirectJobs] Cycle failed: ${error?.message}`);
      } else if (error.status === 401) {
        handleUnauthorized(loop, error);
      } else if (error.status === null || error.status >= 500) {
        markNetworkError();
      } else {
        // 403 (blocked organization or location) and other 4xx: the server is
        // up but not serving this agent. Keep the cadence, do not call it a success.
        console.warn(`[DirectJobs] ${error.message}`);
      }
    }
  }

  async function run(loop) {
    while (loop.active && getLink()) {
      await cycle(loop);
      if (!loop.active) break;
      await sleep(loop, intervalMs);
    }
    loop.active = false;
    if (activeLoop === loop) activeLoop = null;
  }

  function beginLoop() {
    if (activeLoop?.active) return;
    const loop = { active: true, wake: () => {} };
    activeLoop = loop;
    run(loop);
  }

  return {
    start() {
      if (!unsubscribe) unsubscribe = onLinked(() => beginLoop());
      if (getLink()) beginLoop();
    },
    stop() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (activeLoop) {
        activeLoop.active = false;
        activeLoop.wake();
        activeLoop = null;
      }
    },
    isRunning: () => Boolean(activeLoop?.active),
  };
}

// The poller of this process, started and stopped by main.js.
let poller = null;

export function startPoller({ version } = {}) {
  if (!poller) poller = createPoller({ version });
  poller.start();
}

export function stopPoller() {
  if (poller) poller.stop();
  poller = null;
}
