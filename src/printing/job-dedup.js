// In-memory idempotency cache for print jobs, keyed by a generic `jobId`.
// Covers kitchen comandas/updates (jobId = kitchenTicketId) AND the SSE
// fan-out receipt/invoice/NC jobs. Protects against an SSE replay, a manual
// reprint racing through twice, or two machines sharing the same printer name.
// Short TTL: long enough to absorb a network retry, short enough that
// intentional reprints later (a fresh jobId) aren't blocked.
//
// One instance for the whole process: the HTTP routes (jobs the browser sends)
// and the direct-jobs poller (jobs the agent fetches from the server) both use
// it, so the same jobId arriving through both prints once.
export const PRINT_JOB_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES_BEFORE_SWEEP = 256;
const printedJobs = new Map(); // jobId -> printedAt timestamp

export const isDuplicateJob = (jobId) => {
  if (!jobId) return false;
  const printedAt = printedJobs.get(jobId);
  if (!printedAt) return false;
  if (Date.now() - printedAt > PRINT_JOB_TTL_MS) {
    printedJobs.delete(jobId);
    return false;
  }
  return true;
};

export const recordJob = (jobId) => {
  if (!jobId) return;
  printedJobs.set(jobId, Date.now());
  // Best-effort eviction so the map can't grow unbounded over a long
  // uptime: sweep entries past TTL on each insert.
  if (printedJobs.size > MAX_ENTRIES_BEFORE_SWEEP) {
    const cutoff = Date.now() - PRINT_JOB_TTL_MS;
    for (const [id, ts] of printedJobs) {
      if (ts < cutoff) printedJobs.delete(id);
    }
  }
};

// Releases a reservation after a failed print so a real retry can proceed.
export const releaseJob = (jobId) => {
  if (jobId) printedJobs.delete(jobId);
};

// Tests only.
export const resetJobDedup = () => printedJobs.clear();
