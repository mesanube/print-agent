// Formatting shared by the HTML templates (compatibility mode) and the ESC/POS
// text documents, so both modes print the same numbers and labels.

/**
 * Formats a number with . for thousands separator and , for decimals
 * Example: 1234.56 -> "1.234,56"
 * @param {number} num - The number to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted number string
 */
export function formatPrice(num, decimals = 2) {
  const fixed = num.toFixed(decimals);
  const [integer, decimal] = fixed.split('.');
  const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal ? `${formattedInteger},${decimal}` : formattedInteger;
}

// Canonical Spanish labels for the legacy payment-method enum, used when an order
// predates the configurable PaymentMethod ref (MES-119) so byMethod falls back to
// the raw enum string instead of a display name.
export const PM_LEGACY_LABELS = {
  cash: 'Efectivo',
  debit: 'Tarjeta debito',
  credit: 'Tarjeta credito',
  transfer: 'Transferencia / QR',
};

export const DOC_TYPE_LABELS = { remito: 'Remito', invoice: 'Factura', receipt: 'Recibo', other: 'Otro' };

export const MISSING_ORDER_MESSAGE = 'Falta el pedido del comprobante';

/**
 * Credit-note ticket line under the voucher title, e.g. "Fac. C: 0002-00000077". The server sends
 * `comprobanteAsociado` only on a credit note; a factura has none and prints no line.
 * @param {object} invoiceData
 * @returns {string} the line, or '' when the invoice is not a credit note
 */
export function associatedInvoiceLine(invoiceData) {
  const associated = invoiceData?.isCreditNote ? invoiceData.comprobanteAsociado : null;
  if (!associated) return '';
  const pointOfSale = String(associated.puntoVenta ?? '').padStart(4, '0');
  const number = String(associated.numeroComprobante ?? '').padStart(8, '0');
  return `Fac. ${associated.letra}: ${pointOfSale}-${number}`;
}

/**
 * Date the invoice ticket stamps in its Fecha/Hora rows: the moment the credit note was issued
 * (the sale may be days older), or the sale itself for a factura.
 * @param {object} order
 * @param {object} invoiceData
 * @returns {string|Date|undefined}
 */
export function invoiceTicketDate(order, invoiceData) {
  if (invoiceData?.isCreditNote && invoiceData.fechaHoraEmision) return invoiceData.fechaHoraEmision;
  return order?.createdAt;
}

// Issuer IVA legend (RG 1415, Anexo II, Apartado A, I), a), 5). The POS sends it whole because
// it varies by regime ("Responsable Monotributo", not "IVA Monotributo"). A POS that predates
// the field only sends the label, which this agent always printed behind "IVA ".
export function issuerIvaLegend(invoiceData) {
  return invoiceData.condicionIvaEmisorLegend || `IVA ${invoiceData.condicionIvaEmisorLabel || ''}`;
}

// AFIP dates travel as AAAAMMDD (the issuer's inicio de actividades does, unformatted). Anything
// else, such as an already formatted date, prints as it came.
export function formatAfipDate(value) {
  const str = String(value ?? '');
  return /^\d{8}$/.test(str) ? `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}` : str;
}

