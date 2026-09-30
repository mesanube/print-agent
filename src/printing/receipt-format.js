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
