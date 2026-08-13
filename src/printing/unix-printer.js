import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { randomUUID } from 'crypto';
import { getSelectedPrinter } from '../core/store.js';
import { getSystemPrinters } from './printer-manager.js';

const execAsync = promisify(exec);

async function printWithSystemCommand(text, printerName) {
  // Validate printer exists on system
  const systemPrinters = await getSystemPrinters();
  const printerExists = systemPrinters.find(p => p.name === printerName);

  if (!printerExists) {
    const availablePrinters = systemPrinters.map(p => p.name).join(', ');
    throw new Error(`Printer "${printerName}" not found. Available printers: ${availablePrinters}`);
  }

  console.log('[Unix Print] Starting print for macOS/Linux...');
  console.log('[Unix Print] Printer name:', printerName);
  const tempFile = path.join(os.tmpdir(), `receipt_${randomUUID()}.txt`);

  try {
    await fs.writeFile(tempFile, text);
    console.log('[Unix Print] Wrote to temp file:', tempFile);
    const cmd = `lp -d "${printerName}" -o raw "${tempFile}"`;
    console.log('[Unix Print] Executing print command:', cmd);
    await execAsync(cmd);
    console.log('[Unix Print] ✓ Print job sent successfully');
  } catch (error) {
    console.error('[Unix Print] Print command failed:', error.message);
    throw new Error('Print command failed: ' + error.message);
  } finally {
    try {
      await fs.unlink(tempFile);
      console.log('[Unix Print] Temp file cleaned up');
    } catch (error) {
      console.warn('[Unix Print] Could not delete temp file:', error.message);
    }
  }
}

export async function printReceipt(data, printerName = null) {
  const selectedPrinter = printerName || getSelectedPrinter();
  if (!selectedPrinter) {
    throw new Error('No printer selected or specified.');
  }

  console.log(`[Unix Print] Printing receipt to ${selectedPrinter} (${printerName ? 'specified' : 'default'})`);

  const restaurant = data.restaurant;
  const orderData = data.order || data;
  const now = new Date();
  let receiptText = `${restaurant?.name || 'Restaurant'}
${restaurant?.address || ''}
================

Table: ${orderData.table || '--'}
Waiter: ${orderData.waiter?.name || '--'}
Date: ${now.toLocaleDateString()}
Time: ${now.toLocaleTimeString()}

================
`;

  if (orderData.items && orderData.items.length > 0) {
    orderData.items.forEach(item => {
      const name = item.menuItem?.name || item.name || 'Unknown Item';
      const price = item.menuItem?.price || item.price || 0;
      const quantity = item.quantity || 1;
      const total = price * quantity;
      receiptText += name.padEnd(20) + ' x' + quantity + '  $' + total.toFixed(2) + '\n';
    });
  }

  if (orderData.notes) {
    receiptText += '\nNotes:\n' + orderData.notes + '\n';
  }

  const total = orderData.orderTotal || 0;
  receiptText += `
================

TOTAL: $${total.toFixed(2)}

Gracias!

`;
  await printWithSystemCommand(receiptText, selectedPrinter);
}

export async function printOrder(data, printerName = null) {
  const selectedPrinter = printerName || getSelectedPrinter();
  if (!selectedPrinter) {
    throw new Error('No printer selected or specified.');
  }

  console.log(`[Unix Print] Printing order to ${selectedPrinter} (${printerName ? 'specified' : 'default'})`);

  const restaurant = data.restaurant;
  const orderData = data.order || data;
  const now = new Date();

  // Kitchen order format - simpler, focused on order number and items
  let orderText = `
================
  #${orderData.dailyOrderNumber || orderData.orderNumber || '--'}
================

Mesa: ${orderData.table || '--'}
Mesero: ${orderData.waiter?.name || '--'}
Fecha: ${now.toLocaleDateString()}
Hora: ${now.toLocaleTimeString()}

================
`;

  if (orderData.items && orderData.items.length > 0) {
    orderData.items.forEach(item => {
      const name = item.menuItem?.name || item.name || 'Unknown Item';
      const quantity = item.quantity || 1;
      orderText += `${quantity}x ${name}\n`;
    });
  }

  if (orderData.notes) {
    orderText += `\nNotas:\n${orderData.notes}\n`;
  }

  orderText += '\n\n\n';

  await printWithSystemCommand(orderText, selectedPrinter);
}

/**
 * Print a kitchen UPDATE chit. Mirrors the KDS update card: short header,
 * only the diff lines, CANCEL/MODIFY clearly separated. Does not print a
 * full order header or totals — an UPDATE chit is not a receipt.
 *
 * Expected `data` shape:
 *   {
 *     type: 'kitchen-update',
 *     kitchenTicketId, restaurant,
 *     order: { dailyOrderNumber, table, waiter? },
 *     lines: [{ kind: 'add'|'cancel'|'modify', name, quantity, modifiers }]
 *   }
 */
export async function printOrderUpdate(data, printerName = null) {
  const selectedPrinter = printerName || getSelectedPrinter();
  if (!selectedPrinter) {
    throw new Error('No printer selected or specified.');
  }

  const order = data.order || {};
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const now = new Date();

  const formatLine = (line) => {
    const name = line.name || 'Item';
    const qty = line.quantity || 1;
    const modifiers =
      line.modifiers && line.modifiers.length > 0
        ? '\n  ' + line.modifiers.map((m) => m.name || m.menuItem?.name).filter(Boolean).join(', ')
        : '';
    if (line.kind === 'note') return `*** NOTA: ${name}`;
    if (line.kind === 'cancel') return `*** CANCELAR: ${qty}x ${name}${modifiers}`;
    if (line.kind === 'modify') return `*** MODIFICAR: ${qty}x ${name}${modifiers}`;
    return `+${qty}x ${name}${modifiers}`;
  };

  // Order destination: dine-in shows the table, delivery/takeout show
  // a banner + customer name (mirrors the modern-order.html created chit).
  let destinationText;
  if (order.orderType === 'delivery') {
    destinationText =
      '-- DELIVERY --\n' +
      (order.deliveryName ? `Nombre: ${order.deliveryName}\n` : '') +
      (order.deliveryAddress ? `Dirección: ${order.deliveryAddress}\n` : '');
  } else if (order.orderType === 'takeout') {
    destinationText =
      '-- PARA LLEVAR --\n' +
      (order.deliveryName ? `Nombre: ${order.deliveryName}\n` : '');
  } else {
    destinationText = `Mesa: ${order.table || '--'}\n`;
  }

  let chit = `
================
*** ACTUALIZACION ***
  #${order.dailyOrderNumber || '--'}
================

${destinationText}Mesero: ${order.waiter?.name || '--'}
Hora: ${now.toLocaleTimeString()}

================
`;

  for (const line of lines) {
    chit += `${formatLine(line)}\n`;
  }

  chit += '\n\n\n';

  await printWithSystemCommand(chit, selectedPrinter);
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
  const testText = `PRINT AGENT TEMPLATE TEST
================
${restaurant.name}
${restaurant.address}

Date: ${new Date().toLocaleDateString()}
Time: ${new Date().toLocaleTimeString()}
Table: TEST
Waiter: Test User

================
Test Item 1        x1   $5.00
Test Item 2        x2  $20.00
================

TOTAL: $25.00

Notes:
This is a test print from a template.
Gracias!
Test Print: ${new Date().toLocaleString()}
`;
  await printWithSystemCommand(testText, selectedPrinter);
}