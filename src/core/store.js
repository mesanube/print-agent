import Store from 'electron-store';

const store = new Store();

// --- Settings Management using electron-store ---

export function setSelectedPrinter(printerName) {
  store.set('selectedPrinter', printerName);
  console.log('[Settings] Selected printer saved:', printerName);
}

export function getSelectedPrinter() {
  return store.get('selectedPrinter', null);
}

// --- Explicit printer opt-in ---
// Distinguishes "the operator chose this printer" from "autoSelectPrinter saved
// the OS default on startup". `selectedPrinter` is non-null on almost every agent
// (auto-default), so its presence can NOT signal opt-in. This separate flag is set
// ONLY when a human selects a printer (HTTP /select-printer or the settings window
// IPC), and NEVER by autoSelectPrinter. The web client reads it from /status to
// decide whether this terminal prints receipts locally. Default false on upgrade.

export function setPrinterExplicitlySelected(value) {
  store.set('printerExplicitlySelected', !!value);
  console.log('[Settings] Printer explicitly selected:', !!value);
}

export function getPrinterExplicitlySelected() {
  return store.get('printerExplicitlySelected', false);
}

// Single operator opt-in path: persist the printer AND mark it as an explicit
// choice. Both selection surfaces (HTTP route and settings-window IPC) call this
// so the flag can never drift from `selectedPrinter`.
export function selectPrinterByOperator(printerName) {
  setSelectedPrinter(printerName);
  setPrinterExplicitlySelected(true);
}

export function setDefaultTemplate(templateName) {
  store.set('defaultTemplate', templateName);
  console.log('[Settings] Default template saved:', templateName);
}

export function getDefaultTemplate() {
  return store.get('defaultTemplate', 'modern-receipt.html'); // Fallback to modern-receipt.html
}

// --- Logo Management ---

export function setLogoPath(logoPath) {
  store.set('logoPath', logoPath);
  console.log('[Settings] Logo path saved:', logoPath);
}

export function getLogoPath() {
  return store.get('logoPath', null);
}

export function setLogoSize(logoSize) {
  store.set('logoSize', logoSize);
  console.log('[Settings] Logo size saved:', logoSize);
}

export function getLogoSize() {
  return store.get('logoSize', 50); // Default to 50% width
}

export function setQRCodeEnabled(enabled) {
  store.set('qrCodeEnabled', enabled);
  console.log('[Settings] QR code enabled:', enabled);
}

export function getQRCodeEnabled() {
  return store.get('qrCodeEnabled', true); // Default to enabled
}

// --- QR Code Size Management ---

export function setQRCodeSize(qrCodeSize) {
  store.set('qrCodeSize', qrCodeSize);
  console.log('[Settings] QR code size saved:', qrCodeSize);
}

export function getQRCodeSize() {
  return store.get('qrCodeSize', 60); // Default to 60% width
}

// --- Logo Enabled Management ---

export function setLogoEnabled(enabled) {
  store.set('logoEnabled', enabled);
  console.log('[Settings] Logo enabled:', enabled);
}

export function getLogoEnabled() {
  return store.get('logoEnabled', true); // Default to enabled
}

// --- Automatic cutter (per printer) ---
// Some drivers cut at the end of the job on top of the agent's own cut
// command, and the ticket comes out cut twice. Whether that happens is a
// property of the printer's driver, so the toggle travels with the printer
// (KD6), same map shape as printerTransports below. A missing entry is `true`:
// the old global key was hidden in the UI, so it is `true` on every install,
// which is exactly the new default (KTD1, no migration).

export function setPrinterCutter(printerName, enabled) {
  const cutters = store.get('printerCutters', {});
  cutters[printerName] = !!enabled;
  store.set('printerCutters', cutters);
  console.log('[Settings] Printer cutter saved:', printerName, '->', !!enabled);
}

export function getPrinterCutter(printerName) {
  const cutters = store.get('printerCutters', {});
  if (printerName && cutters[printerName] != null) return cutters[printerName];
  return true;
}

