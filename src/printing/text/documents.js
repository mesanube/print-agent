// One builder per printed document for the ESC/POS text path (R6, KTD8). Each
// builder takes the same data the HTML templates receive and returns a list of
// blocks; text-encoder.js turns the blocks into printer bytes. Content and order
// mirror the HTML templates (modern-receipt, modern-invoice, modern-order, the
// inline update chit, cash close and day Z), so switching a printer between
// text and compatibility mode changes the look, not the information.
//
// Block shapes:
//   { type: 'text', text, bold?, invert?, width?: 1|2, height?: 1|2 }
//   { type: 'qr', data }
//   { type: 'logo', url }
//   { type: 'feed', lines }
// Every text block is already laid out to the column grid of its size, so the
// encoder never wraps. Nothing here has a height limit: a document of any
// length prints whole (R8).

import { columnsFor, twoColumns, wrap, center, rule } from './layout.js';
import { formatPrice, PM_LEGACY_LABELS, DOC_TYPE_LABELS } from '../receipt-format.js';
import { generateAfipQRCodeData } from '../qrcode-generator.js';

const money = (amount, { negative = false } = {}) =>
  `${negative ? '-' : ''}$${formatPrice(Number(amount) || 0)}`;

/**
 * Per-document layout context: column counts and text styles derived from the
 * paper width and the location's receipt settings (R14, KTD13).
 * - normal: Font A 1x on both widths.
 * - grande: double height (1x2) on both widths, never double width, so the
 *   column count does not drop.
 * - Totals are double width and height only on 80mm; on 58mm double width
 *   would leave 16 columns, too few for "TOTAL" plus an amount.
 */
export function layoutContext({ paper = '80mm', settings = {} } = {}) {
  const cols = columnsFor(paper);
  const big = settings?.fontSize === 'grande';
  const bodyHeight = big ? 2 : 1;
  const totalWide = paper !== '58mm';
  return {
    cols,
    paper,
    settings: settings || {},
    body: { height: bodyHeight },
    total: totalWide ? { width: 2, height: 2 } : { height: 2 },
    totalCols: totalWide ? Math.floor(cols / 2) : cols,
  };
}

class DocBuilder {
  constructor(ctx) {
    this.ctx = ctx;
    this.blocks = [];
  }

  // Body text, laid out as the caller already decided (one physical line).
  line(text, style = {}) {
    this.blocks.push({ type: 'text', text, ...this.ctx.body, ...style });
    return this;
  }

  lines(texts, style = {}) {
    for (const t of texts) this.line(t, style);
    return this;
  }

  centered(text, style = {}) {
    const width = style.width === 2 ? Math.floor(this.ctx.cols / 2) : this.ctx.cols;
    return this.lines(wrap(text, width).map((l) => center(l, width)), style);
  }

  paragraph(text, style = {}) {
    return this.lines(wrap(text, this.ctx.cols), style);
  }

  row(left, right, style = {}) {
    return this.lines(twoColumns(left, right, this.ctx.cols), style);
  }

  rule(char = '-') {
    return this.line(rule(this.ctx.cols, char), { height: 1 });
  }

  total(label, amount) {
    const style = { ...this.ctx.total, bold: true };
    return this.lines(twoColumns(label, money(amount), this.ctx.totalCols), style);
  }

  logo() {
    const url = this.ctx.settings.logoUrl;
    if (url) this.blocks.push({ type: 'logo', url });
    return this;
  }

  qr(data) {
    this.blocks.push({ type: 'qr', data });
    return this;
  }

  footerMessage() {
    const msg = this.ctx.settings.footerMessage;
    if (msg && String(msg).trim()) {
      for (const paragraph of String(msg).split(/\r?\n/)) this.centered(paragraph);
    }
    return this;
  }

  feed(lines = 3) {
    this.blocks.push({ type: 'feed', lines });
    return this;
  }
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '--');
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString() : '--');
const fmtDateTime = (d) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '--');

