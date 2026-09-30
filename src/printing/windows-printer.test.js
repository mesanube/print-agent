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
const cutters = {};
vi.mock('../core/store.js', () => ({
  getSelectedPrinter: vi.fn(() => 'Caja'),
  getPrinterCutter: vi.fn((name) => cutters[name] ?? true),
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
const logoGet = vi.fn(async () => null);
vi.mock('./text/logo-cache.js', () => ({ logoCache: { get: (...args) => logoGet(...args) } }));
const printBitmapGdi = vi.fn();
vi.mock('./transports/gdi-transport.js', () => ({ printBitmap: printBitmapGdi }));
const writeRaw = vi.fn();
vi.mock('./transports/raw-transport.js', () => ({ printBitmap: vi.fn(), writeRaw }));

const { printReceipt, printInvoice, printOrder, printOrderUpdate, printCashClose, printDayZ } = await import('./windows-printer.js');

const receipt = { order: { items: [{ name: 'Cafe', price: 1500, quantity: 1 }], orderTotal: 1500 }, restaurant: { name: 'Bar' } };

beforeEach(() => {
  for (const k of Object.keys(modes)) delete modes[k];
  for (const k of Object.keys(cutters)) delete cutters[k];
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

const order = { dailyOrderNumber: 7, table: '3', items: [{ name: 'Pizza', quantity: 1 }] };
const summary = { registerName: 'Caja 1', businessDate: '2026-09-29', sales: { total: 1000 } };
const documents = {
  order: (printer) => printOrder({ order, restaurant: { name: 'Bar' } }, printer),
  'order update': (printer) => printOrderUpdate({ order, lines: [{ kind: 'add', quantity: 1, name: 'Flan' }] }, printer),
  'cash close': (printer) => printCashClose({ summary, restaurant: { name: 'Bar' } }, printer),
  'day Z': (printer) => printDayZ({ summary, restaurant: { name: 'Bar' } }, printer),
};

describe('every document follows its printer mode', () => {
  for (const [name, print] of Object.entries(documents)) {
    it(`${name}: text mode writes ESC/POS text without the render window`, async () => {
      await print('Caja');
      expect(BrowserWindow).not.toHaveBeenCalled();
      expect(writeRaw).toHaveBeenCalledTimes(1);
      expect(writeRaw.mock.calls[0][0]).toBe('Caja');
    });

    it(`${name}: compat mode takes the image path`, async () => {
      modes.Fiscal = 'compat';
      await expect(print('Fiscal')).rejects.toThrow('render-window-created');
      expect(writeRaw).not.toHaveBeenCalled();
    });
  }
});

describe('text path details', () => {
  const hasCut = (bytes) => Array.from(bytes).some((b, i, all) => b === 0x1d && all[i + 1] === 0x56);

  it('cuts only when the printer has the automatic cut on (KD6)', async () => {
    cutters.Caja = false;
    await printReceipt(receipt, 'Caja');
    expect(hasCut(writeRaw.mock.calls[0][1])).toBe(false);

    cutters.Caja = true;
    await printReceipt(receipt, 'Caja');
    expect(hasCut(writeRaw.mock.calls[1][1])).toBe(true);
  });

  it('a comanda never waits on the location logo', async () => {
    await printOrder({ order, restaurant: { name: 'Bar', receiptSettings: { logoUrl: 'https://cdn/logo.png' } } }, 'Caja');
    expect(logoGet).not.toHaveBeenCalled();
  });

  it('a receipt with a location logo asks the logo cache for it', async () => {
    await printReceipt({ ...receipt, restaurant: { name: 'Bar', receiptSettings: { logoUrl: 'https://cdn/logo.png' } } }, 'Caja');
    expect(logoGet).toHaveBeenCalledWith('https://cdn/logo.png', 576);
  });
});