// --- Paper Width Management ---
// Per-printer, same shape as printerTransports below: a machine can have a
// 58mm printer at the counter and an 80mm one in the kitchen, so the paper
// size has to travel with the printer, not be a single global value. Stored
// as a map keyed by printer name; an entry missing for a given printer falls
// back to the pre-migration global `paperWidth` key (a single install-wide
// value) so an existing install doesn't silently reset to 80mm on upgrade.

export function setPaperWidth(printerName, width) {
  const widths = store.get('paperWidths', {});
  widths[printerName] = width;
  store.set('paperWidths', widths);
  console.log('[Settings] Paper width saved:', printerName, '->', width);
}

export function getPaperWidth(printerName) {
  const widths = store.get('paperWidths', {});
  if (printerName && widths[printerName] != null) return widths[printerName];
  return store.get('paperWidth', '80mm'); // pre-migration global default
}

// --- Width Adjust Management ---
// Compensates for a driver that scales the bitmap to the physical page
// instead of drawing it dot-for-dot (the residual case device-caps queries
// cannot detect, see paper-geometry.js). 100 is neutral: no adjustment.
// Per-printer for the same reason as paper width above: two printers on the
// same machine can need different corrections. Same migration fallback.

export function setWidthAdjust(printerName, percent) {
  const adjusts = store.get('widthAdjusts', {});
  adjusts[printerName] = percent;
  store.set('widthAdjusts', adjusts);
  console.log('[Settings] Width adjust saved:', printerName, '->', percent);
}

export function getWidthAdjust(printerName) {
  const adjusts = store.get('widthAdjusts', {});
  if (printerName && adjusts[printerName] != null) return adjusts[printerName];
  return store.get('widthAdjust', 100); // pre-migration global default
}

// --- Printer Transport Management ---
// Per-printer transport choice: 'gdi' (system driver, via cairo_printer.node)
// or 'raw' (ESC/POS RAW written directly to the Windows print queue). Stored
// as a map keyed by printer name so different printers on the same install
// can be in different modes. Missing entries default to 'gdi' (KD4): an
// install that upgrades without touching settings keeps printing through the
// driver, and a printer never silently starts in an unvalidated mode.

export function setPrinterTransport(printerName, mode) {
  const transports = store.get('printerTransports', {});
  transports[printerName] = mode;
  store.set('printerTransports', transports);
  console.log('[Settings] Printer transport saved:', printerName, '->', mode);
}

export function getPrinterTransport(printerName) {
  const transports = store.get('printerTransports', {});
  return transports[printerName] || 'gdi';
}

// --- Print Mode Management ---
// Per-printer: 'text' prints with the printer's own fonts as ESC/POS text
// (fast, KD1); 'compat' keeps the HTML-to-image path with its transport
// (gdi/raw) for printers that do not understand raw ESC/POS, such as some
// fiscal printers with a swapped driver (R9). A missing entry is 'text': every
// printer, new or existing, moves to text with the update (KD2, R10), with no
// migration.

export const PRINT_MODES = ['text', 'compat'];

export function setPrintMode(printerName, mode) {
  const modes = store.get('printModes', {});
  modes[printerName] = mode;
  store.set('printModes', modes);
  console.log('[Settings] Print mode saved:', printerName, '->', mode);
}

export function getPrintMode(printerName) {
  const modes = store.get('printModes', {});
  const mode = printerName ? modes[printerName] : null;
  return PRINT_MODES.includes(mode) ? mode : 'text';
}

export function getPrinterTransports() {
  return store.get('printerTransports', {});
}

// --- Register (caja) Management ---
// The register assigned to this terminal. Combined with the selected printer,
// this makes the print-agent the source of truth for the terminal's identity:
// a payment taken on this machine is booked into this register's shift.
// Stored as the register's id string; null means no terminal-level binding
// (the web client falls back to localStorage + manual selector).

export function setRegisterId(registerId) {
  store.set('registerId', registerId || null);
  console.log('[Settings] Register id saved:', registerId || null);
}

export function getRegisterId() {
  return store.get('registerId', null);
}