// Fully-voided lines (quantity 0) stay in items[] as an audit record but are
// not sold lines; the HTML path skips them too.
const soldItems = (order) => (order?.items || []).filter((item) => (item.quantity ?? 0) > 0);
const itemName = (item) => item.menuItem?.name || item.name || 'Unknown Item';
const itemPrice = (item) => Number(item.menuItem?.price || item.price || 0);

// Delivery / para llevar / mostrador banner, shared by every order document.
function destinationBanner(doc, order) {
  const banner = (title) => doc.centered(`-- ${title} --`, { bold: true });
  if (order.orderType === 'delivery' && (order.deliveryName || order.deliveryAddress)) {
    banner('DELIVERY');
    if (order.deliveryName) doc.paragraph(`Nombre: ${order.deliveryName}`, { bold: true });
    if (order.deliveryAddress) doc.paragraph(`Dirección: ${order.deliveryAddress}`, { bold: true });
  } else if (order.orderType === 'takeout' && order.deliveryName) {
    banner('PARA LLEVAR');
    doc.paragraph(`Nombre: ${order.deliveryName}`, { bold: true });
  } else if (order.orderType === 'counter' && order.deliveryName) {
    banner('MOSTRADOR');
    doc.paragraph(`Nombre: ${order.deliveryName}`, { bold: true });
  } else {
    return;
  }
  doc.rule();
}

function customerItems(doc, order) {
  for (const item of soldItems(order)) {
    const quantity = Number(item.quantity || 1);
    doc.row(`${itemName(item)} x${quantity}`, money(itemPrice(item) * quantity));
  }
}

// Subtotal + discount above the TOTAL. orderTotal is already net of discount.
function discountRows(doc, order) {
  if (!(order.discount && order.discount.amount > 0)) return;
  const discountAmount = Number(order.discount.amount) || 0;
  const subtotal = (Number(order.orderTotal) || 0) + discountAmount;
  const label = order.discount.mode === 'percent' ? `Descuento (${order.discount.value}%)` : 'Descuento';
  doc.row('Subtotal', money(subtotal));
  doc.row(label, money(discountAmount, { negative: true }));
}

/** Precuenta / ticket (modern-receipt.html). */
export function buildReceipt({ order = {}, restaurant = {} }, ctx) {
  const doc = new DocBuilder(ctx);
  doc.logo();
  doc.centered(restaurant?.name || '', { bold: true, height: 2 });
  if (restaurant?.address) doc.centered(restaurant.address);
  doc.rule();
  const table = order.table || (order.orderType === 'delivery' ? 'Delivery' : order.orderType === 'counter' ? 'Mostrador' : 'Para llevar');
  doc.row('Mesa:', table);
  doc.row('Mesero:', order.waiter?.name || '--');
  doc.row('Fecha:', fmtDate(order.createdAt));
  doc.row('Hora:', fmtTime(order.createdAt));
  doc.rule();
  destinationBanner(doc, order);
  customerItems(doc, order);
  doc.rule();
  discountRows(doc, order);
  doc.total('TOTAL', order.orderTotal);
  doc.rule();
  doc.centered('¡Gracias por su compra!');
  doc.centered('TICKET NO VALIDO COMO FACTURA');
  doc.footerMessage();
  return doc.feed().blocks;
}

