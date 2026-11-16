import { describe, it, expect, vi, beforeEach } from 'vitest';

// windows-printer.js wires Electron, the settings store, native transports and
// the template engine at import time. Everything outside the routing decision
// is mocked; the render window throws a sentinel so a test can tell that the
// image path was taken without driving a real offscreen window.
const modes = {};
const codepages = {};
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
  getPrinterCodepage: vi.fn((name) => codepages[name] || 'cp858'),
  getPrinterCharSpacing: vi.fn(() => 0),
  getPaperWidth: vi.fn(() => '80mm'),
}));
const generateHtmlFromTemplate = vi.fn(async () => '<html></html>');
vi.mock('./template-manager.js', () => ({
  generateHtmlFromTemplate,
  renderCashCloseHtml: vi.fn(async () => '<html></html>'),
  renderDayZHtml: vi.fn(async () => '<html></html>'),
}));
vi.mock('./printer-manager.js', () => ({ requireSystemPrinter: vi.fn(async (name) => ({ name })) }));
const ensurePrintableWidth = vi.fn(async () => {});
vi.mock('./paper-geometry.js', () => ({
  getPaperGeometry: vi.fn(() => ({ dots: 576, cssWidth: 309, zoomFactor: 1.86, paper: '80mm' })),
  ensurePrintableWidth,
}));
vi.mock('./calibration-page.js', () => ({ renderCalibrationHtml: vi.fn(() => '') }));
const logoGet = vi.fn(async () => null);
vi.mock('./text/logo-cache.js', async (importOriginal) => ({
  ...(await importOriginal()),
  logoCache: { get: (...args) => logoGet(...args) },
}));
const printBitmapGdi = vi.fn();
vi.mock('./transports/gdi-transport.js', () => ({ printBitmap: printBitmapGdi }));
const writeRaw = vi.fn();
vi.mock('./transports/raw-transport.js', () => ({ printBitmap: vi.fn(), writeRaw }));

const { printReceipt, printInvoice, printOrder, printOrderUpdate, printCashClose, printDayZ, updateChitHeaderHtml, renderOrderUpdateHtml } = await import('./windows-printer.js');
const { layoutContext, buildOrderUpdate } = await import('./text/documents.js');

const receipt = { order: { items: [{ name: 'Cafe', price: 1500, quantity: 1 }], orderTotal: 1500 }, restaurant: { name: 'Bar' } };

beforeEach(() => {
  for (const k of Object.keys(modes)) delete modes[k];
  for (const k of Object.keys(codepages)) delete codepages[k];
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
    expect(logoGet).toHaveBeenCalledWith('https://cdn/logo.png', 288);
  });

  it('encodes text using the selected printer codepage', async () => {
    codepages.Caja = 'cp437';
    await printReceipt(receipt, 'Caja');
    const bytes = Array.from(writeRaw.mock.calls[0][1]);
    expect(bytes.some((byte, index) => byte === 0x1b && bytes[index + 1] === 0x74 && bytes[index + 2] === 0)).toBe(true);
  });
});

describe('update chit header in image mode', () => {
  it('splits every datum into a label and a value, like the original comanda', () => {
    const html = updateChitHeaderHtml({ orderType: 'delivery', deliveryName: 'JUAN', deliveryAddress: 'Roca 1', callButton: 'B1', waiter: { name: 'Ana' } }, new Date());
    for (const [label, value] of [['Nombre:', 'JUAN'], ['Dirección:', 'Roca 1'], ['Llamador:', 'B1'], ['Mesero:', 'Ana']]) {
      expect(html).toContain(`<div class="meta"><span>${label}</span><span>${value}</span></div>`);
    }
    expect(html).toContain('-- DELIVERY --');
  });
});

