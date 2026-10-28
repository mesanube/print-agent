import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = vi.hoisted(() => new Map());
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(), dialog: {}, app: { getPath: vi.fn(() => '/tmp') }, nativeImage: {},
  ipcMain: { handle: vi.fn((name, fn) => handlers.set(name, fn)), removeHandler: vi.fn() },
}));
vi.mock('../printing/printer-manager.js', () => ({ getSystemPrinters: vi.fn(), invalidatePrinterCache: vi.fn() }));
vi.mock('../printing/index.js', () => ({ printTestPage: vi.fn(), printTextTestPage: vi.fn(), printCalibrationPage: vi.fn() }));
vi.mock('../printing/worker/print-worker-client.js', () => ({ printImageFile: vi.fn() }));
vi.mock('../core/i18n.js', () => ({ default: { t: (key) => key } }));
vi.mock('../printing/qrcode-generator.js', () => ({ generateQRCodeHTML: vi.fn(), generateQRCodeData: vi.fn() }));
vi.mock('../shared/file-helpers.js', () => ({ getAbsoluteLogoPath: vi.fn(), getLogoAsBase64: vi.fn() }));
vi.mock('../core/store.js', () => {
  const names = `selectPrinterByOperator getDefaultTemplate setDefaultTemplate setLogoPath getLogoSize setLogoSize
    getQRCodeEnabled setQRCodeEnabled getQRCodeSize setQRCodeSize setLogoEnabled getLogoEnabled getLogoPath
    setPrinterCutter getPrinterCutter setPaperWidth getPaperWidth setWidthAdjust getWidthAdjust
    setPrinterTransport getPrinterTransport setPrintMode setPrinterCodepage getPrinterCodepage
    setPrinterCharSpacing getPrinterCharSpacing`.split(/\s+/);
  return {
    ...Object.fromEntries(names.map((n) => [n, vi.fn()])),
    PRINT_MODES: ['text', 'compat'], PRINTER_CODEPAGES: ['cp858'], CHAR_SPACINGS: [0, 1, 2, 3],
    getSelectedPrinter: vi.fn(() => 'Caja'),
    getPrintMode: vi.fn((name) => ({ Caja: 'text', Fiscal: 'compat' })[name] || 'text'),
  };
});

const { printTestPage, printTextTestPage } = await import('../printing/index.js');
const { setupSettingsIPC } = await import('./index.js');
setupSettingsIPC();
const testPrint = (printerName) => handlers.get('test-print')({}, printerName);

beforeEach(() => vi.clearAllMocks());

describe('single test button (test-print)', () => {
  it('prints the text test page on a text-mode printer', async () => {
    expect((await testPrint('Caja')).success).toBe(true);
    expect(printTextTestPage).toHaveBeenCalledWith('Caja');
    expect(printTestPage).not.toHaveBeenCalled();
  });

  it('prints the image template on a compat printer', async () => {
    await testPrint('Fiscal');
    expect(printTestPage).toHaveBeenCalled();
    expect(printTextTestPage).not.toHaveBeenCalled();
  });

  it('falls back to the selected printer when none is passed', async () => {
    await testPrint(undefined);
    expect(printTextTestPage).toHaveBeenCalledWith('Caja');
  });
});
