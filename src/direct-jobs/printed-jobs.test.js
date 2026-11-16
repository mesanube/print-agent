import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Backed by a plain map with the same get/set shape as the store, so a "restart"
// is a module reset that keeps the map.
const memory = vi.hoisted(() => new Map());
vi.mock('../core/store.js', () => ({
  getDirectJobsState: () => memory.get('directJobsState') ?? null,
  setDirectJobsState: (state) => memory.set('directJobsState', JSON.parse(JSON.stringify(state))),
}));

const HOUR = 60 * 60 * 1000;
const load = async () => {
  vi.resetModules();
  return import('./printed-jobs.js');
};

beforeEach(() => {
  memory.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('printed jobs on disk (KTD8)', () => {
  it('knows a jobId it printed', async () => {
    const jobs = await load();
    expect(jobs.wasJobPrinted('job-1')).toBe(false);
    jobs.markJobPrinted('job-1');
    expect(jobs.wasJobPrinted('job-1')).toBe(true);
    expect(jobs.wasJobPrinted('job-2')).toBe(false);
  });

  it('survives a restart of the agent', async () => {
    const before = await load();
    before.markJobPrinted('job-1');
    const after = await load();
    expect(after.wasJobPrinted('job-1')).toBe(true);
  });

  it('still knows a jobId printed 23 hours ago, forgets one printed 25 hours ago', async () => {
    const jobs = await load();
    jobs.markJobPrinted('old');
    vi.setSystemTime(Date.now() + 23 * HOUR);
    expect(jobs.wasJobPrinted('old')).toBe(true);
    vi.setSystemTime(Date.now() + 2 * HOUR);
    expect(jobs.wasJobPrinted('old')).toBe(false);
  });

  it('prunes expired entries from the stored state when a new one is recorded', async () => {
    const jobs = await load();
    jobs.markJobPrinted('old');
    vi.setSystemTime(Date.now() + 25 * HOUR);
    jobs.markJobPrinted('new');
    expect(Object.keys(memory.get('directJobsState').printed)).toEqual(['new']);
  });
});

describe('queue of pending acks (KTD8)', () => {
  it('returns the queued jobIds oldest first, without duplicates', async () => {
    const jobs = await load();
    jobs.queueAck('a');
    jobs.queueAck('b');
    jobs.queueAck('a');
    expect(jobs.getPendingAcks()).toEqual(['a', 'b']);
  });

  it('removes a jobId once it was confirmed', async () => {
    const jobs = await load();
    jobs.queueAck('a');
    jobs.queueAck('b');
    jobs.dequeueAck('a');
    expect(jobs.getPendingAcks()).toEqual(['b']);
  });

  it('survives a restart of the agent', async () => {
    const before = await load();
    before.queueAck('a');
    const after = await load();
    expect(after.getPendingAcks()).toEqual(['a']);
  });

  it('drops an ack older than 24 hours: the server lease is long gone and a late ack changes nothing', async () => {
    const jobs = await load();
    jobs.queueAck('stale');
    vi.setSystemTime(Date.now() + 25 * HOUR);
    jobs.queueAck('fresh');
    expect(jobs.getPendingAcks()).toEqual(['fresh']);
  });

  it('keeps the queue and the printed record independent', async () => {
    const jobs = await load();
    jobs.markJobPrinted('a');
    jobs.queueAck('a');
    jobs.dequeueAck('a');
    expect(jobs.wasJobPrinted('a')).toBe(true);
  });

  it('starts empty on a corrupt or missing state', async () => {
    memory.set('directJobsState', 'garbage');
    const jobs = await load();
    expect(jobs.getPendingAcks()).toEqual([]);
    expect(jobs.wasJobPrinted('x')).toBe(false);
  });
});
