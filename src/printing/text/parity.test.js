import { describe, it, expect, vi } from 'vitest';

// Parity between the two renderers of each printed document: the HTML
// templates (compatibility mode) and the ESC/POS text builders (default mode).
// Text is the default for every printer, so a label, amount or fiscal line
// added to or removed from only one renderer would silently change what most
// tickets print. Each case feeds the same fixture to both renderers and checks
// that every piece of information the fixture produces appears in both. When
// this fails, the two renderers drifted: update the other one to match.

vi.mock('../../core/store.js', () => ({
  getDefaultTemplate: vi.fn(() => 'modern-receipt.html'),
  getLogoSize: vi.fn(() => 50),
  getQRCodeEnabled: vi.fn(() => true),
  getLogoEnabled: vi.fn(() => false),
  getPaperWidth: vi.fn(() => '80mm'),
  getLogoPath: vi.fn(() => null),
}));
vi.mock('../../shared/file-helpers.js', () => ({ getLogoAsBase64: vi.fn(() => null) }));

const { generateHtmlFromTemplate, renderCashCloseHtml, renderDayZHtml } = await import('../template-manager.js');
const { layoutContext, buildReceipt, buildInvoice, buildOrder, buildCashClose, buildDayZ } = await import('./documents.js');

const htmlText = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
const blocksText = (blocks) =>
  blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ');

function expectInBoth(html, blocks, expected) {
  const a = htmlText(html);
  const b = blocksText(blocks);
  const missing = expected
    .filter((s) => !a.includes(s) || !b.includes(s))
    .map((s) => `${s} (html: ${a.includes(s)}, text: ${b.includes(s)})`);
  expect(missing).toEqual([]);
}

const ctx = layoutContext({ paper: '80mm' });

const order = {
  table: '4',
  orderType: 'dine-in',
  waiter: { name: 'Ana' },
  dailyOrderNumber: 42,
  createdAt: '2026-09-29T20:00:00Z',
  items: [
    { name: 'Milanesa napolitana', price: 12500, quantity: 2, note: 'sin sal' },
    { name: 'Coca', price: 2000, quantity: 1 },
    { name: 'Anulado', price: 999, quantity: 0 },
  ],
  orderTotal: 24300,
  discount: { amount: 2700, mode: 'percent', value: 10 },
  notes: 'apurar la mesa',
};
const restaurant = { name: 'Pentos Castelar', address: 'Av. Rivadavia 20000' };

