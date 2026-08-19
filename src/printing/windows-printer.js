import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { BrowserWindow } from 'electron';
import { getSelectedPrinter, getCutterEnabled } from '../core/store.js';
import { printReceiptNative } from './native/windows-native-printer.js';
import { generateHtmlFromTemplate, renderCashCloseHtml, renderDayZHtml } from './template-manager.js';
import { getSystemPrinters } from './printer-manager.js';
import { getPaperGeometry } from './paper-geometry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Shared BrowserWindow for rendering - reused across all print jobs to prevent leaks
let sharedPrintWindow = null;
// The paper geometry this shared window was created with. zoomFactor cannot be
// changed on an already-created BrowserWindow without a reload, so when the
// effective geometry changes (paper or device width) we recreate the window
// with the new geometry (paper changes once every few months, KTD2).
let printWindowGeometry = null;

/**
 * Gets or creates the shared print window at the current paper geometry.
 * @returns {Promise<BrowserWindow>}
 */
function getOrCreatePrintWindow() {
  const geometry = getPaperGeometry();
  const needsRecreate = sharedPrintWindow && !sharedPrintWindow.isDestroyed() && printWindowGeometry && (
    printWindowGeometry.dots !== geometry.dots ||
    printWindowGeometry.zoomFactor !== geometry.zoomFactor
  );
  if (needsRecreate) {
    sharedPrintWindow.destroy();
    sharedPrintWindow = null;
    console.log('[Windows Print] Recreating print window for new paper geometry');
  }
  if (!sharedPrintWindow || sharedPrintWindow.isDestroyed()) {
    sharedPrintWindow = new BrowserWindow({
      show: false,
      width: geometry.dots,
      height: 2048,
      webPreferences: {
        offscreen: true, // Render offscreen for better performance and no flashing
        nodeIntegration: false,
        zoomFactor: geometry.zoomFactor,
      }
    });
    printWindowGeometry = geometry;
    console.log(`[Windows Print] Created new shared print window at ${geometry.dots}px, zoom ${geometry.zoomFactor.toFixed(4)}`);
  }
  return sharedPrintWindow;
}

/**
 * Destroys the shared print window (called on errors or app shutdown)
 */
export function destroyPrintWindow() {
  if (sharedPrintWindow && !sharedPrintWindow.isDestroyed()) {
    sharedPrintWindow.destroy();
    sharedPrintWindow = null;
    console.log('[Windows Print] Destroyed shared print window');
  }
}

/**
 * Renders HTML content in the shared browser window and captures it as a PNG.
 * Reuses a single BrowserWindow across all print jobs to prevent resource leaks.
 * @param {string} htmlContent - The full HTML string to render.
 * @returns {Promise<Buffer>} A Promise that resolves with the PNG image buffer.
 */
