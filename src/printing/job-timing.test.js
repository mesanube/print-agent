import { describe, it, expect, vi } from 'vitest';
import { startJobTiming } from './job-timing.js';

function fakeClock(times) {
  const queue = [...times];
  return () => queue.shift();
}

describe('startJobTiming', () => {
  it('logs each stage as the ms elapsed since the previous one', () => {
    const log = vi.fn();
    const timing = startJobTiming('receipt', { now: fakeClock([0, 100, 250]), log });
    timing.mark('armado');
    timing.mark('envio');
    const result = timing.finish({ mode: 'image' });

    expect(result).toEqual({ job: 'receipt', mode: 'image', recepcion: 0, armado: 100, envio: 150, total: 250 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('[Timing] job=receipt mode=image recepcion=0ms armado=100ms envio=150ms total=250ms');
  });

  it('logs the stages it reached and the error when the job fails before envio', () => {
    const log = vi.fn();
    const timing = startJobTiming('invoice', { now: fakeClock([0, 80]), log });
    timing.mark('armado');

    let result;
    expect(() => {
      result = timing.finish({ mode: 'text', error: new Error('Printer "X" not found') });
    }).not.toThrow();

    expect(result).toEqual({ job: 'invoice', mode: 'text', recepcion: 0, armado: 80, total: 80, error: 'Printer "X" not found' });
    expect(log.mock.calls[0][0]).toBe('[Timing] job=invoice mode=text recepcion=0ms armado=80ms total=80ms error="Printer "X" not found"');
  });

  it('logs only once even if finish is called twice', () => {
    const log = vi.fn();
    const timing = startJobTiming('order', { now: fakeClock([0, 10, 20]), log });
    timing.mark('envio');
    timing.finish({ mode: 'image' });
    timing.finish({ mode: 'image' });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
