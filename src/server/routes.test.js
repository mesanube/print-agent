import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({ app: {}, BrowserWindow: vi.fn(), powerMonitor: { on: vi.fn() } }));
vi.mock('../printing/printer-manager.js', () => ({ getSystemPrinters: vi.fn(async () => []) }));
vi.mock('../core/store.js', () => {
  const fn = (value = null) => vi.fn(() => value);
  return {
    getSelectedPrinter: fn('Caja'), getDefaultTemplate: fn(), setDefaultTemplate: fn(),
    getPaperWidth: fn('80mm'), setPaperWidth: fn(), getWidthAdjust: fn(100), setWidthAdjust: fn(),
    getPrinterTransports: fn({}), getQRCodeEnabled: fn(), setQRCodeEnabled: fn(),
    getQRCodeSize: fn(), setQRCodeSize: fn(), getLogoEnabled: fn(), setLogoEnabled: fn(),
    getLogoSize: fn(), setLogoSize: fn(), getPrinterCutter: fn(true), setPrinterCutter: fn(),
    getPrintMode: fn('text'), setPrintMode: fn(), PRINT_MODES: ['text', 'compat'],
    getPrinterCodepage: fn('cp858'), setPrinterCodepage: fn(), PRINTER_CODEPAGES: ['cp858'],
    getPrinterCharSpacing: fn(0), setPrinterCharSpacing: fn(), CHAR_SPACINGS: [0, 1, 2, 3],
    getRegisterId: fn(), setRegisterId: fn(), getPrinterExplicitlySelected: fn(false), selectPrinterByOperator: fn(),
  };
});
const printReceipt = vi.fn();
vi.mock('../printing/index.js', () => ({
  printReceipt, printTestPage: vi.fn(), printOrder: vi.fn(), printOrderUpdate: vi.fn(),
  printInvoice: vi.fn(), printCashClose: vi.fn(), printDayZ: vi.fn(), printCalibrationPage: vi.fn(),
}));
const getPendingUpdateVersion = vi.fn(() => null);
vi.mock('../core/auto-updater.js', () => ({ getPendingUpdateVersion }));

const { createApi } = await import('./routes.js');
const app = createApi({ isDevelopmentMode: false, getCurrentPort: () => 8847, appVersion: '1.6.3' });

const post = (path, body) => app.request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => vi.clearAllMocks());

describe('print routes on a stuck job (KTD4)', () => {
  it('Covers AE1: answers 500 with code PRINT_TIMEOUT, error and details, and accepts the same jobId again', async () => {
    printReceipt.mockRejectedValueOnce(Object.assign(new Error('Print receipt failed: stuck'), { code: 'PRINT_TIMEOUT' }));
    const first = await post('/print/receipt', { jobId: 'job-timeout', printerName: 'Caja' });
    expect(first.status).toBe(500);
    expect(await first.json()).toEqual({ error: 'Print receipt failed', details: 'Print receipt failed: stuck', code: 'PRINT_TIMEOUT' });

    printReceipt.mockResolvedValueOnce();
    const retry = await post('/print/receipt', { jobId: 'job-timeout', printerName: 'Caja' });
    expect(retry.status).toBe(200);
    expect((await retry.json()).duplicate).toBeUndefined();
    expect(printReceipt).toHaveBeenCalledTimes(2);
  });

  it('a common error answers 500 without a code, as before', async () => {
    printReceipt.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ENOENT' }));
    const response = await post('/print/receipt', { jobId: 'job-plain', printerName: 'Caja' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Print receipt failed', details: 'boom' });
  });
});

describe('GET /status update field', () => {
  it('reports the downloaded update version', async () => {
    getPendingUpdateVersion.mockReturnValueOnce('1.7.0');
    expect((await (await app.request('/status')).json()).updatePending).toBe('1.7.0');
  });

  it('reports null when no update is waiting', async () => {
    expect((await (await app.request('/status')).json()).updatePending).toBeNull();
  });
});