/** Factura AFIP (modern-invoice.html). The QR is emitted only with a CAE. */
export function buildInvoice({ order = {}, restaurant = {}, invoiceData = {} }, ctx) {
  const inv = invoiceData || {};
  const doc = new DocBuilder(ctx);
  doc.logo();
  doc.centered(restaurant?.name || '', { bold: true, height: 2 });
  doc.paragraph(inv.razonSocialEmisor || '');
  doc.paragraph(inv.domicilioEmisor || '');
  doc.paragraph(`CUIT: ${inv.docEmisorFormatted || ''}`);
  doc.paragraph(`IIBB: ${inv.ingresosBrutosEmisor || ''}`);
  doc.paragraph(`Inicio de Actividades: ${inv.inicioActividadEmisor || ''}`);
  doc.paragraph(`IVA ${inv.condicionIvaEmisorLabel || ''}`);
  doc.paragraph(`Fecha: ${fmtDate(order.createdAt)}`);
  doc.paragraph(`Hora: ${fmtTime(order.createdAt)}`);
  doc.paragraph(`Comprobante: ${String(inv.puntoVenta ?? '').padStart(4, '0')}-${String(inv.numeroComprobante ?? '').padStart(8, '0')}`);
  doc.rule();
  doc.centered(`${inv.tipoComprobanteLabel || ''} (COD ${inv.tipoComprobante ?? ''})`, { bold: true });
  doc.centered(`A ${inv.razonSocialReceptor || ''} ${inv.tipoDocReceptorLabel || ''}: ${inv.docReceptorFormatted || ''}`);
  doc.centered(inv.condicionIvaReceptorLabel || '');
  doc.rule();
  customerItems(doc, order);
  doc.rule();
  discountRows(doc, order);
  doc.total('TOTAL', order.orderTotal);
  doc.rule();
  doc.paragraph('Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)');
  doc.row('IVA Contenido', money(inv.impIVA));
  doc.row('Otros tributos nacionales indirectos', money(inv.otrosImpuestosNacionales));
  if (inv.cae) {
    doc.qr(generateAfipQRCodeData(inv));
    doc.paragraph(`CAE: ${inv.cae}`, { bold: true });
    doc.paragraph(`Vencimiento CAE: ${inv.vencimientoCAEFormatted || ''}`, { bold: true });
  }
  doc.footerMessage();
  return doc.feed().blocks;
}

/** Comanda de cocina (modern-order.html). */
export function buildOrder({ order = {} }, ctx) {
  const doc = new DocBuilder(ctx);
  doc.centered(`#${order.dailyOrderNumber || order.orderNumber || '--'}`, { bold: true, width: 2, height: 2 });
  doc.rule();
  if (order.table) doc.row('Mesa:', String(order.table), { bold: true });
  if (order.orderType === 'dine-in' && order.deliveryName) doc.row('Nombre:', order.deliveryName, { bold: true });
  if (order.callButton) doc.row('Llamador:', String(order.callButton), { bold: true });
  doc.row('Mesero:', order.waiter?.name || '--');
  const now = new Date();
  doc.row('Fecha:', now.toLocaleDateString());
  doc.row('Hora:', now.toLocaleTimeString());
  doc.rule();
  destinationBanner(doc, order);
  for (const item of soldItems(order)) {
    doc.paragraph(`${Number(item.quantity || 1)}x ${itemName(item)}`, { bold: true });
    if (item.note) doc.paragraph(`Nota: ${item.note}`, { bold: true });
  }
  doc.rule();
  if (order.notes) {
    doc.paragraph(`NOTAS: ${order.notes}`, { bold: true });
    doc.rule();
  }
  return doc.feed().blocks;
}

// Prefix of an update-chit line; mirrors windows-printer.js printOrderUpdate.
function updatePrefix(kind, note) {
  if (kind === 'cancel') return 'CANCELAR:';
  if (kind === 'modify') return 'MODIFICAR:';
  if (kind === 'note-update' && note) return 'NOTA ACTUALIZADA:';
  return '+';
}

/**
 * Comanda de actualizacion: only the diff lines (the inline HTML chit in
 * windows-printer.js). A cancelled line prints inverted, the text-mode
 * equivalent of the black band in the HTML chit.
 */
