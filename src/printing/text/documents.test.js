import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { layoutContext, buildReceipt, buildInvoice, buildOrder, buildOrderUpdate, buildCashClose, buildDayZ } from './documents.js';
import { encodeDocument } from './text-encoder.js';
import { buildTextTestPage } from './test-page.js';

const texts = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text);
const indexOf = (blocks, predicate) => blocks.findIndex(predicate);
const has = (blocks, fragment) => texts(blocks).some((t) => t.includes(fragment));

const invoiceData = {
  razonSocialEmisor: 'Pentos SRL', domicilioEmisor: 'Av. Siempre Viva 123', docEmisor: '30712345678',
  docEmisorFormatted: '30-71234567-8', ingresosBrutosEmisor: '123', inicioActividadEmisor: '01/01/2020',
  condicionIvaEmisorLabel: 'Responsable Inscripto', tipoComprobanteLabel: 'Factura B', tipoComprobante: 6,
  // Shapes as the server stores them (invoicing.controller.js): AFIP's
  // YYYYMMDD CbteFch, string CUIT and receiver document fields.
  razonSocialReceptor: 'Consumidor Final', tipoDocReceptorLabel: 'DNI', tipoDocReceptor: '99', docReceptor: '0', docReceptorFormatted: '0',
  condicionIvaReceptorLabel: 'Consumidor Final', puntoVenta: 3, numeroComprobante: 1234, impIVA: 100,
  otrosImpuestosNacionales: 0, cae: '74123456789012', vencimientoCAEFormatted: '10/10/2026',
  fechaEmision: '20260929', total: 40000,
};

const afipPayload = (url) => JSON.parse(Buffer.from(new URL(url).searchParams.get('p'), 'base64url').toString());

const items = (n) => Array.from({ length: n }, (_, i) => ({ name: `Plato ${i + 1}`, price: 1000, quantity: 1 }));

describe('buildInvoice', () => {
  it('Covers AE2: a 40-item invoice keeps every item, then the total, the QR and the footer, in that order', () => {
    const ctx = layoutContext({ paper: '80mm', settings: { footerMessage: 'Gracias, vuelva pronto' } });
    const blocks = buildInvoice({ order: { items: items(40), orderTotal: 40000 }, restaurant: { name: 'Pentos' }, invoiceData }, ctx);

    for (let i = 1; i <= 40; i++) expect(has(blocks, `Plato ${i} x1`)).toBe(true);
    const lastItem = indexOf(blocks, (b) => b.type === 'text' && b.text.includes('Plato 40 x1'));
    const total = indexOf(blocks, (b) => b.type === 'text' && b.text.startsWith('TOTAL'));
    const qr = indexOf(blocks, (b) => b.type === 'qr');
    const footer = indexOf(blocks, (b) => b.type === 'text' && b.text.includes('Gracias, vuelva pronto'));
    expect(lastItem).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(lastItem);
    expect(qr).toBeGreaterThan(total);
    expect(footer).toBeGreaterThan(qr);
  });

  it('carries the same AFIP QR URL as the HTML path', () => {
    const blocks = buildInvoice({ order: { items: items(1), orderTotal: 1000 }, invoiceData }, layoutContext());
    const qr = blocks.find((b) => b.type === 'qr');
    expect(qr.data.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true);
  });

  it('encodes the AFIP QR payload with the RG 4892 field types', () => {
    const blocks = buildInvoice({ order: { items: items(1), orderTotal: 1000 }, invoiceData }, layoutContext());
    const payload = afipPayload(blocks.find((b) => b.type === 'qr').data);
    expect(payload).toEqual({
      ver: 1, fecha: '2026-09-29', cuit: 30712345678, ptoVta: 3, tipoCmp: 6, nroCmp: 1234,
      importe: 40000, moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E', codAut: 74123456789012,
    });
  });

  it('leaves a blank line above the QR, matching the one below it', () => {
    const blocks = buildInvoice({ order: { items: items(1), orderTotal: 1000 }, invoiceData }, layoutContext());
    const qr = indexOf(blocks, (b) => b.type === 'qr');
    expect(blocks[qr - 1]).toEqual({ type: 'feed', lines: 1 });
  });

  it('emits no QR block for an invoice without CAE', () => {
    const blocks = buildInvoice({ order: { items: items(1), orderTotal: 1000 }, invoiceData: { ...invoiceData, cae: '' } }, layoutContext());
    expect(blocks.some((b) => b.type === 'qr')).toBe(false);
  });
});

