import { encodeBitmap } from '../receipt-encoder.js';
import { openPrinter, startDocPrinter, startPagePrinter, writePrinter, endPagePrinter, endDocPrinter, closePrinter } from './winspool.js';

const isWindows = process.platform === 'win32';

/**
 * Prints via ESC/POS RAW: encodes the bitmap to raster commands and writes
 * them straight to the Windows print queue's "RAW" datatype, bypassing the
 * driver entirely. Works the same for a USB or a network printer as long as
 * it is installed as a Windows queue (R9) — the spooler hands RAW bytes to
 * the port monitor untransformed either way.
 *
 * No retry, no fallback to GDI (R8, KD4/KD5): a printer explicitly configured
 * for RAW that fails must report the failure visibly, not reroute silently
 * to another printer or transport.
 * @param {{printerName:string, image:Electron.NativeImage, geometry:object, cutter:boolean}} params
 */
export async function printBitmap({ printerName, image, geometry, cutter }) {
  if (!isWindows) {
    throw new Error('ESC/POS RAW printing is only available on Windows.');
  }

  const bytes = encodeBitmap({ image, geometry, cutter });
  const buffer = Buffer.from(bytes);

  const hPrinter = openPrinter(printerName);
  try {
    const jobId = startDocPrinter(hPrinter, 'Mesanube ESC/POS');
    console.log(`[RAW Transport] Started job ${jobId} on "${printerName}", ${buffer.length} bytes`);
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