async function captureHtmlOnDemand(htmlContent) {
  try {
    const geometry = getPaperGeometry();
    const printWindow = getOrCreatePrintWindow();

    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    // Wait longer for content to render and settle (increased for QR code SVG rendering)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Get the actual height of the content
    // IMPORTANT: Since zoomFactor is 2.0, we need to account for this in measurements
    const debugInfo = await printWindow.webContents.executeJavaScript(`
      (() => {
        const body = document.body;
        const html = document.documentElement;

        // Force a layout/reflow to ensure everything is measured
        body.offsetHeight;

        // Get all possible height measurements
        const scrollHeight = Math.max(
          html.scrollHeight,
          html.offsetHeight,
          html.clientHeight,
          body.scrollHeight,
          body.offsetHeight,
          body.clientHeight
        );

        // Get the last element in the document
        const allElements = Array.from(document.querySelectorAll('*'));
        let maxBottom = 0;
        let maxElement = null;

        allElements.forEach(el => {
          const rect = el.getBoundingClientRect();
          const elementBottom = rect.bottom;
          if (elementBottom > maxBottom) {
            maxBottom = elementBottom;
            maxElement = el.className || el.tagName;
          }
        });

        // Get specific elements
        const receipt = document.querySelector('.receipt');
        const spacer = document.querySelector('.spacer');
        const footer = document.querySelector('.footer');
        const itemsContainer = document.querySelector('#items-container');
        const qrSection = document.querySelector('.qr-section');
        const taxSectionDetails = document.querySelector('.tax-section-details');
        const taxSection = document.querySelector('.tax-section');

        return {
          scrollHeight,
          maxElementBottom: maxBottom,
          maxElementName: maxElement,
          receiptHeight: receipt ? receipt.getBoundingClientRect().height : 0,
          receiptBottom: receipt ? receipt.getBoundingClientRect().bottom : 0,
          spacerHeight: spacer ? spacer.getBoundingClientRect().height : 0,
          spacerBottom: spacer ? spacer.getBoundingClientRect().bottom : 0,
          footerBottom: footer ? footer.getBoundingClientRect().bottom : 0,
          qrSectionHeight: qrSection ? qrSection.getBoundingClientRect().height : 0,
          qrSectionBottom: qrSection ? qrSection.getBoundingClientRect().bottom : 0,
          taxSectionDetailsBottom: taxSectionDetails ? taxSectionDetails.getBoundingClientRect().bottom : 0,
          taxSectionBottom: taxSection ? taxSection.getBoundingClientRect().bottom : 0,
          itemsContainerHeight: itemsContainer ? itemsContainer.getBoundingClientRect().height : 0,
          itemsCount: itemsContainer ? itemsContainer.children.length : 0,
          bodyHeight: body.getBoundingClientRect().height,
          htmlHeight: html.getBoundingClientRect().height,
          windowInnerHeight: window.innerHeight,
          zoomLevel: window.devicePixelRatio
        };
      })()
    `);

    // Use the maximum bottom position of all elements
    // This should capture everything including the spacer, QR code, and CAE info
    // Note: scrollHeight is unreliable, so we rely on element measurements
    // Multiply by the zoomFactor to convert CSS pixels to device points, then
    // round up — setContentSize/capturePage need whole pixels.
    const finalHeight = Math.ceil(Math.max(
      Math.ceil(debugInfo.maxElementBottom),
      Math.ceil(debugInfo.receiptBottom),
      Math.ceil(debugInfo.spacerBottom),
      Math.ceil(debugInfo.qrSectionBottom || 0),
      Math.ceil(debugInfo.taxSectionBottom || 0),
    ) * geometry.zoomFactor);

    // Resize the BrowserWindow to fit the content (necessary for tall receipts)
    // Width is the printable width in points, so the capture comes out at
    // exactly one point per pixel.
    printWindow.setContentSize(geometry.dots, finalHeight);

    // Wait a bit longer for window resize and re-render to complete (increased for QR code)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify the window actually resized
    const [actualWidth, actualHeight] = printWindow.getContentSize();

    // Capture at the printable width: one captured pixel per printer point
    const image = await printWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: geometry.dots,
      height: finalHeight
    });

    const imageSize = image.getSize();

    return image.toPNG();
  } catch (error) {
    // On error, destroy the window to ensure clean state for next print
    console.error('[Windows Print] Error during capture, destroying window:', error.message);
    destroyPrintWindow();
    throw error;
  }
}

// Whole-job serialization queue. Concurrent SSE events (one per Sector) call
// printHtml in parallel, but the shared offscreen BrowserWindow can only
// render one HTML at a time — without serialization, the second loadURL would
// overwrite the first job's content mid-capture, sending the wrong chit to the
// wrong printer. We chain every job onto the previous one. The .catch on the
// stored tail keeps the chain alive after a failure so the next caller doesn't
// inherit a rejected promise.
let printQueue = Promise.resolve();

async function printHtml(htmlContent, printerName = null) {
  const myTurn = printQueue.then(
    () => doPrintHtml(htmlContent, printerName),
    () => doPrintHtml(htmlContent, printerName),
  );
  printQueue = myTurn.catch(() => {});
  return myTurn;
}

/**
 * Renders HTML content to an image and sends it to the native printer module.
 * @param {string} htmlContent The HTML to print.
 * @param {string|null} printerName Optional printer name to override default.
 */
// Debug dry-run: PRINT_AGENT_DRY_RUN=1 yarn dev → captures the receipt PNG
// and writes it to ~/print-agent-debug/ instead of sending to the printer.
// Lets you iterate on templates/QR sizing without a printer connected.
const DRY_RUN = process.env.PRINT_AGENT_DRY_RUN === '1';
const DEBUG_DIR = path.join(os.homedir(), 'print-agent-debug');

