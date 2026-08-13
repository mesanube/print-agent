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

// --- Cutter Management ---

export function setCutterEnabled(enabled) {
  store.set('cutterEnabled', enabled);
  console.log('[Settings] Cutter enabled:', enabled);
}

export function getCutterEnabled() {
  return store.get('cutterEnabled', true); // Default to enabled
}

// --- Paper Width Management ---

export function setPaperWidth(width) {
  store.set('paperWidth', width);
  console.log('[Settings] Paper width saved:', width);
}

export function getPaperWidth() {
  return store.get('paperWidth', '80mm'); // Default to 80mm
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