export function buildOrderUpdate({ order = {}, lines = [] }, ctx) {
  const doc = new DocBuilder(ctx);
  doc.centered('** ACTUALIZACION **', { bold: true, invert: true, height: 2 });
  doc.centered(`#${order.dailyOrderNumber || '--'}`, { bold: true, width: 2, height: 2 });
  if (order.orderType === 'delivery') {
    doc.centered('-- DELIVERY --', { bold: true });
    if (order.deliveryName) doc.paragraph(`Nombre: ${order.deliveryName}`, { bold: true });
    if (order.deliveryAddress) doc.paragraph(`Dirección: ${order.deliveryAddress}`, { bold: true });
  } else if (order.orderType === 'takeout') {
    doc.centered('-- PARA LLEVAR --', { bold: true });
    if (order.deliveryName) doc.paragraph(`Nombre: ${order.deliveryName}`, { bold: true });
  } else if (order.orderType === 'counter') {
    doc.centered('-- MOSTRADOR --', { bold: true });
    if (order.deliveryName) doc.paragraph(`Nombre: ${order.deliveryName}`, { bold: true });
  } else {
    doc.paragraph(`Mesa: ${order.table || '--'}`, { bold: true });
    if (order.orderType === 'dine-in' && order.deliveryName) doc.paragraph(`Nombre: ${order.deliveryName}`, { bold: true });
  }
  if (order.callButton) doc.paragraph(`Llamador: ${order.callButton}`, { bold: true });
  doc.paragraph(`Mesero: ${order.waiter?.name || '--'}`);
  doc.paragraph(`Hora: ${new Date().toLocaleTimeString()}`);
  doc.rule();

  for (const line of Array.isArray(lines) ? lines : []) {
    if (line.kind === 'note') {
      const banner = line.noteStatus === 'added' ? '* NOTA AGREGADA *'
        : line.noteStatus === 'removed' ? '* NOTA ELIMINADA *'
          : '* NOTA MODIFICADA *';
      doc.centered(banner, { bold: true });
      // No strike-through in text mode: the old note is labelled instead.
      if (line.noteBefore) doc.paragraph(`Antes: ${line.noteBefore}`);
      if (line.noteAfter) doc.paragraph(`NOTAS: ${line.noteAfter}`, { bold: true });
      doc.rule();
      continue;
    }
    const style = { bold: true, invert: line.kind === 'cancel' };
    doc.paragraph(`${updatePrefix(line.kind, line.note)} ${line.quantity || 1}x ${line.name || 'Item'}`, style);
    const mods = (line.modifiers || []).map((m) => m.name || m.menuItem?.name).filter(Boolean);
    if (mods.length) doc.lines(wrap(mods.join(', '), ctx.cols - 2).map((l) => `  ${l}`));
    if (line.note) doc.paragraph(`Nota: ${line.note}`, { bold: true });
    doc.rule();
  }
  return doc.feed().blocks;
}

function salesByMethodRows(doc, sales) {
  const byMethod = Array.isArray(sales?.byMethod) ? sales.byMethod : [];
  if (byMethod.length === 0) {
    doc.row('Efectivo', money(sales?.cash));
    doc.row('Tarjeta debito', money(sales?.debit));
    doc.row('Tarjeta credito', money(sales?.credit));
    doc.row('Transferencia / QR', money(sales?.transfer));
    return;
  }
  for (const m of byMethod) doc.row(PM_LEGACY_LABELS[m.name] || m.name || 'Sin especificar', money(m.total));
}

function discountSummary(doc, sales) {
  const discounts = Number(sales?.totalDiscounts) || 0;
  if (discounts <= 0) return;
  const net = Number(sales?.total) || 0;
  const gross = Number(sales?.grossRevenue) || net + discounts;
  const rate = gross > 0 ? (discounts / gross) * 100 : 0;
  doc.rule();
  doc.line('Descuentos otorgados', { bold: true });
  doc.row('Pedidos con descuento', String(Number(sales?.discountCount) || 0));
  doc.row('Ventas brutas', money(gross));
  doc.row('Total descuentos', money(discounts, { negative: true }));
  doc.row('Ventas netas', money(net), { bold: true });
  doc.row('Tasa de descuento', `${rate.toFixed(1).replace('.', ',')}%`);
}