async function dumpPngForReview(imageBuffer, printerName) {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Sanitize printer name for the filename so per-Sector routing is visible
  // when reviewing dumps from a multi-Sector fan-out.
  const safePrinter = (printerName || 'noprinter').replace(/[^A-Za-z0-9._-]+/g, '_');
  const suffix = randomUUID().slice(0, 6);
  const file = path.join(DEBUG_DIR, `receipt-${stamp}-${safePrinter}-${suffix}.png`);
  await fs.writeFile(file, imageBuffer);
  console.log(`[Print DEBUG] PNG written to ${file} (${imageBuffer.length} bytes)`);
  return file;
}

async function doPrintHtml(htmlContent, printerName = null) {
  if (DRY_RUN) {
    console.log(`[Print DEBUG] PRINT_AGENT_DRY_RUN=1 — capturing PNG for printer "${printerName || '(none)'}" instead of printing.`);
    const imageBuffer = await captureHtmlOnDemand(htmlContent);
    await dumpPngForReview(imageBuffer, printerName);
    return;
  }

  const selectedPrinter = printerName || getSelectedPrinter();

  if (!selectedPrinter) {
    throw new Error('No printer selected or specified.');
  }

  // Validate printer exists on system
  const systemPrinters = await getSystemPrinters();
  const printerExists = systemPrinters.find(p => p.name === selectedPrinter);

  if (!printerExists) {
    const availablePrinters = systemPrinters.map(p => p.name).join(', ');
    throw new Error(`Printer "${selectedPrinter}" not found. Available printers: ${availablePrinters}`);
  }

  console.log(`[Windows Print] Printing to ${selectedPrinter} (${printerName ? 'specified' : 'default'})`);

  const tempPath = path.join(os.tmpdir(), `receipt-${randomUUID()}.png`);

  try {
    const imageBuffer = await captureHtmlOnDemand(htmlContent);
    await fs.writeFile(tempPath, imageBuffer);

    console.log(`[Windows Print] Rendering image ${tempPath} (${imageBuffer.length} bytes)`);
    printReceiptNative({
      printerName: selectedPrinter,
      imageInput: tempPath,
      threshold: 180,
      edgeBoost: 20,
      dpi: 203,
      cutter: getCutterEnabled(), // Use stored setting
    });
  } finally {
    await fs.unlink(tempPath).catch(err => {
      console.warn(`[Windows Print] Could not delete temp file: ${tempPath}`, err.message);
    });
  }
}

export async function printReceipt(data, printerName = null) {
  const restaurant = data.restaurant;
  const orderData = data.order || data;
  const html = await generateHtmlFromTemplate(orderData, restaurant, 'modern-receipt.html', "receipt");
  await printHtml(html, printerName);
}

export async function printOrder(data, printerName = null) {
  const restaurant = data.restaurant;
  const orderData = data.order || data;
  // Use modern-order.html template for kitchen orders
  const html = await generateHtmlFromTemplate(orderData, restaurant, 'modern-order.html', "order");
  await printHtml(html, printerName);
}

/**
 * Print a kitchen UPDATE chit (Windows). Generates minimal inline HTML
 * matching the unix chit format and routes through the standard printHtml
 * pipeline. No template file in v1 — keeps the surface small.
 */
