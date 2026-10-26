import { encodeBitmap } from '../receipt-encoder.js';
import { writeRaw as writeRawInWorker } from '../worker/print-worker-client.js';

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
  const bytes = encodeBitmap({ image, geometry, cutter });
  await writeRaw(printerName, bytes, 'Mesanube ESC/POS');
}

/**
 * Writes already-encoded ESC/POS bytes to a Windows print queue with the RAW
 * datatype, in the printer's own process (see worker/print-worker.js). Shared
 * by the image path above and the text path (KTD7), which encodes its own
 * bytes.
 * @param {string} printerName
 * @param {Uint8Array|Buffer} bytes
 * @param {string} docName - job name shown in the Windows queue
 */
export async function writeRaw(printerName, bytes, docName = 'Mesanube ESC/POS') {
  if (!isWindows) {
    throw new Error('ESC/POS RAW printing is only available on Windows.');
  }
  await writeRawInWorker(printerName, bytes, docName);
}