// KTD11: a notice { title, lines } on the print body is drawn at the top of any ticket.
describe('notice on the print body', () => {
  const notice = { title: 'ATRASADA', lines: ['Comandado a las: 21:10', 'Hora actual: 21:35'] };
  const updateInput = { order, lines: [{ kind: 'add', quantity: 1, name: 'Flan' }] };
  const bytesContain = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));
  const plainText = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

  describe('update chit (image mode)', () => {
    it('draws the title and the lines above the ACTUALIZACION header, in order', () => {
      const text = plainText(renderOrderUpdateHtml({ ...updateInput, notice, now: new Date() }));
      const at = ['ATRASADA', 'Comandado a las: 21:10', 'Hora actual: 21:35', '** ACTUALIZACION **'].map((s) => text.indexOf(s));
      expect(at[0]).toBeGreaterThan(-1);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      expect(new Set(at).size).toBe(4);
    });

    it('prints the same notice text as the text document', () => {
      const text = plainText(renderOrderUpdateHtml({ ...updateInput, notice, now: new Date() }));
      const blocks = buildOrderUpdate({ ...updateInput, notice }, layoutContext());
      for (const piece of [notice.title, ...notice.lines]) {
        expect(text).toContain(piece);
        expect(blocks.some((b) => b.type === 'text' && b.text.includes(piece))).toBe(true);
      }
    });

    it('a title with no lines prints just the title', () => {
      const html = renderOrderUpdateHtml({ ...updateInput, notice: { title: 'ATRASADA' }, now: new Date() });
      expect(plainText(html)).toContain('ATRASADA');
      expect(html.match(/data-notice-line/g)).toBeNull();
    });

    it('escapes the notice text', () => {
      const html = renderOrderUpdateHtml({ ...updateInput, notice: { title: '<b>X</b>', lines: ['<img src=x>'] }, now: new Date() });
      expect(html).not.toContain('<b>X</b>');
      expect(html).not.toContain('<img src=x>');
      expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    });

    it('without a notice draws nothing of it', () => {
      const now = new Date();
      const plain = renderOrderUpdateHtml({ ...updateInput, now });
      expect(plain).not.toContain('data-notice');
      for (const empty of [null, {}, { title: '', lines: [] }]) {
        expect(renderOrderUpdateHtml({ ...updateInput, notice: empty, now })).toBe(plain);
      }
    });

    it('printOrderUpdate in image mode hands the notice to the rendered page', async () => {
      let page = null;
      BrowserWindow.mockImplementationOnce(() => ({
        isDestroyed: () => false,
        destroy: () => {},
        loadURL: async (url) => {
          page = decodeURIComponent(url.replace('data:text/html;charset=utf-8,', ''));
          throw new Error('captured');
        },
      }));
      modes.Fiscal = 'compat';
      await expect(printOrderUpdate({ ...updateInput, notice }, 'Fiscal')).rejects.toThrow('captured');
      expect(plainText(page)).toContain('ATRASADA');
      expect(plainText(page)).toContain('Hora actual: 21:35');
    });
  });

  describe('text mode', () => {
    const prints = {
      comanda: () => printOrder({ order, restaurant: { name: 'Bar' }, notice }, 'Caja'),
      'order update': () => printOrderUpdate({ ...updateInput, notice }, 'Caja'),
      precuenta: () => printReceipt({ ...receipt, notice }, 'Caja'),
      invoice: () => printInvoice({ order: receipt.order, restaurant: receipt.restaurant, invoiceData: {}, notice }, 'Caja'),
    };
    for (const [name, print] of Object.entries(prints)) {
      it(`${name}: the encoded ticket carries the notice`, async () => {
        await print();
        const bytes = writeRaw.mock.calls[0][1];
        expect(bytesContain(bytes, 'ATRASADA')).toBe(true);
        expect(bytesContain(bytes, 'Hora actual: 21:35')).toBe(true);
      });
    }

    it('a ticket whose body has no notice does not print one', async () => {
      await printOrder({ order, restaurant: { name: 'Bar' } }, 'Caja');
      expect(bytesContain(writeRaw.mock.calls[0][1], 'ATRASADA')).toBe(false);
    });
  });

  describe('image mode templates', () => {
    beforeEach(() => { modes.Fiscal = 'compat'; });

    it('receipt, order and invoice hand the notice to the template', async () => {
      await expect(printReceipt({ ...receipt, notice }, 'Fiscal')).rejects.toThrow('render-window-created');
      await expect(printOrder({ order, restaurant: { name: 'Bar' }, notice }, 'Fiscal')).rejects.toThrow('render-window-created');
      await expect(printInvoice({ order: receipt.order, restaurant: receipt.restaurant, invoiceData: {}, notice }, 'Fiscal')).rejects.toThrow('render-window-created');
      expect(generateHtmlFromTemplate.mock.calls.map((call) => call[6])).toEqual([notice, notice, notice]);
    });

    it('a legacy body that is the order itself still carries its notice', async () => {
      await expect(printOrder({ ...order, notice }, 'Fiscal')).rejects.toThrow('render-window-created');
      expect(generateHtmlFromTemplate.mock.calls[0][6]).toEqual(notice);
    });

    it('without a notice the template gets none', async () => {
      await expect(printReceipt(receipt, 'Fiscal')).rejects.toThrow('render-window-created');
      expect(generateHtmlFromTemplate.mock.calls[0][6]).toBeUndefined();
    });
  });
});
