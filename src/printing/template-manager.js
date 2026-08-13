import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { getDefaultTemplate, getLogoSize, getQRCodeEnabled, getLogoEnabled, getPaperWidth } from '../core/store.js';
import {
  generateQRCodeHTML,
  generateQRCodeData,
  generateAfipQRCodeData,
  generateAfipQRCodePngHTML,
} from './qrcode-generator.js';
import { getLogoAsBase64 } from '../shared/file-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Formats a number with . for thousands separator and , for decimals
 * Example: 1234.56 -> "1.234,56"
 * @param {number} num - The number to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted number string
 */
function formatPrice(num, decimals = 2) {
  const fixed = num.toFixed(decimals);
  const [integer, decimal] = fixed.split('.');
  const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal ? `${formattedInteger},${decimal}` : formattedInteger;
}

/**
 * HTML-escape a user-controlled string before interpolation. Prevents stored-XSS
 * if a future code path bypasses server-side schema validation.
 */
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Right-aligned money row: label on the left, amount on the right.
function moneyRow(label, amount, { sub = false, emph = false, negative = false } = {}) {
  const cls = `row${sub ? ' sub' : ''}`;
  const amountStr = `${negative ? '-' : ''}$${formatPrice(Number(amount) || 0)}`;
  const labelHtml = emph ? `<span class="label emph">${escapeHtml(label)}</span>` : `<span class="label">${escapeHtml(label)}</span>`;
  const amountHtml = emph ? `<span class="amount emph">${amountStr}</span>` : `<span class="amount">${amountStr}</span>`;
  return `<div class="${cls}">${labelHtml}${amountHtml}</div>`;
}

// Canonical Spanish labels for the legacy payment-method enum, used when an order
// predates the configurable PaymentMethod ref (MES-119) so byMethod falls back to
// the raw enum string instead of a display name.
const PM_LEGACY_LABELS = {
  cash: 'Efectivo',
  debit: 'Tarjeta debito',
  credit: 'Tarjeta credito',
  transfer: 'Transferencia / QR',
};

// Net sales per payment method (MES-119): one line per PaymentMethod actually used
// in the window, by the local's own display name, so the per-method lines reconcile
// with Total ventas for any custom method. Legacy enum strings map to their canonical
// label. Falls back to the four fixed buckets for old close snapshots that have no
// byMethod array (day Z is always live, so it always has byMethod).
function salesByMethodLines(sales) {
  const byMethod = Array.isArray(sales?.byMethod) ? sales.byMethod : [];
  if (byMethod.length === 0) {
    return moneyRow('Efectivo', sales?.cash || 0) +
      moneyRow('Tarjeta debito', sales?.debit || 0) +
      moneyRow('Tarjeta credito', sales?.credit || 0) +
      moneyRow('Transferencia / QR', sales?.transfer || 0);
  }
  return byMethod.map((m) => {
    const label = PM_LEGACY_LABELS[m.name] || m.name || 'Sin especificar';
    return moneyRow(label, m.total || 0);
  }).join('');
}

// Discount summary block (MES-119 / Fase 1). Discounts are applied at the order
// level (not per payment method), so the per-method breakdown above is always net.
// This block makes the precio-lista -> descuentos -> total cobrado relationship
// explicit and adds the discount rate, replacing the old dangling "Descuentos -$X"
// line that sat inside the net breakdown and looked like it subtracted from a total
// that was already net. Rendered only when there were discounts.
function discountBlock(sales) {
  const discounts = Number(sales?.totalDiscounts) || 0;
  if (discounts <= 0) return '';
  const net = Number(sales?.total) || 0;
  const gross = Number(sales?.grossRevenue) || net + discounts;
  const count = Number(sales?.discountCount) || 0;
  const rate = gross > 0 ? (discounts / gross) * 100 : 0;
  const rateStr = `${rate.toFixed(1).replace('.', ',')}%`;
  return `<div class="divider"></div>` +
    `<div class="section-title">Descuentos otorgados</div>` +
    `<div class="row"><span class="label">Pedidos con descuento</span><span class="amount">${count}</span></div>` +
    moneyRow('Ventas brutas', gross) +
    moneyRow('Total descuentos', discounts, { negative: true }) +
    moneyRow('Ventas netas', net, { emph: true }) +
    `<div class="row"><span class="label">Tasa de descuento</span><span class="amount">${rateStr}</span></div>`;
}