describe('HTML and text renderers print the same information', () => {
  it('precuenta', async () => {
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-receipt.html', 'receipt');
    const blocks = buildReceipt({ order, restaurant }, ctx);
    expectInBoth(html, blocks, [
      'Pentos Castelar', 'Av. Rivadavia 20000', 'Mesa:', 'Mesero:', 'Ana', 'Fecha:', 'Hora:',
      'Milanesa napolitana', '$25.000,00', 'Coca', '$2.000,00',
      'Subtotal', '$27.000,00', 'Descuento (10%)', '-$2.700,00', 'TOTAL', '$24.300,00',
      '¡Gracias por su compra!', 'TICKET NO VALIDO COMO FACTURA',
    ]);
    expect(blocksText(blocks)).not.toContain('Anulado');
    expect(htmlText(html)).not.toContain('Anulado');
  });

  it('factura', async () => {
    const invoiceData = {
      razonSocialEmisor: 'Pentos SRL', domicilioEmisor: 'Av. Siempre Viva 123', docEmisor: '30712345678',
      docEmisorFormatted: '30-71234567-8', ingresosBrutosEmisor: '901-123', inicioActividadEmisor: '01/01/2020',
      condicionIvaEmisorLabel: 'Responsable Inscripto', tipoComprobanteLabel: 'Factura B', tipoComprobante: 6,
      razonSocialReceptor: 'Consumidor Final', tipoDocReceptorLabel: 'DNI', docReceptorFormatted: '0',
      condicionIvaReceptorLabel: 'IVA Consumidor Final', puntoVenta: 3, numeroComprobante: 1234, impIVA: 4217.36,
      otrosImpuestosNacionales: 0, cae: '74123456789012', vencimientoCAEFormatted: '10/10/2026',
      fechaEmision: '2026-09-29', total: 24300,
    };
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', invoiceData);
    const blocks = buildInvoice({ order, restaurant, invoiceData }, ctx);
    expectInBoth(html, blocks, [
      'Pentos Castelar', 'Pentos SRL', 'Av. Siempre Viva 123', 'CUIT: 30-71234567-8', 'IIBB: 901-123',
      'Inicio de Actividades: 01/01/2020', 'IVA Responsable Inscripto', 'Comprobante: 0003-00001234',
      'Factura B (COD 6)', 'Consumidor Final', 'DNI: 0', 'IVA Consumidor Final',
      'Milanesa napolitana', '$25.000,00', 'Subtotal', 'Descuento (10%)', '-$2.700,00', 'TOTAL', '$24.300,00',
      'Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)', 'IVA Contenido', '$4.217,36',
      'Otros tributos nacionales indirectos', '$0,00', '74123456789012', '10/10/2026',
    ]);
    // The HTML path renders the AFIP QR as a PNG, which is slow under load.
  }, 20000);

  it('comanda', async () => {
    const orderWithCaller = { ...order, callButton: 'B12', deliveryName: 'Juan' };
    const html = await generateHtmlFromTemplate(orderWithCaller, restaurant, 'modern-order.html', 'order');
    const blocks = buildOrder({ order: orderWithCaller, restaurant }, ctx);
    expectInBoth(html, blocks, [
      '#42', 'Mesa:', 'Nombre:', 'Juan', 'Llamador:', 'B12', 'Mesero:', 'Ana',
      '2x', 'Milanesa napolitana', 'Nota:', 'sin sal', '1x', 'Coca', 'NOTAS:', 'apurar la mesa',
    ]);
  });

  const sales = {
    total: 50000, totalDiscounts: 5000, grossRevenue: 55000, discountCount: 3,
    byMethod: [{ name: 'cash', total: 30000 }, { name: 'Mercado Pago', total: 20000 }],
  };
  const expense = { description: 'Hielo', supplier: 'Frio SA', amount: 1500, documentType: 'invoice', fiscalCategory: 'A', documentNumber: '0001-00000042' };

  it('cierre de caja', async () => {
    const summary = {
      registerName: 'Caja 1', closedByName: 'Ana', sales,
      cashIn: { total: 1000, items: [{ label: 'Aporte cambio', amount: 1000 }] },
      cashOut: { total: 800, items: [{ label: 'Retiro', meta: 'Pago proveedor', amount: 800 }] },
      openingFloat: 5000, expectedAtClose: 35200, closingCount: 35000, variance: -200,
      expenses: { currentAccount: { total: 1500, items: [expense] }, otherCash: { total: 0, items: [] } },
      totalInvoiced: 20000, closeReason: 'faltante de cambio',
      waiterSales: [{ label: 'Ana', amount: 50000 }],
    };
    const html = await renderCashCloseHtml(summary, restaurant);
    const blocks = buildCashClose({ summary, restaurant }, ctx);
    expectInBoth(html, blocks, [
      'Cierre de caja', 'Caja 1', 'Cajero', 'Ventas (netas)', 'Efectivo', '$30.000,00', 'Mercado Pago', '$20.000,00',
      'Total ventas', '$50.000,00', 'Descuentos otorgados', 'Pedidos con descuento', 'Ventas brutas', '$55.000,00',
      'Total descuentos', '-$5.000,00', 'Ventas netas', 'Tasa de descuento', '9,1%',
      'Aportes', 'Aporte cambio', '$1.000,00', 'Total aportes', 'Retiros', 'Pago proveedor', '$800,00', 'Total retiros',
      'Arqueo (efectivo)', 'Fondo inicial', '$5.000,00', 'Efectivo esperado', '$35.200,00',
      'Efectivo contado', '$35.000,00', 'Diferencia', '-$200,00',
      'Gastos (no afectan el arqueo)', 'Cuenta corriente', 'Hielo', 'Frio SA', 'Factura A 0001-00000042', '$1.500,00',
      'Subtotal cta. cte.', 'Total facturado AFIP', '$20.000,00', 'Observacion', 'faltante de cambio',
      'Venta por mozo', '1. Ana', '100.0%',
    ]);
  });

  it('Z del dia', async () => {
    const summary = {
      location: { name: 'Castelar' }, businessDate: '2026-09-29', sales,
      cashCount: { closedShifts: 1, openShifts: 1, openingFloatTotal: 5000, expectedTotal: 35200, countedTotal: 35000, varianceTotal: -200 },
      shifts: [{ status: 'closed', registerName: 'Caja 1', variance: -200 }, { status: 'open', registerName: 'Caja 2' }],
      expenses: { cashInArqueo: { total: 800, items: [{ description: 'Hielo', amount: 800 }] }, currentAccount: { total: 0, items: [] }, otherCash: { total: 0, items: [] }, grandTotal: 800 },
      totalInvoiced: 20000,
    };
    const html = await renderDayZHtml(summary, restaurant);
    const blocks = buildDayZ({ summary, restaurant }, ctx);
    expectInBoth(html, blocks, [
      'Z del dia (interno)', 'No fiscal', 'Local', 'Castelar', 'Fecha', '29/09/2026',
      'Ventas del dia (netas)', 'Total ventas', '$50.000,00', 'Descuentos otorgados',
      'Arqueo del dia (turnos cerrados: 1)', 'Fondo inicial', 'Efectivo esperado', '$35.200,00', 'Efectivo contado',
      'Diferencia', '-$200,00', 'Turnos en curso: 1', 'Turnos del dia', 'Caja 1', 'Caja 2', 'en curso',
      'Gastos efectivo (en arqueo)', 'Hielo', '$800,00', 'Total gastos del dia', 'Total facturado AFIP', '$20.000,00',
    ]);
  });
});
