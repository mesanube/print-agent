import { describe, it, expect, vi, beforeEach } from 'vitest';

// store.js instantiates electron-store at import time, which needs Electron;
// under vitest it is backed by a plain in-memory map with the same get/set
// shape (returns the stored object, or the fallback when absent).
const memory = new Map();
vi.mock('electron-store', () => ({
  default: class {
    get(key, fallback) {
      return memory.has(key) ? memory.get(key) : fallback;
    }
    set(key, value) {
      memory.set(key, value);
    }
  },
}));

const { getPrinterCutter, setPrinterCutter } = await import('./store.js');

beforeEach(() => {
  memory.clear();
});

describe('printer cutter setting (KD6)', () => {
  it('defaults a never-configured printer to enabled', () => {
    expect(getPrinterCutter('A')).toBe(true);
  });

  it('turning A off leaves B untouched', () => {
    setPrinterCutter('A', false);
    expect(getPrinterCutter('A')).toBe(false);
    expect(getPrinterCutter('B')).toBe(true);
  });

  it('turning A back on leaves B untouched', () => {
    setPrinterCutter('A', false);
    setPrinterCutter('B', false);
    setPrinterCutter('A', true);
    expect(getPrinterCutter('A')).toBe(true);
    expect(getPrinterCutter('B')).toBe(false);
  });

  it('falls back to enabled when no printer name is given', () => {
    expect(getPrinterCutter(null)).toBe(true);
  });
});