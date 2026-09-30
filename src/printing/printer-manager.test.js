import { describe, it, expect, vi } from 'vitest';

// printer-manager.js pulls in Electron, the Windows native module and the
// electron-store settings at import time; none of them run under vitest.
vi.mock('electron', () => ({ BrowserWindow: vi.fn() }));
vi.mock('./native/windows-native-printer.js', () => ({ getAllPrintersNative: vi.fn(() => []) }));
vi.mock('../core/store.js', () => ({ getSelectedPrinter: vi.fn(), setSelectedPrinter: vi.fn() }));

const { createPrinterCache } = await import('./printer-manager.js');

const printers = (...names) => names.map((name) => ({ name }));

function setup(lists, ttlMs = 30000) {
  let clock = 0;
  const load = vi.fn();
  for (const list of lists) load.mockResolvedValueOnce(list);
  const cache = createPrinterCache(load, { ttlMs, now: () => clock });
  return { cache, load, advance: (ms) => { clock += ms; } };
}

describe('createPrinterCache', () => {
  it('queries the system once for two calls within the TTL', async () => {
    const { cache, load, advance } = setup([printers('A')]);
    await cache.list();
    advance(1000);
    const second = await cache.list();
    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toEqual(printers('A'));
  });

  it('queries again once the TTL has passed', async () => {
    const { cache, load, advance } = setup([printers('A'), printers('A', 'B')], 30000);
    await cache.list();
    advance(30001);
    expect(await cache.list()).toEqual(printers('A', 'B'));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('queries again after invalidate', async () => {
    const { cache, load } = setup([printers('A'), printers('A', 'B')]);
    await cache.list();
    cache.invalidate();
    expect(await cache.list()).toEqual(printers('A', 'B'));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('finds a printer missing from the cache but present in a fresh list', async () => {
    const { cache, load } = setup([printers('A'), printers('A', 'New')]);
    await cache.list();
    await expect(cache.requirePrinter('New')).resolves.toEqual({ name: 'New' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not re-query when the printer is already in the cache', async () => {
    const { cache, load } = setup([printers('A')]);
    await cache.requirePrinter('A');
    await cache.requirePrinter('A');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('throws the usual not-found error when the printer is in neither list', async () => {
    const { cache } = setup([printers('A'), printers('A', 'B')]);
    await cache.list();
    await expect(cache.requirePrinter('Gone')).rejects.toThrow('Printer "Gone" not found. Available printers: A, B');
  });

  it('does not cache an empty result, so a failed enumeration is retried', async () => {
    const { cache, load } = setup([[], printers('A')]);
    expect(await cache.list()).toEqual([]);
    expect(await cache.list()).toEqual(printers('A'));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
