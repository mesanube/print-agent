import { printReceipt, printOrder, printOrderUpdate, printInvoice } from '../printing/index.js';
import { runTimedJob } from '../printing/job-timing.js';
import { isDuplicateJob, recordJob, releaseJob } from '../printing/job-dedup.js';
import { wasJobPrinted, markJobPrinted, getPendingAcks, queueAck, dequeueAck } from './printed-jobs.js';

// What the server sends in `endpoint` is what the agent's own HTTP routes
// receive, so each entry calls the same print function the matching route
// calls (KTD10). `dedupKey` is the id the route dedups by: the jobId for
// receipts and invoices, the kitchenTicketId for comandas and updates.
const HANDLERS = {
  receipt: { print: printReceipt, dedupKey: (body) => body.jobId },
  invoice: { print: printInvoice, dedupKey: (body) => body.jobId },
  order: { print: printOrder, dedupKey: (body) => body.kitchenTicketId },
  'order-update': { print: printOrderUpdate, dedupKey: (body) => body.kitchenTicketId },
};

const FALLBACK_ERROR_CODE = 'PRINT_FAILED';
const MAX_ERROR_LENGTH = 1000; // the server rejects longer messages

const isUnauthorized = (error) => error?.status === 401;

// An unauthorized answer ends the cycle (the poller forgets the link). Any
// other failure of a report is only logged: the lease expires and the server
// offers the job again.
async function report(label, send) {
  try {
    await send();
    return true;
  } catch (error) {
    if (isUnauthorized(error)) throw error;
    console.warn(`[DirectJobs] ${label} failed: ${error.message}`);
    return false;
  }
}

async function ackJob(jobId, api) {
  const confirmed = await report(`ack ${jobId}`, () => api.ack(jobId));
  if (confirmed) dequeueAck(jobId);
  else queueAck(jobId);
}

async function failJob(jobId, code, message, api) {
  await report(`fail ${jobId}`, () => api.fail({ jobId, code, error: String(message ?? '').slice(0, MAX_ERROR_LENGTH) }));
}

/**
 * Sends the acks that did not get through in an earlier cycle. A network
 * failure leaves the jobId queued; a 401 reaches the caller.
 * @param {{ack: (jobId: string) => Promise<unknown>}} api
 */
export async function flushPendingAcks(api) {
  for (const jobId of getPendingAcks()) {
    const confirmed = await report(`ack ${jobId}`, () => api.ack(jobId));
    if (confirmed) dequeueAck(jobId);
  }
}

/**
 * Prints one job the server handed over and reports the result: `ack` when it
 * printed (or had already printed it), `fail` when it did not (R5, KTD8).
 * Never throws for a print failure; a 401 from the server reaches the caller.
 * @param {{jobId: string, endpoint: string, body: object}} job
 * @param {{ack: Function, fail: Function}} api
 */
export async function runJob(job, api) {
  const { jobId, endpoint, body } = job;
  const handler = HANDLERS[endpoint];
  if (!handler || !body || typeof body !== 'object') {
    await failJob(jobId, 'UNKNOWN_ENDPOINT', `Cannot print a job of endpoint "${endpoint}"`, api);
    return;
  }

  // Printed before, even before a restart: the ack was lost, only confirm.
  if (wasJobPrinted(jobId)) {
    await ackJob(jobId, api);
    return;
  }

  // The browser route printed it (or is printing it) in this same process.
  const dedupKey = handler.dedupKey(body) || jobId;
  if (isDuplicateJob(dedupKey)) {
    await ackJob(jobId, api);
    return;
  }

  // Reserve before awaiting and release on failure, exactly like the routes,
  // so a retry the server schedules after a `fail` can print.
  recordJob(dedupKey);
  try {
    await runTimedJob(endpoint, (timing) => handler.print(body, body.printerName, timing));
  } catch (error) {
    releaseJob(dedupKey);
    console.warn(`[DirectJobs] ${endpoint} ${jobId} failed: ${String(error.message).slice(0, 200)}`);
    await failJob(jobId, typeof error.code === 'string' && error.code ? error.code : FALLBACK_ERROR_CODE, error.message, api);
    return;
  }

  // On disk before the ack leaves: if the ack is lost the job can come back,
  // and it must be recognized.
  markJobPrinted(jobId);
  await ackJob(jobId, api);
}
