import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { BrowserWindow } from 'electron';
import { getSelectedPrinter, getCutterEnabled, getPrinterTransport } from '../core/store.js';
import { generateHtmlFromTemplate, renderCashCloseHtml, renderDayZHtml } from './template-manager.js';
import { getSystemPrinters } from './printer-manager.js';
import { getPaperGeometry } from './paper-geometry.js';
import { renderCalibrationHtml } from './calibration-page.js';
import { printBitmap as printBitmapGdi } from './transports/gdi-transport.js';
import { printBitmap as printBitmapRaw } from './transports/raw-transport.js';

const TRANSPORTS = { gdi: printBitmapGdi, raw: printBitmapRaw };

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
 * @param {string|null} printerName The printer whose device width to use.
 * @returns {Promise<BrowserWindow>}
 */
function getOrCreatePrintWindow(printerName = null) {
  const geometry = getPaperGeometry(printerName);
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
 * @returns {Promise<Electron.NativeImage>} A Promise that resolves with the captured NativeImage.
 */
async function captureHtmlOnDemand(htmlContent, printerName = null) {
  try {
    const geometry = getPaperGeometry(printerName);
    const printWindow = getOrCreatePrintWindow(printerName);

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

    // Return the NativeImage itself, not a pre-encoded PNG: each transport
    // decides what it needs (gdi-transport writes a temp PNG, raw-transport
    // reads the raw bitmap via toBitmap()), per KTD4.
    return image;
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
    const image = await captureHtmlOnDemand(htmlContent, printerName);
    await dumpPngForReview(image.toPNG(), printerName);
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

  const transportMode = getPrinterTransport(selectedPrinter);
  const printBitmap = TRANSPORTS[transportMode] || printBitmapGdi;

  console.log(`[Windows Print] Printing to ${selectedPrinter} (${printerName ? 'specified' : 'default'}) via ${transportMode}`);

  const image = await captureHtmlOnDemand(htmlContent, selectedPrinter);
  const geometry = getPaperGeometry(selectedPrinter);

  await printBitmap({
    printerName: selectedPrinter,
    image,
    geometry,
    cutter: getCutterEnabled(), // Use stored setting
  });
}

export async function printReceipt(data, printerName = null) {
  const restaurant = data.restaurant;
  const orderData = data.order || data;
  const effectivePrinter = printerName || getSelectedPrinter();
  const html = await generateHtmlFromTemplate(orderData, restaurant, 'modern-receipt.html', "receipt", undefined, effectivePrinter);
  await printHtml(html, effectivePrinter);
}

export async function printOrder(data, printerName = null) {
  const restaurant = data.restaurant;
  const orderData = data.order || data;
  const effectivePrinter = printerName || getSelectedPrinter();
  // Use modern-order.html template for kitchen orders
  const html = await generateHtmlFromTemplate(orderData, restaurant, 'modern-order.html', "order", undefined, effectivePrinter);
  await printHtml(html, effectivePrinter);
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
    // Same visual weight as modify (it's still a flagged line), but its own
    // class in case it ever needs its own look later.
    if (kind === 'note-update') return 'line note-update';
    return 'line add';
  };
  const linePrefix = (kind) => {
    if (kind === 'cancel') return 'CANCELAR:';
    if (kind === 'modify') return 'MODIFICAR:';
    // Same quantity, only the note changed: nothing about the dish itself
    // changed, so this reads as "go re-read the note", not "redo the plate".
    // Kept distinct from MODIFICAR: (see kitchenDiffToLines.js).
    if (kind === 'note-update') return 'NOTA ACTUALIZADA:';
    return '+';
  };

  const linesHtml = lines
    .map((line) => {
      // Order-level note change (kind: 'note'): NOT a per-item line, so it
      // gets its own block instead of reusing the item-line template. Shows
      // a diff, not just the new text: the old note struck through, the new
      // note below it, so the cook doesn't have to remember what it used to
      // say. Three banners for the three states kitchenDiffToLines.js emits
      // (noteStatus): a brand-new note ('added', nothing to strike through),
      // an edit ('modified', both shown), a clear ('removed', old text only).
      if (line.kind === 'note') {
        const banner =
          line.noteStatus === 'added' ? '* NOTA AGREGADA *' :
          line.noteStatus === 'removed' ? '* NOTA ELIMINADA *' :
          '* NOTA MODIFICADA *';
        const oldHtml = line.noteBefore
          ? `<div class="order-note__old">${escapeHtml(line.noteBefore)}</div>`
          : '';
        const newHtml = line.noteAfter
          ? `<div><b>NOTAS:</b> <i>${escapeHtml(line.noteAfter)}</i></div>`
          : '';
        return `<div class="order-note">
          <div class="order-note__banner">${banner}</div>
          ${oldHtml}
          ${newHtml}
        </div>`;
      }
      const mods =
        line.modifiers && line.modifiers.length > 0
          ? `<div class="mods">${line.modifiers
              .map((m) => escapeHtml(m.name || m.menuItem?.name))
              .filter(Boolean)
              .join(', ')}</div>`
          : '';
      // Per-unit note of the item, under its line and with the same layout as
      // the original chit. An add/cancel line is already one physical unit, so
      // its note belongs to that unit; a modify line is not split, so it
      // carries every note of the item joined by the client.
      const noteHtml = line.note ? `<div class="note"><b>Nota:</b> ${escapeHtml(line.note)}</div>` : '';
      return `<div class="${lineClass(line.kind)}">
        <span class="prefix">${linePrefix(line.kind)}</span>
        <span class="qty">${escapeHtml(line.quantity || 1)}x</span>
        <span class="name">${escapeHtml(line.name || 'Item')}</span>
        ${mods}
        ${noteHtml}
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
  } else if (order.orderType === 'counter') {
    destinationHtml =
      '<div class="destination">-- MOSTRADOR --</div>' +
      (order.deliveryName ? `<div class="meta">Nombre: ${escapeHtml(order.deliveryName)}</div>` : '');
  } else {
    destinationHtml = `<div class="meta">Mesa: ${escapeHtml(order.table || '--')}</div>`;
  }

  // Llamador (Order.callButton): independent of the destination banner above,
  // shown only when the payload actually includes it.
  if (order.callButton) {
    destinationHtml += `<div class="meta">Llamador: ${escapeHtml(order.callButton)}</div>`;
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
    .mods { width: 100%; font-weight: normal; font-size: 14px; padding-left: 12px; }
    /* Per-unit note. pre-wrap keeps the typed line breaks, which collapse
       otherwise. No indent: the "Nota:" label already marks it as subordinate
       to the item line above it. */
    .note { width: 100%; white-space: pre-wrap; font-style: italic; font-weight: normal; }
    /* Order-level note change: bordered like .destination so it reads as its
       own block, not an item line. i is not bold, matching the comanda's
       NOTAS: block (modern-order.html) so the two look like the same concept. */
    .order-note { border: 2px solid #000; padding: 6px 8px; margin: 8px 0; white-space: pre-wrap; }
    .order-note__banner { text-align: center; font-size: 15px; margin-bottom: 4px; }
    .order-note i { font-style: italic; font-weight: normal; }
    /* The note as it read before the edit, struck through so the cook can see
       what changed without having to remember the old text. Lighter weight
       than the new text below so the eye lands on what matters now. */
    .order-note__old { text-decoration: line-through; font-weight: normal; opacity: 0.7; margin-bottom: 4px; }
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
  const effectivePrinter = printerName || getSelectedPrinter();

  const html = await generateHtmlFromTemplate(order, restaurant, 'modern-invoice.html', "invoice", invoiceData, effectivePrinter);

  await printHtml(html, effectivePrinter);
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

export async function printCalibrationPage(printerName = null) {
  const html = renderCalibrationHtml();
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

  const html = await generateHtmlFromTemplate(testOrder, restaurant, null, "receipt", undefined, selectedPrinter);
  await printHtml(html, selectedPrinter);
}