export async function printOrderUpdate(data, printerName = null) {
  const order = data.order || {};
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const now = new Date();

  const escapeHtml = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const lineClass = (kind) => {
    if (kind === 'cancel') return 'line cancel';
    if (kind === 'modify') return 'line modify';
    if (kind === 'note') return 'line modify'; // note reuses the modify look (info, not error)
    return 'line add';
  };
  const linePrefix = (kind) => {
    if (kind === 'cancel') return 'CANCELAR:';
    if (kind === 'modify') return 'MODIFICAR:';
    if (kind === 'note') return 'NOTA:';
    return '+';
  };

  const linesHtml = lines
    .map((line) => {
      const mods =
        line.modifiers && line.modifiers.length > 0
          ? `<div class="mods">${line.modifiers
              .map((m) => escapeHtml(m.name || m.menuItem?.name))
              .filter(Boolean)
              .join(', ')}</div>`
          : '';
      // A note line has no quantity — render only the prefix + text.
      const qtyHtml =
        line.kind === 'note' ? '' : `<span class="qty">${escapeHtml(line.quantity || 1)}x</span>`;
      return `<div class="${lineClass(line.kind)}">
        <span class="prefix">${linePrefix(line.kind)}</span>
        ${qtyHtml}
        <span class="name">${escapeHtml(line.name || 'Item')}</span>
        ${mods}
      </div>`;
    })
    .join('\n');

  // Order destination block: dine-in shows the table, delivery/takeout show
  // a banner + customer name (mirrors the modern-order.html created chit).
  let destinationHtml;
  if (order.orderType === 'delivery') {
    destinationHtml =
      '<div class="destination">-- DELIVERY --</div>' +
      (order.deliveryName ? `<div class="meta">Nombre: ${escapeHtml(order.deliveryName)}</div>` : '') +
      (order.deliveryAddress ? `<div class="meta">Dirección: ${escapeHtml(order.deliveryAddress)}</div>` : '');
  } else if (order.orderType === 'takeout') {
    destinationHtml =
      '<div class="destination">-- PARA LLEVAR --</div>' +
      (order.deliveryName ? `<div class="meta">Nombre: ${escapeHtml(order.deliveryName)}</div>` : '');
  } else {
    destinationHtml = `<div class="meta">Mesa: ${escapeHtml(order.table || '--')}</div>`;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Kitchen Update</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 309px; font-family: monospace; font-size: 18px; color: #000; font-weight: bold; }
    .chit { padding: 10px 5px 120px; }
    .header { background: #000; color: #fff; padding: 6px; text-align: center; }
    .header h2 { font-size: 22px; }
    .destination { border: 2px solid #000; padding: 6px 8px; margin: 8px 0; text-align: center; font-size: 16px; }
    .meta { margin: 6px 0; }
    .line { padding: 4px 0; border-bottom: 1px dashed #000; display: flex; gap: 6px; flex-wrap: wrap; }
    .line.cancel { background: #000; color: #fff; padding: 4px; }
    .line.modify { border-left: 6px solid #000; padding-left: 6px; }
    .mods { width: 100%; font-weight: normal; font-size: 14px; padding-left: 12px; }
    .footer { margin-top: 16px; }
  </style>
</head>
<body>
  <div class="chit">
    <div class="header">
      <h2>** ACTUALIZACION **</h2>
      <h2>#${escapeHtml(order.dailyOrderNumber || '--')}</h2>
    </div>
    ${destinationHtml}
    <div class="meta">Mesero: ${escapeHtml(order.waiter?.name || '--')}</div>
    <div class="meta">Hora: ${escapeHtml(now.toLocaleTimeString())}</div>
    <hr />
    ${linesHtml}
    <div class="footer">&nbsp;</div>
  </div>
</body>
</html>`;

  await printHtml(html, printerName);
}

export async function printInvoice(data, printerName = null) {

  const { restaurant, order, invoiceData } = data

  const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', "invoice", invoiceData);

  await printHtml(html, printerName);
}

export async function printCashClose(data, printerName = null) {
  const { restaurant, summary } = data;
  const html = await renderCashCloseHtml(summary, restaurant);
  await printHtml(html, printerName);
}

export async function printDayZ(data, printerName = null) {
  const { restaurant, summary } = data;
  const html = await renderDayZHtml(summary, restaurant);
  await printHtml(html, printerName);
}

export async function printTestPage(restaurantData = null) {
  const selectedPrinter = getSelectedPrinter();
  if (!selectedPrinter) {
    throw new Error('No printer selected.');
  }

  const restaurant = restaurantData || {
    name: "Test Restaurant",
    address: "123 Main Street, Anytown",
  };
  const testOrder = {
    table: 'TEST',
    waiter: { name: 'Test User' },
    items: [
      { name: 'Test Item 1', quantity: 1, price: 5.00 },
      { name: 'Test Item 2', quantity: 2, price: 10.00 },
    ],
    orderTotal: 25.00,
    notes: 'This is a test print from a template.'
  };

  const html = await generateHtmlFromTemplate(testOrder, restaurant);
  await printHtml(html);
}