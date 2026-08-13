import { exec } from 'child_process';
import { promisify } from 'util';
import { BrowserWindow } from 'electron';
import { getAllPrintersNative } from './native/windows-native-printer.js';
import { getSelectedPrinter, setSelectedPrinter } from '../core/store.js';

const execAsync = promisify(exec);

// Function to get system printers dynamically
export async function getSystemPrinters() {
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