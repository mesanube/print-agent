import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// Helper to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a local 'require' function that works in ES Modules
const require = createRequire(import.meta.url);

let thermalPrinter = null;
const isWindows = process.platform === 'win32';

if (isWindows) {
  try {
    // The .node file should be placed alongside this script.
    const modulePath = path.join(__dirname, 'cairo_printer.node');
    console.log(`[Native Printer] Loading cairo_printer.node from ${modulePath}`);
    // Use our newly created 'require' function
    thermalPrinter = require(modulePath);
    console.log('[Native Printer] Cairo printer native module loaded successfully.');
  } catch (error) {
    console.error('[Native Printer] ✗ Failed to load cairo_printer.node module. Native printing will be disabled.', error);
    thermalPrinter = null;
  }
} else {
  console.log('[Native Printer] Skipping native module load on non-Windows platform.');
}

/**
 * Prints a receipt from an image file using the native module.
 * @param {object} options - The options for printing.
 * @param {string} options.printerName - The name of the target printer.
 * @param {string} options.imageInput - The file path of the image to print.
 * @param {number} [options.threshold=180] - Image processing threshold.
 * @param {number} [options.edgeBoost=20] - Image processing edge boost.
 * @param {number} [options.dpi=0] - The printer DPI.
 * @param {boolean} [options.cutter=true] - Whether to use the paper cutter.
 */
export function printReceiptNative(options) {
  if (!isWindows || !thermalPrinter) {
    throw new Error('Windows native printing is not available on this platform.');
  }
  try {
    thermalPrinter.printReceipt({
      cutter: true, // Default to true
      ...options,
    });
    console.log(`[Native Printer] ✓ Print job sent to "${options.printerName}".`);
  } catch (e) {
    console.error(`[Native Printer] ✗ Receipt printing failed: ${e.message}`);
    throw e;
  }
}

/**
 * Gets a list of all available system printers using the native module.
 * @returns {Array<object>} A list of printer objects.
 */
export function getAllPrintersNative() {
  if (!isWindows || !thermalPrinter) {
    console.warn('[Native Printer] Cannot get printers, native module not available.');
    return [];
  }
  try {
    const printerNames = thermalPrinter.getAllPrinters();
    console.log(`[Native Printer] Found ${printerNames.length} printers via native module.`);
    // The native module returns an array of strings.
    // We map it to the object structure our app uses.
    return printerNames.map(name => ({
      name: name,
      displayName: name,
      isDefault: false, // This info is not available from the native module, we'll get it separately.
      status: 'ready', // Assume ready.
      platform: 'win32-native'
    }));
  } catch (e) {
    console.error(`[Native Printer] ✗ Failed to get printers: ${e.message}`);
    return [];
  }
}