// Detail lines for a paid-in / paid-out section. Every label/meta is escaped.
function movementLines(items) {
  if (!items || items.length === 0) return '<div class="muted">Sin movimientos</div>';
  return items.map((it) => {
    // Only show meta when it adds information beyond the label (avoids printing
    // the same humanized subtype twice when a movement has no custom reason).
    const meta = it.meta && it.meta !== it.label ? `<div class="line-meta">${escapeHtml(it.meta)}</div>` : '';
    return moneyRow(it.label || '', it.amount) + meta;
  }).join('');
}

const DOC_TYPE_LABELS = { remito: 'Remito', invoice: 'Factura', receipt: 'Recibo', other: 'Otro' };

// Detail lines for an expense overlay section (MES-155). Label = description (or
// supplier/category fallback); meta = supplier + receipt (tipo/letra/numero).
function expenseLines(items) {
  if (!items || items.length === 0) return '<div class="muted">Sin gastos</div>';
  return items.map((it) => {
    const label = it.description || it.supplier || it.category || 'Gasto';
    const metaParts = [];
    if (it.supplier && it.supplier !== label) metaParts.push(it.supplier);
    const doc = [DOC_TYPE_LABELS[it.documentType] || '', it.fiscalCategory || '', it.documentNumber || '']
      .filter(Boolean).join(' ');
    if (doc) metaParts.push(doc);
    const meta = metaParts.length ? `<div class="line-meta">${escapeHtml(metaParts.join(' - '))}</div>` : '';
    return moneyRow(label, it.amount) + meta;
  }).join('');
}

/**
 * Render the printable cash-close summary HTML from a frozen closeSummary
 * snapshot. Dedicated renderer (not generateHtmlFromTemplate, which is order-
 * shaped). All repeating sections are pre-built strings; every user-controlled
 * field is escaped and every number coerced. Applies the same logo and 58mm
 * zoom handling as the order pipeline.
 *
 * @param {object} summary - Shift.closeSummary snapshot
 * @param {object} restaurantData - { name, address }
 * @returns {Promise<string>} final HTML
 */
