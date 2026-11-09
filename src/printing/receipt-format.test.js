import { describe, it, expect } from 'vitest';
import { formatAfipDate } from './receipt-format.js';

describe('formatAfipDate', () => {
  it('turns AAAAMMDD into dd/mm/aaaa', () => {
    expect(formatAfipDate('20200101')).toBe('01/01/2020');
    expect(formatAfipDate(20261231)).toBe('31/12/2026');
  });

  it('leaves an already formatted date as it came', () => {
    expect(formatAfipDate('01/01/2020')).toBe('01/01/2020');
  });

  it('prints nothing for a missing date', () => {
    expect(formatAfipDate(undefined)).toBe('');
    expect(formatAfipDate('')).toBe('');
  });
});
