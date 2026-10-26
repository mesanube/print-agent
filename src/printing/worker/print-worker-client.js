import path from 'path';
import { fileURLToPath } from 'url';
import { utilityProcess } from 'electron';
import { createPrintWorkerPool } from './print-worker-pool.js';
import { createBudget, currentBudget } from './time-budget.js';
import { logToFile } from '../../core/file-log.js';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'print-worker.js');

let pool = null;

function getPool() {
  if (!pool) {
    pool = createPrintWorkerPool({
      launch: (key) => utilityProcess.fork(WORKER_PATH, [], { serviceName: `mesanube-print-${key}` }),
      log: logToFile,
    });
  }
  return pool;
}

// Calls made inside a print request share its budget; any other caller (the
// settings window, startup) gets a budget of its own.
const budget = () => currentBudget() ?? createBudget();

const requireWindows = () => {
  if (process.platform !== 'win32') {
    throw new Error('Windows native printing is not available on this platform.');
  }
};

/** Writes ESC/POS bytes to the Windows queue (RAW datatype) in the printer's own process. */
export function writeRaw(printerName, bytes, docName) {
  requireWindows();
  return getPool().request(printerName, 'writeRaw', { printerName, bytes, docName }, budget());
}

/** Prints a PNG file through the GDI native module. */
export function printGdi({ printerName, imagePath, cutter }) {
  requireWindows();
  return getPool().request(printerName, 'printGdi', { printerName, imagePath, cutter }, budget());
}

/** Prints an image file with the native module's default processing (settings window tests). */
export function printImageFile({ printerName, imagePath, cutter }) {
  requireWindows();
  return getPool().request(printerName, 'printImageFile', { printerName, imagePath, cutter }, budget());
}

/** Printer names known to Windows, as printer objects. */
export function listPrinters() {
  requireWindows();
  const p = getPool();
  return p.request(p.LIST_KEY, 'listPrinters', {}, budget());
}

/** Printable width reported by GDI, or null when the query is unavailable. */
export function queryPrintableWidth(printerName) {
  requireWindows();
  return getPool().request(printerName, 'queryPrintableWidth', { printerName }, budget());
}

/** Terminates every print process. Called on quit so none survives the agent (KTD9). */
export function shutdownPrintWorkers() {
  pool?.shutdown();
  pool = null;
}