export async function renderCashCloseHtml(summary, restaurantData) {
  if (!summary) throw new Error('renderCashCloseHtml: summary is required');
  if (summary.schemaVersion && summary.schemaVersion !== 1) {
    throw new Error(`renderCashCloseHtml: unsupported schemaVersion ${summary.schemaVersion}`);
  }

  const templatePath = path.join(__dirname, 'templates', 'modern-cash-close.html');
  const template = await fs.readFile(templatePath, 'utf-8');

  const sales = summary.sales || {};
  const fmtDate = (d) => {
    if (!d) return '--';
    const dt = new Date(d);
    return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`;
  };

  // Header
  const header =
    `<div class="center title">${escapeHtml(restaurantData?.name || '')}</div>` +
    (restaurantData?.address ? `<div class="center muted">${escapeHtml(restaurantData.address)}</div>` : '') +
    `<div class="center title">Cierre de caja</div>` +
    `<div class="divider"></div>` +
    moneyRowText('Caja', summary.registerName || '--') +
    moneyRowText('Cajero', summary.closedByName || '--') +
    moneyRowText('Apertura', fmtDate(summary.openedAt)) +
    moneyRowText('Cierre', fmtDate(summary.closedAt));

  // Sales by payment method (NET) + Total ventas. Discounts are NOT shown here:
  // the per-method lines are net and reconcile with Total ventas. The discount
  // detail lives in its own block below (precio lista -> descuentos -> total).
  const salesBlock =
    `<div class="divider-strong"></div>` +
    `<div class="section-title">Ventas (netas)</div>` +
    salesByMethodLines(sales) +
    moneyRow('Total ventas', sales.total || 0, { emph: true }) +
    discountBlock(sales);

  // Paid-in / paid-out
  const cashIn = summary.cashIn || { total: 0, items: [] };
  const cashOut = summary.cashOut || { total: 0, items: [] };
  const cashInBlock =
    `<div class="divider"></div>` +
    `<div class="section-title">Aportes</div>` +
    movementLines(cashIn.items) +
    moneyRow('Total aportes', cashIn.total || 0, { emph: true });
  const cashOutBlock =
    `<div class="divider"></div>` +
    `<div class="section-title">Retiros</div>` +
    movementLines(cashOut.items) +
    moneyRow('Total retiros', cashOut.total || 0, { emph: true });

  // Cash reconciliation (arqueo)
  const arqueoBlock =
    `<div class="divider-strong"></div>` +
    `<div class="section-title">Arqueo (efectivo)</div>` +
    moneyRow('Fondo inicial', summary.openingFloat || 0) +
    `<div class="row"><span class="label emph-lg">Efectivo esperado</span><span class="amount emph-lg">$${formatPrice(Number(summary.expectedAtClose) || 0)}</span></div>` +
    moneyRow('Efectivo contado', summary.closingCount || 0) +
    `<div class="row"><span class="label emph-lg">Diferencia</span><span class="amount emph-lg">${(Number(summary.variance) || 0) < 0 ? '-' : ''}$${formatPrice(Math.abs(Number(summary.variance) || 0))}</span></div>`;

  // Expense overlay (MES-155): credit + petty-cash/bank expenses of the shift,
  // informational, never part of the arqueo. Present only for single-register
  // locations (the server gates it). Cash-arqueo expenses are already in Retiros.
  let expensesBlock = '';
  const exp = summary.expenses;
  if (exp) {
    const cc = exp.currentAccount || { total: 0, items: [] };
    const oc = exp.otherCash || { total: 0, items: [] };
    const hasCc = cc.items && cc.items.length > 0;
    const hasOc = oc.items && oc.items.length > 0;
    if (hasCc || hasOc) {
      expensesBlock = `<div class="divider"></div><div class="section-title">Gastos (no afectan el arqueo)</div>`;
      if (hasCc) {
        expensesBlock += `<div class="muted">Cuenta corriente</div>` + expenseLines(cc.items) +
          moneyRow('Subtotal cta. cte.', cc.total || 0, { emph: true });
      }
      if (hasOc) {
        expensesBlock += `<div class="muted">Caja chica / banco</div>` + expenseLines(oc.items) +
          moneyRow('Subtotal otros', oc.total || 0, { emph: true });
      }
    }
  }

  // AFIP total facturado
  const afipBlock =
    `<div class="divider"></div>` +
    moneyRow('Total facturado AFIP', summary.totalInvoiced || 0);

  // Observation
  const observationBlock = summary.closeReason
    ? `<div class="divider"></div><div class="section-title">Observacion</div><div>${escapeHtml(summary.closeReason)}</div>`
    : '';

  // Sales by waiter (% computed here, not stored)
  let waiterBlock = '';
  if (summary.waiterSales && summary.waiterSales.length > 0) {
    const totalForPct = Number(sales.total) || 0;
    const rows = summary.waiterSales.map((w, i) => {
      const amount = Number(w.amount) || 0;
      const pct = totalForPct > 0 ? ((amount / totalForPct) * 100).toFixed(1) : '0.0';
      return moneyRow(`${i + 1}. ${w.label || ''}`, amount) +
        `<div class="line-meta">${pct}%</div>`;
    }).join('');
    waiterBlock =
      `<div class="divider"></div>` +
      `<div class="section-title">Venta por mozo</div>` + rows;
  }

  const footer =
    `<div class="divider"></div>` +
    `<div class="center muted">${escapeHtml(fmtDate(summary.generatedAt))}</div>` +
    `<div style="height: 24px;"></div>`;

  const content = header + salesBlock + cashInBlock + cashOutBlock + arqueoBlock +
    expensesBlock + afipBlock + observationBlock + waiterBlock + footer;

  let finalHtml = template.replace('{{content}}', content);

  // Logo (same handling as the order pipeline)
  const logoEnabled = getLogoEnabled();
  const logoBase64 = getLogoAsBase64();
  const logoSize = getLogoSize();
  if (logoEnabled && logoBase64) {
    const logoHtml = `<div style="text-align: center; margin-bottom: 10px;"><img src="${logoBase64}" style="width: ${logoSize}% !important; max-width: ${logoSize}% !important; height: auto !important; display: inline-block !important;" alt="Logo" class="receipt-logo"></div>`;
    finalHtml = finalHtml.replace('{{restaurant.logo}}', logoHtml);
  } else {
    finalHtml = finalHtml.replace('{{restaurant.logo}}', '');
  }

  // 58mm scaling, identical to the order pipeline.
  if (getPaperWidth() === '58mm') {
    finalHtml = finalHtml.replace('</head>', '<style>body { zoom: 1.23; }</style></head>');
  }

  return finalHtml;
}

// Text row (non-money): label left, value right. Both escaped here.
function moneyRowText(label, value) {
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="amount">${escapeHtml(value)}</span></div>`;
}

/**
 * Render the internal day Z símil (MES-155): a non-fiscal day+location summary
 * (sales + consolidated arqueo of closed shifts + expense sections). Reuses the
 * cash-close template shell. Every user field escaped, every number coerced.
 * @param {object} summary - buildDayZSummary output
 * @param {object} restaurantData - { name, address }
 * @returns {Promise<string>} final HTML
 */
export async function renderDayZHtml(summary, restaurantData) {
  if (!summary) throw new Error('renderDayZHtml: summary is required');

  const templatePath = path.join(__dirname, 'templates', 'modern-cash-close.html');
  const template = await fs.readFile(templatePath, 'utf-8');

  const sales = summary.sales || {};
  const cc = summary.cashCount || {};
  const exp = summary.expenses || {};
  const fmtDate = (d) => {
    if (!d) return '--';
    const dt = new Date(d);
    return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`;
  };
  // Business date "YYYY-MM-DD" -> "DD/MM/YYYY" (Argentine format).
  const fmtBusinessDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : String(d || '--'));
  const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString() : '--');

  const header =
    `<div class="center title">${escapeHtml(restaurantData?.name || '')}</div>` +
    (restaurantData?.address ? `<div class="center muted">${escapeHtml(restaurantData.address)}</div>` : '') +
    `<div class="center title">Z del dia (interno)</div>` +
    `<div class="center muted">No fiscal</div>` +
    `<div class="divider"></div>` +
    moneyRowText('Local', summary.location?.name || '--') +
    moneyRowText('Fecha', fmtBusinessDate(summary.businessDate));

  // Turnos del día: caja + horario + estado (diferencia si está cerrado).
  let shiftsBlock = '';
  if (Array.isArray(summary.shifts) && summary.shifts.length > 0) {
    const rows = summary.shifts.map((s) => {
      const isClosed = s.status === 'closed';
      const right = isClosed
        ? `${(Number(s.variance) || 0) < 0 ? '-' : ''}$${formatPrice(Math.abs(Number(s.variance) || 0))}`
        : 'en curso';
      return `<div class="row"><span class="label">${escapeHtml(s.registerName || 'Caja')} (${fmtTime(s.openedAt)})</span><span class="amount">${right}</span></div>`;
    }).join('');
    shiftsBlock = `<div class="divider"></div><div class="section-title">Turnos del dia</div>${rows}`;
  }

  const salesBlock =
    `<div class="divider-strong"></div>` +
    `<div class="section-title">Ventas del dia (netas)</div>` +
    salesByMethodLines(sales) +
    moneyRow('Total ventas', sales.total || 0, { emph: true }) +
    discountBlock(sales);

  const arqueoBlock =
    `<div class="divider-strong"></div>` +
    `<div class="section-title">Arqueo del dia (turnos cerrados: ${Number(cc.closedShifts) || 0})</div>` +
    moneyRow('Fondo inicial', cc.openingFloatTotal || 0) +
    `<div class="row"><span class="label emph-lg">Efectivo esperado</span><span class="amount emph-lg">$${formatPrice(Number(cc.expectedTotal) || 0)}</span></div>` +
    moneyRow('Efectivo contado', cc.countedTotal || 0) +
    `<div class="row"><span class="label emph-lg">Diferencia</span><span class="amount emph-lg">${(Number(cc.varianceTotal) || 0) < 0 ? '-' : ''}$${formatPrice(Math.abs(Number(cc.varianceTotal) || 0))}</span></div>` +
    ((Number(cc.openShifts) || 0) > 0
      ? `<div class="line-meta">Turnos en curso: ${Number(cc.openShifts)} (no incluidos en el contado)</div>`
      : '');

  // Expense sections (all three for the day). Non-arqueo ones are labeled.
  const expSection = (title, sec, note) => {
    const s = sec || { total: 0, items: [] };
    if (!s.items || s.items.length === 0) return '';
    return `<div class="divider"></div><div class="section-title">${escapeHtml(title)}</div>` +
      (note ? `<div class="muted">${escapeHtml(note)}</div>` : '') +
      expenseLines(s.items) + moneyRow('Subtotal', s.total || 0, { emph: true });
  };
  let expensesBlock =
    expSection('Gastos efectivo (en arqueo)', exp.cashInArqueo) +
    expSection('Cuenta corriente', exp.currentAccount, 'No afecta el arqueo') +
    expSection('Caja chica / banco', exp.otherCash, 'No afecta el arqueo');
  if (expensesBlock) expensesBlock += moneyRow('Total gastos del dia', exp.grandTotal || 0, { emph: true });

  const afipBlock = `<div class="divider"></div>` + moneyRow('Total facturado AFIP', summary.totalInvoiced || 0);

  const footer =
    `<div class="divider"></div>` +
    `<div class="center muted">${escapeHtml(fmtDate(summary.generatedAt))}</div>` +
    `<div style="height: 24px;"></div>`;

  const content = header + salesBlock + arqueoBlock + shiftsBlock + expensesBlock + afipBlock + footer;

  let finalHtml = template.replace('{{content}}', content);
  const logoEnabled = getLogoEnabled();
  const logoBase64 = getLogoAsBase64();
  const logoSize = getLogoSize();
  if (logoEnabled && logoBase64) {
    finalHtml = finalHtml.replace(
      '{{restaurant.logo}}',
      `<div style="text-align: center; margin-bottom: 10px;"><img src="${logoBase64}" style="width: ${logoSize}% !important; max-width: ${logoSize}% !important; height: auto !important; display: inline-block !important;" alt="Logo" class="receipt-logo"></div>`
    );
  } else {
    finalHtml = finalHtml.replace('{{restaurant.logo}}', '');
  }
  if (getPaperWidth() === '58mm') {
    finalHtml = finalHtml.replace('</head>', '<style>body { zoom: 1.23; }</style></head>');
  }
  return finalHtml;
}

/**
 * Generates a complete HTML string by loading a template and injecting receipt data.
 * @param {object} orderData - The data for the order.
 * @param {object} restaurantData - The data for the restaurant.
 * @param {string} [templateOverride] - Optional template name to override default.
 * @returns {Promise<string>} The final HTML content as a string.
 */
export async function generateHtmlFromTemplate(orderData, restaurantData, templateOverride = null, receiptType = "receipt", invoiceData) {

  const templateName = templateOverride || getDefaultTemplate();
  // The path is now relative to this file inside /src/printing
  const templatePath = path.join(__dirname, 'templates', templateName);

  try {
    const template = await fs.readFile(templatePath, 'utf-8');
    // Calculate additional fields for templates that need them
    // const subtotal = orderData.orderTotal || 0;
    // const taxRate = 0.085; // 8.5% tax
    // const tax = subtotal * taxRate;
    const grandTotal = orderData.orderTotal;

    // Generate HTML for items based on template type
    let itemsHtml = '';
    if (orderData.items && orderData.items.length > 0) {
      // Default item format for other templates. Skip fully-voided lines
      // (quantity 0): an anulado item stays in items[] as an audit record but
      // its amount is already excluded from the total, so printing it as a sold
      // line is wrong. Guard here too (the server also strips them) because
      // `Number(item.quantity || 1)` would otherwise render a quantity-0 line
      // as "x1".
      orderData.items
        .filter(item => (item.quantity ?? 0) > 0)
        .forEach(item => {
        const name = escapeHtml(item.menuItem?.name || item.name || 'Unknown Item');
        const price = Number(item.menuItem?.price || item.price || 0);
        const quantity = Number(item.quantity || 1);
        const total = price * quantity;

        if (receiptType == "order") {
          itemsHtml += `<tr><td><span>${name.padEnd(20)} </span><span class="text-right">x${quantity}</span></td></tr>`;
        } else {
          itemsHtml += `<tr><td>${name.padEnd(20)} x${quantity}</td><td class="item-name align-bottom text-right">$${formatPrice(total)}</td></tr>`;
        }
      });
      // if (templateName === 'classic-table-receipt.html') {
      //   // Special handling for classic table receipt
      //   orderData.items.forEach(item => {
      //     const name = item.menuItem?.name || item.name || 'Unknown Item';
      //     const price = item.menuItem?.price || item.price || 0;
      //     const quantity = item.quantity || 1;

      //     const total = price * quantity;
      //     itemsHtml += `
      //       <tr>
      //         <td class="item-name">${name}</td>
      //         <td class="item-quantity">${quantity}</td>
      //         <td class="item-price">$${formatPrice(price)}</td>
      //         <td class="item-total">$${formatPrice(total)}</td>
      //       </tr>`;
      //   });
      // } else {
      //   // Default item format for other templates
      //   orderData.items.forEach(item => {
      //     const name = item.menuItem?.name || item.name || 'Unknown Item';
      //     const price = item.menuItem?.price || item.price || 0;
      //     const quantity = item.quantity || 1;
      //     const total = price * quantity;

      //     if(receiptType == "receipt") {
      //       itemsHtml += `<div class="item"><span>${name.padEnd(20)} x${quantity}</span><span>$${formatPrice(total)}</span></div>`;
      //     } else {
      //       itemsHtml += `<div class="item"><span>${name.padEnd(20)} </span><span>x${quantity}</span></div>`;
      //     }
      //   });
      // }
    }

    // Replace placeholders
    // Use order's createdAt for invoice/receipt, or current time for kitchen orders
    const orderDate = (receiptType === 'order') ? new Date() : new Date(orderData.createdAt);

    // Build delivery info block — shown on all print types when order is delivery
    let deliveryInfoHtml = '';
    if (orderData.orderType === 'delivery' && (orderData.deliveryName || orderData.deliveryAddress)) {
      deliveryInfoHtml =
        '<div style="border: 2px solid #000; padding: 6px 8px; margin: 8px 0; font-weight: bolder;">' +
        '<div style="margin-bottom: 4px; font-size: 15px;">-- DELIVERY --</div>' +
        (orderData.deliveryName ? `<div>Nombre: ${escapeHtml(orderData.deliveryName)}</div>` : '') +
        (orderData.deliveryAddress ? `<div>Direcci\u00f3n: ${escapeHtml(orderData.deliveryAddress)}</div>` : '') +
        '</div>';
    } else if (orderData.orderType === 'takeout' && orderData.deliveryName) {
      deliveryInfoHtml =
        '<div style="border: 2px solid #000; padding: 6px 8px; margin: 8px 0; font-weight: bolder;">' +
        '<div style="margin-bottom: 4px; font-size: 15px;">-- PARA LLEVAR --</div>' +
        `<div>Nombre: ${escapeHtml(orderData.deliveryName)}</div>` +
        '</div>';
    }

    // Build discount block — only on customer receipts, never on kitchen tickets.
    // Shows subtotal + discount line above the TOTAL when a discount is present.
    // Note: orderTotal is already net of discount; surcharge is stored separately,
    // so `subtotal = orderTotal + discountAmount` reconstructs the gross items total.
    let discountBlockHtml = '';
    if (receiptType !== 'order' && orderData.discount && orderData.discount.amount > 0) {
      const discountAmount = Number(orderData.discount.amount) || 0;
      const subtotal = (Number(orderData.orderTotal) || 0) + discountAmount;
      const label = orderData.discount.mode === 'percent'
        ? `Descuento (${escapeHtml(orderData.discount.value)}%)`
        : 'Descuento';
      discountBlockHtml =
        `<table style="width: 100%;">` +
        `<tr><td>Subtotal</td><td class="item-name align-bottom text-right">$${formatPrice(subtotal)}</td></tr>` +
        `<tr><td>${label}</td><td class="item-name align-bottom text-right">-$${formatPrice(discountAmount)}</td></tr>` +
        `</table>`;
    }

    // Every user-controlled string field gets escaped before interpolation.
    // Numbers are coerced explicitly so an unexpected string concatenation
    // can't smuggle markup. (todo 016 escapeHtml consistency)
    let finalHtml = template
      .replace('{{restaurant.name}}', escapeHtml(restaurantData?.name || ''))
      .replace('{{restaurant.address}}', escapeHtml(restaurantData?.address || ''))
      .replace('{{order.table}}', escapeHtml(orderData.table || (orderData.orderType == 'delivery' ? 'Delivery' : 'Para llevar')))
      .replace('{{order.waiter}}', escapeHtml(orderData.waiter?.name || '--'))
      .replace('{{order.date}}', escapeHtml(orderDate.toLocaleDateString()))
      .replace('{{order.time}}', escapeHtml(orderDate.toLocaleTimeString()))
      .replace('{{order.items}}', itemsHtml)
      .replace('{{order.discountBlock}}', discountBlockHtml)
      .replace('{{order.total}}', formatPrice(Number(orderData.orderTotal) || 0))
      .replace('{{order.dailyOrderNumber}}', escapeHtml(orderData.dailyOrderNumber || orderData.orderNumber || '#--'))
      .replace('{{order.notesBlock}}', orderData.notes ? `<b>NOTAS:</b> <i>${escapeHtml(orderData.notes)}</i><div class="line"></div>` : '')
      .replace('{{order.deliveryInfo}}', deliveryInfoHtml)

    // Replace invoice data placeholders (only if invoiceData is provided)
    if (invoiceData) {
      finalHtml = finalHtml
        .replace('{{invoiceData.razonSocialEmisor}}', escapeHtml(invoiceData.razonSocialEmisor))
        .replace('{{invoiceData.docEmisor}}', escapeHtml(invoiceData.docEmisorFormatted))
        .replace('{{invoiceData.puntoVenta}}', escapeHtml(String(invoiceData.puntoVenta).padStart(4, '0')))
        .replace('{{invoiceData.numeroComprobante}}', escapeHtml(String(invoiceData.numeroComprobante).padStart(8, '0')))
        .replace('{{invoiceData.domicilioEmisor}}', escapeHtml(invoiceData.domicilioEmisor))
        .replace('{{invoiceData.ingresosBrutosEmisor}}', escapeHtml(invoiceData.ingresosBrutosEmisor))
        .replace('{{invoiceData.inicioActividadEmisor}}', escapeHtml(invoiceData.inicioActividadEmisor))
        .replace('{{invoiceData.condicionIvaEmisor}}', escapeHtml(invoiceData.condicionIvaEmisorLabel))
        .replace('{{invoiceData.tipoComprobanteLabel}}', escapeHtml(invoiceData.tipoComprobanteLabel))
        .replace('{{invoiceData.tipoComprobante}}', escapeHtml(invoiceData.tipoComprobante))
        .replace('{{invoiceData.razonSocialReceptor}}', escapeHtml(invoiceData.razonSocialReceptor))
        .replace('{{invoiceData.tipoDocReceptor}}', escapeHtml(invoiceData.tipoDocReceptorLabel))
        .replace('{{invoiceData.docReceptor}}', escapeHtml(invoiceData.docReceptorFormatted))
        .replace('{{invoiceData.condicionIvaReceptor}}', escapeHtml(invoiceData.condicionIvaReceptorLabel))
        .replace('{{invoiceData.impIVA}}', formatPrice(Number(invoiceData.impIVA) || 0))
        .replace('{{invoiceData.otrosImpuestosNacionales}}', formatPrice(Number(invoiceData.otrosImpuestosNacionales) || 0))
        .replace('{{invoiceData.cae}}', escapeHtml(invoiceData.cae))
        .replace('{{invoiceData.vencimientoCAEFormatted}}', escapeHtml(invoiceData.vencimientoCAEFormatted));
    }

    // Add ACTUAL logo if configured and enabled - using percentage-based sizing
    const logoEnabled = getLogoEnabled();
    const logoBase64 = getLogoAsBase64();
    const logoSize = getLogoSize();
    if (logoEnabled && logoBase64) {
      const logoHtml = `<div style="text-align: center; margin-bottom: 10px;"><img src="${logoBase64}" style="width: ${logoSize}% !important; max-width: ${logoSize}% !important; height: auto !important; display: inline-block !important;"
 alt="Restaurant Logo" class="receipt-logo"></div>`;
      finalHtml = finalHtml.replace('{{restaurant.logo}}', logoHtml);
    } else {
      finalHtml = finalHtml.replace('{{restaurant.logo}}', '');
    }

    // Add LIVE QR code if enabled - FIXED: Now uses stored QR code size
    const qrEnabled = getQRCodeEnabled();

    const paperWidth = getPaperWidth();
    console.log('[Templating] paperWidth =', paperWidth, 'receiptType =', receiptType);

    if (receiptType == "invoice") {
      // Generate AFIP-compliant QR code URL
      const qrData = generateAfipQRCodeData(invoiceData);
      // AFIP QR is pinned to nearly the full printable width regardless of the
      // user's general QR-size preference: the QR must be reliably scannable
      // by phones, and a smaller QR was the most common scan-failure cause in
      // the field. 95% leaves a thin breathing strip so the modules don't kiss
      // the receipt edge at the cutter.
      const qrCodeHtml = await generateAfipQRCodePngHTML(qrData, {
        sizePercent: 95,
      });
      console.log('[QR Debug] Generated QR code HTML length:', qrCodeHtml?.length || 0);
      finalHtml = finalHtml.replace('{{invoiceData.qrCode}}', qrCodeHtml);
    }

    // Scale entire receipt for 58mm paper so 80mm-tuned templates render readably.
    if (paperWidth === '58mm') {
      finalHtml = finalHtml.replace(
        '</head>',
        '<style>body { zoom: 1.23; }</style></head>'
      );
    }

    return finalHtml;
  } catch (error) {
    console.error(`[Templating] Failed to read or process template ${templateName}:`, error);
    throw new Error(`Could not load or process template: ${templateName}`);
  }
}