function movementRows(doc, items) {
  if (!items || items.length === 0) {
    doc.line('Sin movimientos');
    return;
  }
  for (const it of items) {
    doc.row(it.label || '', money(it.amount));
    if (it.meta && it.meta !== it.label) doc.paragraph(`  ${it.meta}`);
  }
}

function expenseRows(doc, items) {
  if (!items || items.length === 0) {
    doc.line('Sin gastos');
    return;
  }
  for (const it of items) {
    const label = it.description || it.supplier || it.category || 'Gasto';
    doc.row(label, money(it.amount));
    const metaParts = [];
    if (it.supplier && it.supplier !== label) metaParts.push(it.supplier);
    const receipt = [DOC_TYPE_LABELS[it.documentType] || '', it.fiscalCategory || '', it.documentNumber || '']
      .filter(Boolean).join(' ');
    if (receipt) metaParts.push(receipt);
    if (metaParts.length) doc.paragraph(`  ${metaParts.join(' - ')}`);
  }
}

const signedMoney = (value) => `${(Number(value) || 0) < 0 ? '-' : ''}$${formatPrice(Math.abs(Number(value) || 0))}`;

/** Resumen de cierre de caja (renderCashCloseHtml). */
export function buildCashClose({ summary = {}, restaurant = {} }, ctx) {
  const sales = summary.sales || {};
  const doc = new DocBuilder(ctx);
  doc.logo();
  doc.centered(restaurant?.name || '', { bold: true });
  if (restaurant?.address) doc.centered(restaurant.address);
  doc.centered('Cierre de caja', { bold: true, height: 2 });
  doc.rule();
  doc.row('Caja', summary.registerName || '--');
  doc.row('Cajero', summary.closedByName || '--');
  doc.row('Apertura', fmtDateTime(summary.openedAt));
  doc.row('Cierre', fmtDateTime(summary.closedAt));

  doc.rule('=');
  doc.line('Ventas (netas)', { bold: true });
  salesByMethodRows(doc, sales);
  doc.row('Total ventas', money(sales.total), { bold: true });
  discountSummary(doc, sales);

  const cashIn = summary.cashIn || { total: 0, items: [] };
  const cashOut = summary.cashOut || { total: 0, items: [] };
  doc.rule();
  doc.line('Aportes', { bold: true });
  movementRows(doc, cashIn.items);
  doc.row('Total aportes', money(cashIn.total), { bold: true });
  doc.rule();
  doc.line('Retiros', { bold: true });
  movementRows(doc, cashOut.items);
  doc.row('Total retiros', money(cashOut.total), { bold: true });

  doc.rule('=');
  doc.line('Arqueo (efectivo)', { bold: true });
  doc.row('Fondo inicial', money(summary.openingFloat));
  doc.row('Efectivo esperado', money(summary.expectedAtClose), { bold: true, height: 2 });
  doc.row('Efectivo contado', money(summary.closingCount));
  doc.row('Diferencia', signedMoney(summary.variance), { bold: true, height: 2 });

  const exp = summary.expenses;
  if (exp) {
    const cc = exp.currentAccount || { total: 0, items: [] };
    const oc = exp.otherCash || { total: 0, items: [] };
    const hasCc = cc.items && cc.items.length > 0;
    const hasOc = oc.items && oc.items.length > 0;
    if (hasCc || hasOc) {
      doc.rule();
      doc.paragraph('Gastos (no afectan el arqueo)', { bold: true });
      if (hasCc) {
        doc.line('Cuenta corriente');
        expenseRows(doc, cc.items);
        doc.row('Subtotal cta. cte.', money(cc.total), { bold: true });
      }
      if (hasOc) {
        doc.line('Caja chica / banco');
        expenseRows(doc, oc.items);
        doc.row('Subtotal otros', money(oc.total), { bold: true });
      }
    }
  }

  doc.rule();
  doc.row('Total facturado AFIP', money(summary.totalInvoiced));

  if (summary.closeReason) {
    doc.rule();
    doc.line('Observacion', { bold: true });
    doc.paragraph(summary.closeReason);
  }

  if (summary.waiterSales && summary.waiterSales.length > 0) {
    const totalForPct = Number(sales.total) || 0;
    doc.rule();
    doc.line('Venta por mozo', { bold: true });
    summary.waiterSales.forEach((w, i) => {
      const amount = Number(w.amount) || 0;
      const pct = totalForPct > 0 ? ((amount / totalForPct) * 100).toFixed(1) : '0.0';
      doc.row(`${i + 1}. ${w.label || ''}`, money(amount));
      doc.line(`  ${pct}%`);
    });
  }

  doc.rule();
  doc.centered(fmtDateTime(summary.generatedAt));
  return doc.feed().blocks;
}