describe('buildReceipt', () => {
  it('uses the default thank-you line when the location has no footer message', () => {
    const blocks = buildReceipt({ order: { items: [], orderTotal: 0 }, restaurant: {} }, layoutContext());
    expect(has(blocks, '¡Gracias por su compra!')).toBe(true);
  });

  it('replaces the default thank-you line with the location footer, without printing both', () => {
    const blocks = buildReceipt(
      { order: { items: [], orderTotal: 0 }, restaurant: {} },
      layoutContext({ settings: { footerMessage: 'Seguinos en @pentos' } }),
    );
    expect(has(blocks, 'Seguinos en @pentos')).toBe(true);
    expect(has(blocks, '¡Gracias por su compra!')).toBe(false);
    expect(has(blocks, 'TICKET NO VALIDO COMO FACTURA')).toBe(true);
  });

  it('skips voided lines and shows the discount above the total', () => {
    const order = {
      items: [{ name: 'Cafe', price: 1500, quantity: 2 }, { name: 'Anulado', price: 999, quantity: 0 }],
      orderTotal: 2700, discount: { amount: 300, mode: 'percent', value: 10 },
    };
    const blocks = buildReceipt({ order, restaurant: { name: 'Bar' } }, layoutContext());
    expect(has(blocks, 'Cafe x2')).toBe(true);
    expect(has(blocks, 'Anulado')).toBe(false);
    const discount = indexOf(blocks, (b) => b.type === 'text' && b.text.startsWith('Descuento (10%)'));
    const total = indexOf(blocks, (b) => b.type === 'text' && b.text.startsWith('TOTAL'));
    expect(discount).toBeGreaterThan(-1);
    expect(total).toBeGreaterThan(discount);
  });

  it('keeps every line within the paper columns on 58mm', () => {
    const ctx = layoutContext({ paper: '58mm' });
    const blocks = buildReceipt({ order: { items: [{ name: 'Milanesa napolitana con papas fritas y ensalada', price: 12500, quantity: 1 }], orderTotal: 12500 }, restaurant: { name: 'Bar' } }, ctx);
    for (const b of blocks.filter((x) => x.type === 'text')) {
      const limit = b.width === 2 ? ctx.cols / 2 : ctx.cols;
      expect(b.text.length).toBeLessThanOrEqual(limit);
    }
  });
});

describe('buildOrder / buildOrderUpdate', () => {
  it('prints the comanda items quantity first, with their per-unit note', () => {
    const blocks = buildOrder({ order: { dailyOrderNumber: 42, table: '5', items: [{ name: 'Pizza', quantity: 1, note: 'sin aceitunas' }] } }, layoutContext());
    expect(has(blocks, '#42')).toBe(true);
    expect(has(blocks, '1x Pizza')).toBe(true);
    expect(has(blocks, 'Nota: sin aceitunas')).toBe(true);
  });

  it('marks added and cancelled lines like the HTML update chit, cancelled inverted', () => {
    const lines = [
      { kind: 'add', quantity: 2, name: 'Empanada' },
      { kind: 'cancel', quantity: 1, name: 'Flan' },
      { kind: 'modify', quantity: 3, name: 'Coca' },
    ];
    const blocks = buildOrderUpdate({ order: { dailyOrderNumber: 7, orderType: 'dine-in', table: '3' }, lines }, layoutContext());
    expect(has(blocks, '** ACTUALIZACION **')).toBe(true);
    expect(has(blocks, '+ 2x Empanada')).toBe(true);
    const cancel = blocks.find((b) => b.type === 'text' && b.text.includes('CANCELAR: 1x Flan'));
    expect(cancel.invert).toBe(true);
    expect(has(blocks, 'MODIFICAR: 3x Coca')).toBe(true);
  });
});

