import { describe, it, expect, vi, beforeEach } from 'vitest';

// windows-printer.js wires Electron, the settings store, native transports and
// the template engine at import time. Everything outside the routing decision
// is mocked; the render window throws a sentinel so a test can tell that the
// image path was taken without driving a real offscreen window.
const modes = {};
const BrowserWindow = vi.fn(() => {
  throw new Error('render-window-created');
});
vi.mock('electron', () => ({ BrowserWindow }));
vi.mock('../core/store.js', () => ({
  getSelectedPrinter: vi.fn(() => 'Caja'),
  getPrinterCutter: vi.fn(() => true),
  getPrinterTransport: vi.fn(() => 'gdi'),
  getPrintMode: vi.fn((name) => modes[name] || 'text'),
  getPaperWidth: vi.fn(() => '80mm'),
}));
const generateHtmlFromTemplate = vi.fn(async () => '<html></html>');
vi.mock('./template-manager.js', () => ({
  generateHtmlFromTemplate,
  renderCashCloseHtml: vi.fn(async () => '<html></html>'),
  renderDayZHtml: vi.fn(async () => '<html></html>'),
}));
vi.mock('./printer-manager.js', () => ({ requireSystemPrinter: vi.fn(async (name) => ({ name })) }));
vi.mock('./paper-geometry.js', () => ({ getPaperGeometry: vi.fn(() => ({ dots: 576, cssWidth: 309, zoomFactor: 1.86 })) }));
vi.mock('./calibration-page.js', () => ({ renderCalibrationHtml: vi.fn(() => '') }));
const printBitmapGdi = vi.fn();
vi.mock('./transports/gdi-transport.js', () => ({ printBitmap: printBitmapGdi }));
const writeRaw = vi.fn();
vi.mock('./transports/raw-transport.js', () => ({ printBitmap: vi.fn(), writeRaw }));

const { printReceipt, printInvoice } = await import('./windows-printer.js');

const receipt = { order: { items: [{ name: 'Cafe', price: 1500, quantity: 1 }], orderTotal: 1500 }, restaurant: { name: 'Bar' } };

beforeEach(() => {
  for (const k of Object.keys(modes)) delete modes[k];
  vi.clearAllMocks();
});

describe('print mode routing (KTD9)', () => {
  it('Covers AE3: a printer with no saved mode prints as text, without opening the render window', async () => {
    await printReceipt(receipt, 'Caja');
    expect(BrowserWindow).not.toHaveBeenCalled();
    expect(generateHtmlFromTemplate).not.toHaveBeenCalled();
    expect(writeRaw).toHaveBeenCalledTimes(1);
    const [printer, bytes] = writeRaw.mock.calls[0];
    expect(printer).toBe('Caja');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('a printer in compat goes through the HTML image path, not the text writer', async () => {
    modes.Fiscal = 'compat';
    await expect(printReceipt(receipt, 'Fiscal')).rejects.toThrow('render-window-created');
    expect(generateHtmlFromTemplate).toHaveBeenCalledTimes(1);
    expect(writeRaw).not.toHaveBeenCalled();
  });

  it('routes each printer by its own mode', async () => {
    modes.Fiscal = 'compat';
    await printInvoice({ order: receipt.order, restaurant: receipt.restaurant, invoiceData: {} }, 'Caja');
    expect(writeRaw).toHaveBeenCalledTimes(1);
    expect(writeRaw.mock.calls[0][0]).toBe('Caja');
  });
});
