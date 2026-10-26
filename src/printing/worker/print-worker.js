// Entry point of a print worker process (Electron utilityProcess). Every call
// here can block inside the driver or the spooler; that is why it runs apart
// from the main process, which can kill this one if it stops answering.
//
// Protocol: the parent sends { id, op, payload } and gets back
// { type: 'result', id, ok, result | error }. While a RAW write runs it also
// sends { type: 'job', id, jobId } as soon as the spooler assigns the job id.
//
// PRINT_AGENT_SIMULATE_HANG=<printer name> (development only) makes writes to
// that printer block forever, to check the timeout path on a real machine.
import { writeRawSync } from './raw-write.js';
import { cancelJob } from '../transports/winspool.js';
import { printReceiptNative, getAllPrintersNative } from '../native/windows-native-printer.js';
import { getPrintableWidthDots } from '../device-caps.js';

const parent = process.parentPort;

const SIMULATE_HANG = process.env.PRINT_AGENT_SIMULATE_HANG;

function simulateHang(printerName) {
  if (!SIMULATE_HANG || SIMULATE_HANG !== printerName) return;
  // Atomics.wait on a private buffer blocks this thread without burning CPU.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

const handlers = {
  writeRaw({ printerName, bytes, docName }, id) {
    writeRawSync(printerName, bytes, docName, (jobId) => {
      parent.postMessage({ type: 'job', id, jobId });
      // Blocks with the empty job open in the queue, like a stuck WritePrinter.
      simulateHang(printerName);
    });
    return true;
  },
  printGdi({ printerName, imagePath, cutter }) {
    simulateHang(printerName);
    printReceiptNative({ printerName, imageInput: imagePath, threshold: 180, edgeBoost: 20, dpi: 203, cutter });
    return true;
  },
  printImageFile({ printerName, imagePath, cutter }) {
    simulateHang(printerName);
    printReceiptNative({ printerName, imageInput: imagePath, cutter });
    return true;
  },
  listPrinters() {
    return getAllPrintersNative();
  },
  queryPrintableWidth({ printerName }) {
    return getPrintableWidthDots(printerName);
  },
  cancelJob({ printerName, jobId }) {
    cancelJob(printerName, jobId);
    return true;
  },
};

parent.on('message', (event) => {
  const { id, op, payload } = event.data;
  try {
    const handler = handlers[op];
    if (!handler) throw new Error(`Unknown print worker operation: ${op}`);
    parent.postMessage({ type: 'result', id, ok: true, result: handler(payload || {}, id) ?? null });
  } catch (error) {
    parent.postMessage({ type: 'result', id, ok: false, error: error.message || String(error) });
  }
});