describe('buildCashClose / buildDayZ', () => {
  it('builds the cash close sections', () => {
    const summary = { registerName: 'Caja 1', sales: { total: 5000, byMethod: [{ name: 'cash', total: 5000 }] }, openingFloat: 1000, expectedAtClose: 6000, closingCount: 5900, variance: -100 };
    const blocks = buildCashClose({ summary, restaurant: { name: 'Bar' } }, layoutContext());
    expect(has(blocks, 'Cierre de caja')).toBe(true);
    expect(has(blocks, 'Efectivo')).toBe(true);
    expect(texts(blocks).some((t) => t.startsWith('Diferencia') && t.endsWith('-$100,00'))).toBe(true);
  });

  it('builds the day Z header and date', () => {
    const blocks = buildDayZ({ summary: { businessDate: '2026-09-29', sales: {} }, restaurant: { name: 'Bar' } }, layoutContext());
    expect(has(blocks, 'Z del dia (interno)')).toBe(true);
    expect(texts(blocks).some((t) => t.endsWith('29/09/2026'))).toBe(true);
  });
});

const containsBytes = (arr, seq) => arr.some((_, i) => seq.every((v, j) => arr[i + j] === v));

// Width in dots of the first GS v 0 raster image in the output.
const rasterWidth = (bytes) => {
  const output = Array.from(bytes);
  const i = output.findIndex((byte, j) => byte === 0x1d && output[j + 1] === 0x76 && output[j + 2] === 0x30);
  return i < 0 ? null : (output[i + 4] + output[i + 5] * 256) * 8;
};

describe('text-mode QR', () => {
  const invoiceBlocks = buildInvoice({ order: { items: items(1), orderTotal: 1000 }, invoiceData }, layoutContext());
  const invoiceQr = invoiceBlocks.find((block) => block.type === 'qr').data;
  const invoiceModules = QRCode.create(invoiceQr, { errorCorrectionLevel: 'M' }).modules.size;

  it('prints as a raster image, never the native QR command some 58mm firmwares ignore', () => {
    const bytes = Array.from(encodeDocument([{ type: 'qr', data: invoiceQr }], layoutContext({ paper: '58mm' })));
    expect(containsBytes(bytes, [0x1d, 0x28, 0x6b])).toBe(false);
    expect(rasterWidth(bytes)).not.toBeNull();
  });

  it('fits an AFIP QR with its quiet zone: 4 dots per module on 58mm, 5 on 80mm', () => {
    for (const [paper, moduleDots, paperDots] of [['58mm', 4, 384], ['80mm', 5, 576]]) {
      const width = rasterWidth(encodeDocument([{ type: 'qr', data: invoiceQr }], layoutContext({ paper })));
      expect(width).toBe(Math.ceil(((invoiceModules + 8) * moduleDots) / 8) * 8);
      expect(width).toBeLessThanOrEqual(paperDots);
    }
  });
});

