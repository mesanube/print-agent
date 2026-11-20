import { getDirectJobsState, setDirectJobsState } from '../core/store.js';

// Durable memory of the direct-jobs path (KTD8):
//   printed      jobId -> printedAt, for the jobIds this agent printed in the
//                last 24 h. If the server offers one again (its lease expired
//                before the ack arrived) the agent only confirms it.
//   pendingAcks  jobId -> queuedAt, the confirmations the server has not
//                received yet. Sent at the start of the next cycle.
// Both live in the store so a restart does not lose them.
export const PRINTED_JOBS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

function readState() {
  const stored = getDirectJobsState();
  return {
    printed: isRecord(stored?.printed) ? { ...stored.printed } : {},
    pendingAcks: isRecord(stored?.pendingAcks) ? { ...stored.pendingAcks } : {},
  };
}

// Drops what is older than the TTL, and the oldest entries past the cap.
function prune(map, now) {
  const kept = Object.entries(map)
    .filter(([, at]) => typeof at === 'number' && now - at <= PRINTED_JOBS_TTL_MS)
    .sort((a, b) => a[1] - b[1]);
  return Object.fromEntries(kept.slice(-MAX_ENTRIES));
}

function writeState(state, now) {
  setDirectJobsState({ printed: prune(state.printed, now), pendingAcks: prune(state.pendingAcks, now) });
}

export function wasJobPrinted(jobId) {
  const printedAt = readState().printed[jobId];
  return typeof printedAt === 'number' && Date.now() - printedAt <= PRINTED_JOBS_TTL_MS;
}

export function markJobPrinted(jobId) {
  const now = Date.now();
  const state = readState();
  state.printed[jobId] = now;
  writeState(state, now);
}

// Oldest first.
export function getPendingAcks() {
  const now = Date.now();
  return Object.entries(prune(readState().pendingAcks, now))
    .sort((a, b) => a[1] - b[1])
    .map(([jobId]) => jobId);
}

export function queueAck(jobId) {
  const now = Date.now();
  const state = readState();
  if (state.pendingAcks[jobId] === undefined) state.pendingAcks[jobId] = now;
  writeState(state, now);
}

export function dequeueAck(jobId) {
  const state = readState();
  delete state.pendingAcks[jobId];
  writeState(state, Date.now());
}
