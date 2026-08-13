import { printReceipt as printReceiptWindows, printOrder as printOrderWindows, printOrderUpdate as printOrderUpdateWindows, printTestPage as printTestPageWindows, printInvoice as printInvoiceWindows, printCashClose as printCashCloseWindows, printDayZ as printDayZWindows } from './windows-printer.js';
import { printReceipt as printReceiptUnix, printOrder as printOrderUnix, printOrderUpdate as printOrderUpdateUnix, printTestPage as printTestPageUnix } from './unix-printer.js';

const isWindows = process.platform === 'win32';

/**
 * Prints a receipt with order and restaurant data.
 * Automatically selects the correct printing method based on the OS.
 * @param {object} data - The receipt data.
 * @param {string|null} printerName - Optional printer name to override default.
 */
export async function printReceipt(data, printerName = null) {
  try {
    // if (isWindows) {
    await printReceiptWindows(data, printerName);
    // } else {
    //   await printReceiptUnix(data, printerName);
    // }
    console.log(`[Print] ✓ Receipt printed successfully to ${printerName || 'default printer'}`);
  } catch (error) {
    console.error('[Print] ✗ Receipt printing failed:', error);
    throw new Error(`Print receipt failed: ${error.message}`);
  }
}

/**
 * Prints a kitchen order with order data.
 * Uses the modern-order.html template for kitchen display.
 * Automatically selects the correct printing method based on the OS.
 * @param {object} data - The order data with dailyOrderNumber.
 * @param {string|null} printerName - Optional printer name to override default.
 */
export async function printOrder(data, printerName = null) {
  try {
    if (isWindows) {
      await printOrderWindows(data, printerName);
    } else {
      await printOrderUnix(data, printerName);
    }
    console.log(`[Print] ✓ Order printed successfully to ${printerName || 'default printer'}`);
  } catch (error) {
    console.error('[Print] ✗ Order printing failed:', error);
    throw new Error(`Print order failed: ${error.message}`);
  }
}

/**
 * Prints a kitchen UPDATE chit — only the diff lines from a non-empty
 * server-emitted kitchen diff. Mirrors the KDS update card.
 * @param {object} data - { kitchenTicketId, order, lines, restaurant }
 * @param {string|null} printerName
 */
export async function printOrderUpdate(data, printerName = null) {
  try {
    if (isWindows) {
      await printOrderUpdateWindows(data, printerName);
    } else {
      await printOrderUpdateUnix(data, printerName);
    }
    console.log(`[Print] ✓ Update chit printed successfully to ${printerName || 'default printer'}`);
  } catch (error) {
    console.error('[Print] ✗ Update chit printing failed:', error);
    throw new Error(`Print update failed: ${error.message}`);
  }
}

export async function printInvoice(data, printerName = null) {

  await printInvoiceWindows(data, printerName);

  // try {
  //   if (isWindows) {
  //     await printInvoiceWindows(data, printerName);
  //   } else {
  //     await printInvoiceUnix(data, printerName);
  //   }
  //   console.log(`[Print] ✓ Order printed successfully to ${printerName || 'default printer'}`);
  // } catch (error) {
  //   console.error('[Print] ✗ Order printing failed:', error);
  //   throw new Error(`Print order failed: ${error.message}`);
  // }

}

/**
 * Prints a cash-close summary (resumen de cierre de caja).
 * The Unix path has no cash-close renderer yet, so this is Windows-only and
 * guarded by process.platform: on other platforms it is a logged no-op so dev
 * environments (macOS) do not invoke the Windows-only native binding.
 * @param {object} data - { restaurant, summary }
 * @param {string|null} printerName - Optional printer name to override default.
 */
export async function printCashClose(data, printerName = null) {
  if (!isWindows) {
    console.log('[Print] cash-close printing is only supported on Windows; skipping on this platform');
    return;
  }
  try {
    await printCashCloseWindows(data, printerName);
    console.log(`[Print] ✓ Cash-close printed successfully to ${printerName || 'default printer'}`);
  } catch (error) {
    console.error('[Print] ✗ Cash-close printing failed:', error);
    throw new Error(`Print cash-close failed: ${error.message}`);
  }
}

/**
 * Prints the internal day Z símil (MES-155). Windows-only like cash-close;
 * guarded by process.platform so dev (macOS) does not invoke the native binding.
 * @param {object} data - { restaurant, summary }
 * @param {string|null} printerName - Optional printer name to override default.
 */
export async function printDayZ(data, printerName = null) {
  if (!isWindows) {
    console.log('[Print] day-Z printing is only supported on Windows; skipping on this platform');
    return;
  }
  try {
    await printDayZWindows(data, printerName);
    console.log(`[Print] ✓ Day-Z printed successfully to ${printerName || 'default printer'}`);
  } catch (error) {
    console.error('[Print] ✗ Day-Z printing failed:', error);
    throw new Error(`Print day-Z failed: ${error.message}`);
  }
}

/**
 * Prints a test page with sample data.
 * Automatically selects the correct printing method based on the OS.
 * @param {object | null} restaurantData - Optional restaurant data for the test.
 */
export async function printTestPage(restaurantData = null) {
  try {
    if (isWindows) {
      await printTestPageWindows(restaurantData);
    } else {
      await printTestPageUnix(restaurantData);
    }
    console.log('[Print Test] ✓ Template test page printed successfully');
  } catch (error) {
    console.error('[Print Test] ✗ Template test failed:', error);
    throw new Error(`Template test failed: ${error.message}`);
  }
}