describe('encodeDocument', () => {
  const ctx = layoutContext();
  const bytesOf = (text, options = { cutter: false }) => Array.from(encodeDocument([{ type: 'text', text }], ctx, options));
  const containsSeq = (arr, seq) => arr.some((_, i) => seq.every((v, j) => arr[i + j] === v));
  const CUT_PREFIX = [0x1d, 0x56];

  it('selects CP858 and encodes accents, ñ and $ with its bytes', () => {
    const bytes = bytesOf('Ñoquis ñandú $ 1.234,50 á é í ó ú');
    expect(containsSeq(bytes, [0x1b, 0x74, 0x13])).toBe(true); // ESC t 19 = CP858 on Epson mapping
    expect(containsSeq(bytes, [0xa5, 0x6f, 0x71])).toBe(true); // "Ñoq"
    expect(containsSeq(bytes, [0xa4, 0x61, 0x6e, 0x64, 0xa3])).toBe(true); // "ñandú"
    expect(containsSeq(bytes, [0x24, 0x20, 0x31])).toBe(true); // "$ 1"
    expect(containsSeq(bytes, [0xa0, 0x20, 0x82, 0x20, 0xa1, 0x20, 0xa2, 0x20, 0xa3])).toBe(true);
  });

  it('uses the selected codepage for accent bytes', () => {
    const bytes = bytesOf('á é í ó ú ñ Ñ', { cutter: false, codepage: 'cp437' });
    expect(containsSeq(bytes, [0x1b, 0x74, 0x00])).toBe(true);
    expect(containsSeq(bytes, [0xa0, 0x20, 0x82, 0x20, 0xa1, 0x20, 0xa2, 0x20, 0xa3])).toBe(true);
  });

  it('feeds enough blank lines after the final receipt row for the cutter', () => {
    const ctx = layoutContext({ settings: { footerMessage: 'Mensaje personalizado' } });
    const blocks = buildReceipt({ order: { items: [], orderTotal: 0 }, restaurant: {} }, ctx);
    const bytes = encodeDocument(blocks, ctx, { cutter: true });
    const cutAt = bytes.findIndex((b, i, all) => b === 0x1d && all[i + 1] === 0x56);
    let lineFeeds = 0;
    for (let i = cutAt - 1; i >= 0 && bytes[i] === 0x0a; i--) lineFeeds++;
    expect(cutAt).toBeGreaterThan(-1);
    expect(lineFeeds).toBeGreaterThanOrEqual(6);
  });

  it('emits no cut command when the printer has the cut off', () => {
    expect(containsSeq(bytesOf('hola', { cutter: false }), CUT_PREFIX)).toBe(false);
  });

  it('emits exactly one cut, at the end, when the printer has the cut on', () => {
    const bytes = bytesOf('hola', { cutter: true });
    const cuts = bytes.map((_, i) => i).filter((i) => bytes[i] === 0x1d && bytes[i + 1] === 0x56);
    expect(cuts).toHaveLength(1);
    expect(bytes.length - cuts[0]).toBeLessThanOrEqual(4);
  });
});

describe('receipt settings per location (R13, R14)', () => {
  const order = { items: [{ name: 'Cafe', price: 1500, quantity: 1 }], orderTotal: 1500 };
  const settings = { fontSize: 'grande', footerMessage: 'Seguinos en @pentos' };

  it('Covers AE4: grande is double height on both widths; totals double width only on 80mm', () => {
    const wide = buildReceipt({ order, restaurant: {} }, layoutContext({ paper: '80mm', settings }));
    const narrow = buildReceipt({ order, restaurant: {} }, layoutContext({ paper: '58mm', settings }));
    const item = (blocks) => blocks.find((b) => b.type === 'text' && b.text.startsWith('Cafe x1'));
    const total = (blocks) => blocks.find((b) => b.type === 'text' && b.text.startsWith('TOTAL'));
    expect(item(wide).height).toBe(2);
    expect(item(narrow).height).toBe(2);
    expect(item(wide).width ?? 1).toBe(1);
    expect(item(narrow).width ?? 1).toBe(1);
    expect(total(wide).width).toBe(2);
    expect(total(narrow).width ?? 1).toBe(1);
    expect(total(narrow).height).toBe(2);
  });

  it('normal keeps body text at 1x', () => {
    const blocks = buildReceipt({ order, restaurant: {} }, layoutContext({ paper: '80mm', settings: { fontSize: 'normal' } }));
    expect(blocks.find((b) => b.type === 'text' && b.text.startsWith('Cafe x1')).height).toBe(1);
  });

  it('replaces the thank-you line before the fixed invoice disclaimer', () => {
    const blocks = buildReceipt({ order, restaurant: {} }, layoutContext({ settings }));
    const footer = indexOf(blocks, (b) => b.type === 'text' && b.text.includes('Seguinos en @pentos'));
    const disclaimer = indexOf(blocks, (b) => b.type === 'text' && b.text.includes('TICKET NO VALIDO COMO FACTURA'));
    expect(has(blocks, '¡Gracias por su compra!')).toBe(false);
    expect(disclaimer).toBeGreaterThan(footer);
  });

  it('adds a logo block only when the location has a logo', () => {
    const withLogo = buildReceipt({ order, restaurant: {} }, layoutContext({ settings: { logoUrl: 'https://cdn/logo.png' } }));
    const without = buildReceipt({ order, restaurant: {} }, layoutContext());
    expect(withLogo[0]).toEqual({ type: 'logo', url: 'https://cdn/logo.png' });
    expect(without.some((b) => b.type === 'logo')).toBe(false);
  });

  it('Covers U9: a ticket whose logo could not be loaded still encodes whole', () => {
    const ctx = layoutContext({ settings: { logoUrl: 'https://cdn/missing.png' } });
    const blocks = buildReceipt({ order, restaurant: { name: 'Bar' } }, ctx);
    const bytes = encodeDocument(blocks, ctx, { cutter: true, logo: null });
    const ascii = Buffer.from(bytes).toString('latin1');
    expect(ascii).toContain('TOTAL');
    expect(ascii).toContain('Cafe x1');
  });
});

