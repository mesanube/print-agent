import { openPrinter, startDocPrinter, startPagePrinter, writePrinter, endPagePrinter, endDocPrinter, closePrinter } from '../transports/winspool.js';

/**
 * Writes already-encoded ESC/POS bytes to a Windows print queue with the RAW
 * datatype. Blocking: it only runs inside a print worker process (see
 * print-worker.js), never in the main process.
 * @param {string} printerName
 * @param {Uint8Array|Buffer} bytes
 * @param {string} docName Job name shown in the Windows queue.
 * @param {(jobId: number) => void} [onJobStarted] Called as soon as the spooler
 *   assigns the job id, before the write that may block.
 */
export function writeRawSync(printerName, bytes, docName, onJobStarted) {
  const buffer = Buffer.from(bytes);

  const hPrinter = openPrinter(printerName);
  try {
    const jobId = startDocPrinter(hPrinter, docName);
    console.log(`[RAW Transport] Started job ${jobId} on "${printerName}", ${buffer.length} bytes`);
    onJobStarted?.(jobId);
    try {
      startPagePrinter(hPrinter);
      try {
        writePrinter(hPrinter, buffer);
      } finally {
        endPagePrinter(hPrinter);
      }
    } finally {
      endDocPrinter(hPrinter);
    }
  } finally {
    closePrinter(hPrinter);
  }
}
