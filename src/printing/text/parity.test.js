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

  // RG 1415, Anexo II, Apartado A, I), a), 5: a monotributista prints "Responsable Monotributo",
  // never "IVA Monotributo".
  it('factura de un monotributista imprime su propia leyenda sin el prefijo IVA', async () => {
    const invoiceData = {
      razonSocialEmisor: 'Pentos SRL', domicilioEmisor: 'Av. Siempre Viva 123', docEmisorFormatted: '20123456786',
      ingresosBrutosEmisor: '', inicioActividadEmisor: '20200101',
      condicionIvaEmisorLabel: 'Monotributo', condicionIvaEmisorLegend: 'Responsable Monotributo',
      tipoComprobanteLabel: 'Factura C', tipoComprobante: 11, razonSocialReceptor: 'Consumidor Final',
      tipoDocReceptorLabel: 'DNI', docReceptorFormatted: '0', condicionIvaReceptorLabel: 'Consumidor Final',
      puntoVenta: 3, numeroComprobante: 1, cae: '74123456789012', vencimientoCAEFormatted: '10/10/2026',
      fechaEmision: '2026-09-29', total: 24300,
    };
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', invoiceData);
    const blocks = buildInvoice({ order, restaurant, invoiceData }, ctx);
    expectInBoth(html, blocks, ['Responsable Monotributo']);
    expect(htmlText(html)).not.toContain('IVA Monotributo');
    expect(blocksText(blocks)).not.toContain('IVA Monotributo');
  }, 20000);

  // A POS that predates condicionIvaEmisorLegend only sends the label.
  it('factura de un POS sin leyenda cae en el prefijo IVA de siempre', async () => {
    const invoiceData = {
      razonSocialEmisor: 'Pentos SRL', docEmisorFormatted: '30-71234567-8', condicionIvaEmisorLabel: 'Responsable Inscripto',
      tipoComprobanteLabel: 'Factura B', tipoComprobante: 6, puntoVenta: 3, numeroComprobante: 1,
      fechaEmision: '2026-09-29', total: 100,
    };
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', invoiceData);
    expectInBoth(html, buildInvoice({ order, restaurant, invoiceData }, ctx), ['IVA Responsable Inscripto']);
  }, 20000);

  it('factura', async () => {
    const invoiceData = {
      razonSocialEmisor: 'Pentos SRL', domicilioEmisor: 'Av. Siempre Viva 123', docEmisor: '30712345678',
      docEmisorFormatted: '30-71234567-8', ingresosBrutosEmisor: '901-123', inicioActividadEmisor: '20200101',
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

  it('nota de crédito', async () => {
    const invoiceData = {
      razonSocialEmisor: 'Pentos SRL', domicilioEmisor: 'Av. Siempre Viva 123', docEmisor: '30712345678',
      docEmisorFormatted: '30-71234567-8', ingresosBrutosEmisor: '901-123', inicioActividadEmisor: '20200101',
      condicionIvaEmisorLabel: 'Responsable Inscripto', tipoComprobanteLabel: 'NOTA DE CRÉDITO B', tipoComprobante: 8,
      razonSocialReceptor: 'Consumidor Final', tipoDocReceptorLabel: 'DNI', docReceptorFormatted: '0',
      condicionIvaReceptorLabel: 'IVA Consumidor Final', puntoVenta: 3, numeroComprobante: 5, impIVA: 4217.36,
      otrosImpuestosNacionales: 0, cae: '74123456789012', vencimientoCAEFormatted: '10/10/2026',
      fechaEmision: '2026-09-29', total: 24300,
      isCreditNote: true,
      comprobanteAsociado: { letra: 'B', puntoVenta: 3, numeroComprobante: 1234 },
      fechaHoraEmision: '2026-10-21T15:30:00.000Z',
    };
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', invoiceData);
    const blocks = buildInvoice({ order, restaurant, invoiceData }, ctx);
    const emission = new Date(invoiceData.fechaHoraEmision);
    expectInBoth(html, blocks, [
      'NOTA DE CRÉDITO B (COD 8)', 'Fac. B: 0003-00001234', 'Comprobante: 0003-00000005',
      'Milanesa napolitana', '$25.000,00', 'TOTAL', '$24.300,00', '74123456789012', '10/10/2026',
      emission.toLocaleDateString(), emission.toLocaleTimeString(),
    ]);
  }, 20000);

  it('factura: no associated invoice line', async () => {
    const invoiceData = {
      razonSocialEmisor: 'Pentos SRL', docEmisorFormatted: '30-71234567-8', tipoComprobanteLabel: 'Factura B', tipoComprobante: 6,
      razonSocialReceptor: 'Consumidor Final', puntoVenta: 3, numeroComprobante: 1234, cae: '74123456789012',
      vencimientoCAEFormatted: '10/10/2026', fechaEmision: '2026-09-29', total: 24300,
    };
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', invoiceData);
    const blocks = buildInvoice({ order, restaurant, invoiceData }, ctx);
    expect(htmlText(html)).not.toContain('Fac.');
    expect(blocksText(blocks)).not.toContain('Fac.');
    expect(htmlText(html)).not.toContain('{{');
  }, 20000);

  const legendInvoice = {
    razonSocialEmisor: 'Pentos SRL', domicilioEmisor: 'Av. Siempre Viva 123', docEmisor: '30712345678',
    docEmisorFormatted: '30-71234567-8', ingresosBrutosEmisor: '901-123', inicioActividadEmisor: '20200101',
    condicionIvaEmisorLabel: 'Responsable Inscripto', tipoComprobanteLabel: 'Factura B', tipoComprobante: 6,
    razonSocialReceptor: 'Consumidor Final', tipoDocReceptorLabel: 'DNI', docReceptorFormatted: '0',
    condicionIvaReceptorLabel: 'IVA Consumidor Final', puntoVenta: 3, numeroComprobante: 1234, impIVA: 4217.36,
    otrosImpuestosNacionales: 0, cae: '74123456789012', vencimientoCAEFormatted: '10/10/2026',
    fechaEmision: '2026-09-29', total: 24300,
  };

  it('factura con leyenda de IIBB: ambos imprimen las líneas, antes del QR', async () => {
    const iibbLegend = ['ALÍCUOTA ISIB CABA 3,00%', 'APLICABLE SOBRE INGRESOS BRUTOS ATRIBUIDOS A CABA'];
    const data = { ...legendInvoice, iibbLegend };
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', data);
    const blocks = buildInvoice({ order, restaurant, invoiceData: data }, ctx);
    expectInBoth(html, blocks, iibbLegend);
    expect(html.indexOf(iibbLegend[0])).toBeLessThan(html.indexOf('<div class="qr-section">'));
    expect(html.indexOf(iibbLegend[0])).toBeGreaterThan(html.indexOf('Otros tributos nacionales indirectos'));
    const firstLine = blocks.findIndex((b) => b.text === iibbLegend[0]);
    expect(firstLine).toBeGreaterThan(-1);
    expect(firstLine).toBeLessThan(blocks.findIndex((b) => b.type === 'qr'));
  });

  it('factura sin leyenda: no agrega nada ni deja el marcador', async () => {
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', legendInvoice);
    expect(html).not.toContain('{{invoiceData.iibbLegend}}');
    expect(html).not.toContain('iibb-legend');
  });

  it('la leyenda queda escapada en la imagen', async () => {
    const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', { ...legendInvoice, iibbLegend: ['A <b>B</b>'] });
    expect(html).toContain('A &lt;b&gt;B&lt;/b&gt;');
  });

  it('factura sin pedido: both renderers fail with the same clear message', async () => {
    await expect(generateHtmlFromTemplate(null, restaurant, 'modern-invoice.html', 'invoice', {})).rejects.toThrow('Falta el pedido del comprobante');
    expect(() => buildInvoice({ order: null, restaurant, invoiceData: {} }, ctx)).toThrow('Falta el pedido del comprobante');
  });

  it('comanda', async () => {
    const orderWithCaller = { ...order, callButton: 'B12', deliveryName: 'Juan' };
    const html = await generateHtmlFromTemplate(orderWithCaller, restaurant, 'modern-order.html', 'order');
    const blocks = buildOrder({ order: orderWithCaller, restaurant }, ctx);
    expectInBoth(html, blocks, [
      '#42', 'Mesa:', 'Nombre:', 'Juan', 'Llamador:', 'B12', 'Mesero:', 'Ana',
      '2x', 'Milanesa napolitana', 'Nota:', 'sin sal', '1x', 'Coca', 'NOTAS:', 'apurar la mesa',
    ]);
  });

  it.each([
    ['delivery', 'DELIVERY'],
    ['counter', 'MOSTRADOR'],
    ['takeout', 'PARA LLEVAR'],
  ])('comanda de %s sin nombre: ambos muestran el tipo', async (orderType, title) => {
    const noName = { ...order, table: undefined, orderType };
    const html = await generateHtmlFromTemplate(noName, restaurant, 'modern-order.html', 'order');
    expectInBoth(html, buildOrder({ order: noName, restaurant }, ctx), [`-- ${title} --`]);
  });

  // KTD11: the generic notice (title + lines) is drawn at the top of every ticket by both renderers.
  describe('aviso generico', () => {
    const notice = { title: 'ATRASADA', lines: ['Comandado a las: 21:10', 'Hora actual: 21:35'] };
    const invoiceData = {
      razonSocialEmisor: 'Pentos SRL', domicilioEmisor: 'Av. Siempre Viva 123', docEmisor: '30712345678',
      docEmisorFormatted: '30-71234567-8', ingresosBrutosEmisor: '901-123', inicioActividadEmisor: '20200101',
      condicionIvaEmisorLabel: 'Responsable Inscripto', tipoComprobanteLabel: 'Factura B', tipoComprobante: 6,
      razonSocialReceptor: 'Consumidor Final', tipoDocReceptorLabel: 'DNI', docReceptorFormatted: '0',
      condicionIvaReceptorLabel: 'Consumidor Final', puntoVenta: 3, numeroComprobante: 1234, impIVA: 100,
      otrosImpuestosNacionales: 0, cae: '74123456789012', vencimientoCAEFormatted: '10/10/2026',
      fechaEmision: '2026-09-29', total: 24300,
    };
    const shown = ['ATRASADA', 'Comandado a las: 21:10', 'Hora actual: 21:35'];
    // The notice is the first thing on the ticket: its last line comes before the usual header.
    const before = (text, header) => {
      const lastLine = text.indexOf('Hora actual: 21:35');
      expect(lastLine).toBeGreaterThan(-1);
      expect(text.indexOf(header)).toBeGreaterThan(lastLine);
    };

    it('comanda', async () => {
      const html = await generateHtmlFromTemplate(order, restaurant, 'modern-order.html', 'order', undefined, null, notice);
      const blocks = buildOrder({ order, restaurant, notice }, ctx);
      expectInBoth(html, blocks, shown);
      before(htmlText(html), '#42');
      before(blocksText(blocks), '#42');
    });

    it('precuenta', async () => {
      const html = await generateHtmlFromTemplate(order, restaurant, 'modern-receipt.html', 'receipt', undefined, null, notice);
      const blocks = buildReceipt({ order, restaurant, notice }, ctx);
      expectInBoth(html, blocks, shown);
      before(htmlText(html), 'Pentos Castelar');
      before(blocksText(blocks), 'Pentos Castelar');
    });

    it('factura', async () => {
      const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', 'invoice', invoiceData, null, notice);
      const blocks = buildInvoice({ order, restaurant, invoiceData, notice }, ctx);
      expectInBoth(html, blocks, shown);
      before(htmlText(html), 'Pentos Castelar');
      before(blocksText(blocks), 'Pentos Castelar');
    }, 20000);

    it.each(['table-receipt.html', 'classic-table-receipt.html', 'branded-receipt.html'])('%s lleva el aviso arriba', async (template) => {
      const html = await generateHtmlFromTemplate(order, restaurant, template, 'receipt', undefined, null, notice);
      expectInBoth(html, buildReceipt({ order, restaurant, notice }, ctx), shown);
      before(htmlText(html), 'Pentos Castelar');
    });

    it('el aviso queda escapado en la imagen', async () => {
      const html = await generateHtmlFromTemplate(order, restaurant, 'modern-order.html', 'order', undefined, null, { title: '<b>X</b> & "y"', lines: ['<img src=x>'] });
      expect(html).not.toContain('<b>X</b>');
      expect(html).not.toContain('<img src=x>');
      expect(html).toContain('&lt;b&gt;X&lt;/b&gt; &amp; &quot;y&quot;');
    });

    it('el texto del aviso sale tal cual: ni patrones de reemplazo ni marcadores de la plantilla', async () => {
      const tricky = { title: "Total $& $1 $' $$", lines: ['{{order.table}} {{restaurant.name}}'] };
      const html = await generateHtmlFromTemplate(order, restaurant, 'modern-order.html', 'order', undefined, null, tricky);
      expect(html).toContain("Total $&amp; $1 $&#39; $$");
      expect(html).toContain('{{order.table}} {{restaurant.name}}');
    });

    it('sin aviso, ninguna plantilla lo dibuja ni deja el marcador', async () => {
      // The templates print the current time with seconds when the order has no date of its
      // own, so two renders straddling a second boundary would differ. Freeze only Date.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-16T21:10:00'));
      try {
        for (const [template, type] of [['modern-order.html', 'order'], ['modern-receipt.html', 'receipt'], ['table-receipt.html', 'receipt'], ['classic-table-receipt.html', 'receipt'], ['branded-receipt.html', 'receipt']]) {
          for (const empty of [undefined, null, {}, { title: '', lines: [] }]) {
            const html = await generateHtmlFromTemplate(order, restaurant, template, type, undefined, null, empty);
            expect(html).not.toContain('{{notice}}');
            expect(html).not.toContain('data-notice');
            expect(html).toBe(await generateHtmlFromTemplate(order, restaurant, template, type, undefined, null));
          }
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('ticket de mesa con nombre: ambos lo imprimen', async () => {
    const named = { ...order, deliveryName: 'Juan' };
    const html = await generateHtmlFromTemplate(named, restaurant, 'modern-receipt.html', 'receipt');
    expectInBoth(html, buildReceipt({ order: named, restaurant }, ctx), ['Nombre:', 'Juan']);
  });

  it('un ticket de mostrador sin nombre no repite el tipo en un recuadro', async () => {
    const counter = { ...order, table: undefined, orderType: 'counter' };
    const html = await generateHtmlFromTemplate(counter, restaurant, 'modern-receipt.html', 'receipt');
    expect(html).not.toContain('-- MOSTRADOR --');
    expect(buildReceipt({ order: counter, restaurant }, ctx).map((b) => b.text).join('\n')).not.toContain('-- MOSTRADOR --');
  });

  const sales = {
    total: 50000, totalDiscounts: 5000, grossRevenue: 55000, discountCount: 3,
    byMethod: [{ name: 'cash', total: 30000 }, { name: 'Mercado Pago', total: 20000 }],
    internalConsumption: { totalOrders: 4, totalCost: 7350 },
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
      'Consumo interno (no es venta)', 'Valorizado', '$7.350,00',
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
      'Consumo interno (no es venta)', 'Valorizado', '$7.350,00',
    ]);
  });

  it('cierre y Z sin consumo interno: ninguno de los dos imprime la seccion', async () => {
    const none = { ...sales, internalConsumption: { totalOrders: 0, totalCost: 0 } };
    const close = { sales: none };
    const z = { businessDate: '2026-09-29', sales: none };
    for (const [html, blocks] of [
      [await renderCashCloseHtml(close, restaurant), buildCashClose({ summary: close, restaurant }, ctx)],
      [await renderDayZHtml(z, restaurant), buildDayZ({ summary: z, restaurant }, ctx)],
    ]) {
      expect(htmlText(html)).not.toContain('Consumo interno');
      expect(blocksText(blocks)).not.toContain('Consumo interno');
    }
  });
  const cancellations = { orderCount: 2, unitCount: 5, cost: 1200, costIncomplete: false, saleValue: 5000 };

  it('cierre con anulaciones: ambos imprimen el bloque con las mismas cifras', async () => {
    const summary = { sales, cancellations };
    const html = await renderCashCloseHtml(summary, restaurant);
    const blocks = buildCashClose({ summary, restaurant }, ctx);
    expectInBoth(html, blocks, [
      'Anulaciones (no afecta los numeros de ventas)', 'Pedidos', 'Items', 'Costo que hubiera representado', '$1.200,00',
      'Precio de venta que hubiera representado', '$5.000,00',
    ]);
    expect(htmlText(html)).not.toContain('incompleto');
    expect(blocksText(blocks)).not.toContain('incompleto');
  });

  it('cierre con anulaciones en cero: ambos imprimen "Sin anulaciones" y ninguna cifra', async () => {
    const summary = { sales, cancellations: { orderCount: 0, unitCount: 0, cost: 0, costIncomplete: false, saleValue: 0 } };
    const html = await renderCashCloseHtml(summary, restaurant);
    const blocks = buildCashClose({ summary, restaurant }, ctx);
    expectInBoth(html, blocks, ['Anulaciones (no afecta los numeros de ventas)', 'Sin anulaciones']);
    expect(htmlText(html)).not.toContain('Costo que hubiera representado');
    expect(blocksText(blocks)).not.toContain('Costo que hubiera representado');
  });

  it('cierre de un turno anterior a la funcion (sin el objeto): ninguno imprime el bloque', async () => {
    const summary = { sales };
    const html = await renderCashCloseHtml(summary, restaurant);
    const blocks = buildCashClose({ summary, restaurant }, ctx);
    expect(htmlText(html)).not.toContain('Anulaciones');
    expect(blocksText(blocks)).not.toContain('Anulaciones');
    expect(htmlText(html)).not.toContain('Sin anulaciones');
  });

  it('cierre con costo incompleto: ambos lo marcan; sin ningun costo conocido dicen "sin costo"', async () => {
    const partial = { sales, cancellations: { ...cancellations, costIncomplete: true } };
    const none = { sales, cancellations: { ...cancellations, cost: 0, costIncomplete: true } };
    for (const [summary, expected, absent] of [[partial, ['$1.200,00', '(incompleto)'], 'sin costo'], [none, ['sin costo'], '(incompleto)']]) {
      const html = await renderCashCloseHtml(summary, restaurant);
      const blocks = buildCashClose({ summary, restaurant }, ctx);
      expectInBoth(html, blocks, expected);
      expect(htmlText(html)).not.toContain(absent);
      expect(blocksText(blocks)).not.toContain(absent);
    }
  });

  it('el Z del dia no imprime anulaciones (solo el cierre de caja)', async () => {
    const z = { businessDate: '2026-09-29', sales, cancellations };
    expect(htmlText(await renderDayZHtml(z, restaurant))).not.toContain('Anulaciones');
    expect(blocksText(buildDayZ({ summary: z, restaurant }, ctx))).not.toContain('Anulaciones');
  });
});
