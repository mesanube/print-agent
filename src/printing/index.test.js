import { describe, it, expect, vi } from 'vitest';

// The dispatcher wraps every failure with a "Print ... failed" message. The
// error's `code` has to survive that wrap or the HTTP layer cannot tell a stuck
// job from any other failure.
const printReceiptWindows = vi.fn();
vi.mock('./windows-printer.js', () => ({
  printReceipt: printReceiptWindows,
  printOrder: vi.fn(), printOrderUpdate: vi.fn(), printTestPage: vi.fn(), printInvoice: vi.fn(),
  printCashClose: vi.fn(), printDayZ: vi.fn(), printCalibrationPage: vi.fn(), printTextTestPage: vi.fn(),
}));
vi.mock('./unix-printer.js', () => ({
  printReceipt: vi.fn(), printOrder: vi.fn(), printOrderUpdate: vi.fn(), printTestPage: vi.fn(),
}));

const { printReceipt } = await import('./index.js');

describe('print dispatcher error wrapping', () => {
  it('keeps PRINT_TIMEOUT and prefixes the message', async () => {
    printReceiptWindows.mockRejectedValueOnce(Object.assign(new Error('stuck'), { code: 'PRINT_TIMEOUT' }));
    await expect(printReceipt({})).rejects.toMatchObject({ message: 'Print receipt failed: stuck', code: 'PRINT_TIMEOUT' });
  });

  it('adds no code to a plain failure', async () => {
    printReceiptWindows.mockRejectedValueOnce(new Error('boom'));
    const error = await printReceipt({}).catch((e) => e);
    expect(error.message).toBe('Print receipt failed: boom');
    expect(error.code).toBeUndefined();
  });
});
