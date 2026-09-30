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

const { getPrinterCutter, setPrinterCutter, getPrintMode, setPrintMode, getPrinterCodepage, setPrinterCodepage } = await import('./store.js');

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

describe('print mode setting (KD2)', () => {
  it('Covers AE3: a printer with no saved value prints as text', () => {
    expect(getPrintMode('Fiscal')).toBe('text');
  });

  it('keeps compat on one printer without touching another', () => {
    setPrintMode('Fiscal', 'compat');
    expect(getPrintMode('Fiscal')).toBe('compat');
    expect(getPrintMode('Cocina')).toBe('text');
  });

  it('switching back to text is stored per printer', () => {
    setPrintMode('Fiscal', 'compat');
    setPrintMode('Fiscal', 'text');
    expect(getPrintMode('Fiscal')).toBe('text');
  });
});

describe('printer codepage setting', () => {
  it('defaults each printer to CP858', () => {
    expect(getPrinterCodepage('Caja')).toBe('cp858');
  });

  it('stores the codepage per printer', () => {
    setPrinterCodepage('Caja', 'cp850');
    expect(getPrinterCodepage('Caja')).toBe('cp850');
    expect(getPrinterCodepage('Fiscal')).toBe('cp858');
  });
});

