import { describe, it, expect } from 'vitest';
import { columnsFor, twoColumns, wrap, center, rule } from './layout.js';

describe('columnsFor', () => {
  it('uses Font A widths: 48 on 80mm, 32 on 58mm', () => {
    expect(columnsFor('80mm')).toBe(48);
    expect(columnsFor('58mm')).toBe(32);
  });

  it('falls back to 80mm for an unknown paper', () => {
    expect(columnsFor('A4')).toBe(48);
  });
});

describe('twoColumns', () => {
  it('pads the gap so the right text ends exactly at the last column (48)', () => {
    const [row] = twoColumns('TOTAL', '$ 1.234,50', 48);
    expect(row).toHaveLength(48);
    expect(row.startsWith('TOTAL ')).toBe(true);
    expect(row.endsWith('$ 1.234,50')).toBe(true);
  });

  it('pads to exactly 32 columns on 58mm', () => {
    const [row] = twoColumns('Cafe x2', '$ 3.000,00', 32);
    expect(row).toHaveLength(32);
    expect(row.endsWith('$ 3.000,00')).toBe(true);
  });

  it('wraps a long name and keeps the amount right-aligned on the last line', () => {
    const rows = twoColumns('Milanesa napolitana con papas fritas y ensalada mixta x1', '$ 12.500,00', 32);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(32);
    const last = rows[rows.length - 1];
    expect(last).toHaveLength(32);
    expect(last.endsWith('$ 12.500,00')).toBe(true);
    expect(rows.join(' ').replace(/\s+/g, ' ')).toContain('Milanesa napolitana con papas fritas');
  });

  it('never loses characters of a single word longer than the line', () => {
    const word = 'Supercalifragilisticoespialidoso';
    const rows = twoColumns(word, '$ 1,00', 20);
    expect(rows.join('').replace(/\s|\$|1,00/g, '')).toContain(word);
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(20);
  });
});

describe('wrap / center / rule', () => {
  it('wraps on word boundaries within the width', () => {
    expect(wrap('uno dos tres cuatro', 9)).toEqual(['uno dos', 'tres', 'cuatro']);
  });

  it('keeps blank input as no lines', () => {
    expect(wrap('', 10)).toEqual([]);
  });

  it('centers inside the width', () => {
    expect(center('ab', 6)).toBe('  ab');
  });

  it('draws a rule of the full width', () => {
    expect(rule(5)).toBe('-----');
    expect(rule(3, '=')).toBe('===');
  });
});
