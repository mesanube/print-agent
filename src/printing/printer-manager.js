import { exec } from 'child_process';
import { promisify } from 'util';
import { BrowserWindow } from 'electron';
import { getAllPrintersNative } from './native/windows-native-printer.js';
import { getSelectedPrinter, setSelectedPrinter } from '../core/store.js';

const execAsync = promisify(exec);

// Enumerating printers costs a native call plus a hidden BrowserWindow for
// the default-printer lookup, so it must not run on every print job (R2,
// KTD4). The list is cached with a short TTL and invalidated explicitly when
// the settings window opens or refreshes; a job whose printer is missing from
// the cached list retries once against a fresh list before failing.
const PRINTER_CACHE_TTL_MS = 30 * 1000;

/**
 * @param {() => Promise<Array<{name:string}>>} load Real enumeration.
 * @param {{ttlMs?: number, now?: () => number}} [options]
 */
export function createPrinterCache(load, { ttlMs = PRINTER_CACHE_TTL_MS, now = Date.now } = {}) {
  let cached = null;
  let loadedAt = 0;

  async function list() {
    if (cached && now() - loadedAt <= ttlMs) return cached;
    const printers = await load();
    // An empty list is what a failed enumeration returns; do not pin it.
    if (printers.length > 0) {
      cached = printers;
      loadedAt = now();
    } else {
      cached = null;
    }
    return printers;
  }

  function invalidate() {
    cached = null;
  }

  async function requirePrinter(printerName) {
    let printers = await list();
    let printer = printers.find((p) => p.name === printerName);
    if (!printer) {
      invalidate();
      printers = await list();
      printer = printers.find((p) => p.name === printerName);
    }
    if (!printer) {
      const availablePrinters = printers.map((p) => p.name).join(', ');
      throw new Error(`Printer "${printerName}" not found. Available printers: ${availablePrinters}`);
    }
    return printer;
  }

  return { list, invalidate, requirePrinter };
}

const printerCache = createPrinterCache(() => loadSystemPrinters());

/** Cached system printer list (see createPrinterCache). */
export function getSystemPrinters() {
  return printerCache.list();
}

/** Forces the next getSystemPrinters() to enumerate again. */
export function invalidatePrinterCache() {
  printerCache.invalidate();
}

/** Resolves the printer or throws "Printer ... not found" after one fresh retry. */
export function requireSystemPrinter(printerName) {
  return printerCache.requirePrinter(printerName);
}

async function loadSystemPrinters() {
  console.log('[PrinterDetection] Platform:', process.platform);
  try {
    // Windows: Use native module, enriched with Electron API for default printer info.
    if (process.platform === 'win32') {
      console.log('[PrinterDetection] Using native module for Windows');
      const nativePrinters = getAllPrintersNative();
      // The native module doesn't tell us the default printer, so we use the Electron API for that one piece of info.
      const electronPrinters = await getSystemPrintersElectron();
      const defaultPrinter = electronPrinters.find(p => p.isDefault);
      if (defaultPrinter) {
        console.log(`[PrinterDetection] Found system default printer: ${defaultPrinter.name}`);
        const printerToUpdate = nativePrinters.find(p => p.name === defaultPrinter.name);
        if (printerToUpdate) {
          printerToUpdate.isDefault = true;
        }
      }
      return nativePrinters;
    }

    // macOS/Linux: Use lpstat command
    const command = 'lpstat -p -d';
    console.log('[PrinterDetection] Running command:', command);

    const { stdout } = await execAsync(command);
    console.log('[PrinterDetection] Raw output:', stdout);

    const printers = parseLpstatOutput(stdout);
    console.log('[PrinterDetection] Found', printers.length, 'printers');
    return printers;

  } catch (error) {
    console.error('[PrinterDetection] Failed to get system printers:', error);
    return [];
  }
}

// Use Electron's native printer API (fallback for Windows, or to get default printer)
async function getSystemPrintersElectron() {
  let hiddenWindow = null;
  try {
    hiddenWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true
      }
    });
    await new Promise((resolve) => {
      hiddenWindow.webContents.once('did-finish-load', resolve);
      hiddenWindow.loadURL('about:blank');
    });
    if (typeof hiddenWindow.webContents.getPrintersAsync === 'function') {
      const electronPrinters = await hiddenWindow.webContents.getPrintersAsync();
      if (!electronPrinters) {
        throw new Error('getPrintersAsync returned undefined');
      }
      return electronPrinters.map(p => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: p.isDefault || false,
        status: p.status === 0 ? 'ready' : 'busy',
        platform: 'win32-electron'
      }));
    } else if (typeof hiddenWindow.webContents.getPrinters === 'function') {
      const electronPrinters = hiddenWindow.webContents.getPrinters();
      return electronPrinters.map(p => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: p.isDefault || false,
        status: p.status === 0 ? 'ready' : 'busy',
        platform: 'win32-electron'
      }));
    } else {
      throw new Error('Neither getPrintersAsync nor getPrinters is available');
    }
  } catch (error) {
    console.error('[Electron] Native printer detection failed:', error);
    return [];
  } finally {
    if (hiddenWindow && !hiddenWindow.isDestroyed()) {
      hiddenWindow.destroy();
    }
  }
}

function parseLpstatOutput(output) {
  const lines = output.split('\n');
  const printers = [];
  let defaultPrinter = null;
  const defaultLine = lines.find(line => line.includes('system default destination'));
  if (defaultLine) {
    defaultPrinter = defaultLine.split(':')[1]?.trim();
  }

  for (const line of lines) {
    if (line.startsWith('printer ')) {
      const match = line.match(/printer (\S+)/);
      if (match) {
        const name = match[1];
        let status = 'ready';
        let statusMessage = '';

        if (line.includes('disabled')) {
          status = 'disabled';
          statusMessage = 'Printer is disabled';
        } else if (line.includes('idle')) {
          status = 'ready';
          statusMessage = 'Ready to print';
        }

        printers.push({
          name: name,
          displayName: name,
          isDefault: name === defaultPrinter,
          status: status,
          statusMessage: statusMessage,
          platform: process.platform
        });
      }
    }
  }

  return printers;
}

// --- Auto-select printer on startup ---
export async function autoSelectPrinter() {
  // If a printer is already saved, respect that choice.
  if (getSelectedPrinter()) {
    console.log('Using previously selected printer:', getSelectedPrinter());
    return getSelectedPrinter();
  }

  // Otherwise, find the default and save it.
  try {
    const printers = await getSystemPrinters();
    const defaultPrinter = printers.find(p => p.isDefault);
    if (defaultPrinter) {
      setSelectedPrinter(defaultPrinter.name);
      console.log('Auto-selected and saved default printer:', defaultPrinter.name);
      return defaultPrinter.name;
    } else if (printers.length > 0) {
      setSelectedPrinter(printers[0].name);
      console.log('Auto-selected and saved first available printer:', printers[0].name);
      return printers[0].name;
    }
  } catch (error) {
    console.log('Could not auto-select printer:', error.message);
  }
  return null;
}