/** Z del dia interno, no fiscal (renderDayZHtml). */
export function buildDayZ({ summary = {}, restaurant = {} }, ctx) {
  const sales = summary.sales || {};
  const cc = summary.cashCount || {};
  const exp = summary.expenses || {};
  const fmtBusinessDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : String(d || '--'));
  const doc = new DocBuilder(ctx);
  doc.logo();
  doc.centered(restaurant?.name || '', { bold: true });
  if (restaurant?.address) doc.centered(restaurant.address);
  doc.centered('Z del dia (interno)', { bold: true, height: 2 });
  doc.centered('No fiscal');
  doc.rule();
  doc.row('Local', summary.location?.name || '--');
  doc.row('Fecha', fmtBusinessDate(summary.businessDate));

  doc.rule('=');
  doc.line('Ventas del dia (netas)', { bold: true });
  salesByMethodRows(doc, sales);
  doc.row('Total ventas', money(sales.total), { bold: true });
  discountSummary(doc, sales);

  doc.rule('=');
  doc.paragraph(`Arqueo del dia (turnos cerrados: ${Number(cc.closedShifts) || 0})`, { bold: true });
  doc.row('Fondo inicial', money(cc.openingFloatTotal));
  doc.row('Efectivo esperado', money(cc.expectedTotal), { bold: true, height: 2 });
  doc.row('Efectivo contado', money(cc.countedTotal));
  doc.row('Diferencia', signedMoney(cc.varianceTotal), { bold: true, height: 2 });
  if ((Number(cc.openShifts) || 0) > 0) {
    doc.paragraph(`Turnos en curso: ${Number(cc.openShifts)} (no incluidos en el contado)`);
  }

  if (Array.isArray(summary.shifts) && summary.shifts.length > 0) {
    doc.rule();
    doc.line('Turnos del dia', { bold: true });
    for (const s of summary.shifts) {
      const right = s.status === 'closed' ? signedMoney(s.variance) : 'en curso';
      doc.row(`${s.registerName || 'Caja'} (${fmtTime(s.openedAt)})`, right);
    }
  }

  const section = (title, sec, note) => {
    const s = sec || { total: 0, items: [] };
    if (!s.items || s.items.length === 0) return false;
    doc.rule();
    doc.line(title, { bold: true });
    if (note) doc.line(note);
    expenseRows(doc, s.items);
    doc.row('Subtotal', money(s.total), { bold: true });
    return true;
  };
  const anyExpense = [
    section('Gastos efectivo (en arqueo)', exp.cashInArqueo),
    section('Cuenta corriente', exp.currentAccount, 'No afecta el arqueo'),
    section('Caja chica / banco', exp.otherCash, 'No afecta el arqueo'),
  ].some(Boolean);
  if (anyExpense) doc.row('Total gastos del dia', money(exp.grandTotal), { bold: true });

  doc.rule();
  doc.row('Total facturado AFIP', money(summary.totalInvoiced));
  doc.rule();
  doc.centered(fmtDateTime(summary.generatedAt));
  return doc.feed().blocks;
}