describe('every document encodes to ESC/POS bytes', () => {
  const order = { dailyOrderNumber: 9, orderType: 'dine-in', table: '2', items: [{ name: 'Cafe', price: 1500, quantity: 1, note: 'sin azucar' }], orderTotal: 1500, notes: 'apurar' };
  const summary = {
    registerName: 'Caja 1', businessDate: '2026-09-29',
    sales: { total: 5000, totalDiscounts: 500, discountCount: 1, byMethod: [{ name: 'cash', total: 5000 }] },
    cashIn: { total: 100, items: [{ label: 'Aporte', amount: 100 }] }, cashOut: { total: 0, items: [] },
    expenses: { currentAccount: { total: 50, items: [{ description: 'Hielo', supplier: 'Frio SA', amount: 50, documentType: 'invoice' }] } },
    waiterSales: [{ label: 'Ana', amount: 5000 }], shifts: [{ status: 'closed', registerName: 'Caja 1', variance: 0 }],
    cashCount: { closedShifts: 1, openShifts: 1 }, closeReason: 'ok',
  };
  const lines = [
    { kind: 'add', quantity: 1, name: 'Flan', modifiers: [{ name: 'con dulce' }] },
    { kind: 'cancel', quantity: 1, name: 'Coca' },
    { kind: 'note', noteStatus: 'modified', noteBefore: 'viejo', noteAfter: 'nuevo' },
  ];
  const cases = {
    receipt: (ctx) => buildReceipt({ order, restaurant: { name: 'Bar' } }, ctx),
    invoice: (ctx) => buildInvoice({ order, restaurant: { name: 'Bar' }, invoiceData }, ctx),
    order: (ctx) => buildOrder({ order }, ctx),
    update: (ctx) => buildOrderUpdate({ order, lines }, ctx),
    cashClose: (ctx) => buildCashClose({ summary, restaurant: { name: 'Bar' } }, ctx),
    dayZ: (ctx) => buildDayZ({ summary, restaurant: { name: 'Bar' } }, ctx),
    testPage: (ctx) => buildTextTestPage({ printerName: 'Caja' }, ctx),
  };
  for (const paper of ['80mm', '58mm']) {
    for (const [name, build] of Object.entries(cases)) {
      it(`${name} on ${paper}`, () => {
        const ctx = layoutContext({ paper, settings: { fontSize: 'grande', footerMessage: 'Gracias' } });
        const bytes = encodeDocument(build(ctx), ctx, { cutter: true, logo: null });
        expect(bytes.length).toBeGreaterThan(50);
      });
    }
  }
});

describe('logo raster', () => {
  it('encodes the logo image when one is loaded', () => {
    const ctx = layoutContext({ settings: { logoUrl: 'https://cdn/logo.png' } });
    const blocks = buildReceipt({ order: { items: [], orderTotal: 0 }, restaurant: { name: 'Bar' } }, ctx);
    const logo = { data: new Uint8Array(64 * 16 * 4).fill(0), width: 64, height: 16 };
    const withLogo = encodeDocument(blocks, ctx, { cutter: false, logo });
    const without = encodeDocument(blocks, ctx, { cutter: false, logo: null });
    expect(withLogo.length).toBeGreaterThan(without.length + 64 * 16 / 8 - 1);
  });
});
