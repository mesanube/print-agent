import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { randomUUID } from 'crypto';
import { printReceiptNative } from '../native/windows-native-printer.js';

/**
 * Prints via the existing GDI native module (cairo_printer.node), unchanged
 * (KD3): writes the captured bitmap to a temp PNG, hands the path and the
 * same parameters it always received to the native module, and cleans up
 * regardless of outcome. `geometry` is accepted for interface parity with
 * raw-transport.js (KTD4) but unused here — GDI already receives an image
 * sized to the target width.
 * @param {{printerName:string, image:Electron.NativeImage, geometry:object, cutter:boolean}} params
 */
export async function printBitmap({ printerName, image, cutter }) {
  const tempPath = path.join(os.tmpdir(), `receipt-${randomUUID()}.png`);
  const imageBuffer = image.toPNG();

  try {
    await fs.writeFile(tempPath, imageBuffer);

    console.log(`[GDI Transport] Rendering image ${tempPath} (${imageBuffer.length} bytes)`);
    printReceiptNative({
      printerName,
      imageInput: tempPath,
      threshold: 180,
      edgeBoost: 20,
      dpi: 203,
      cutter,
    });
  } finally {
    await fs.unlink(tempPath).catch(err => {
      console.warn(`[GDI Transport] Could not delete temp file: ${tempPath}`, err.message);
    });
  }
}
