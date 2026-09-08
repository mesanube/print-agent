import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

// Atkinson dithering, not the GDI path's fixed threshold:180 (windows-native-printer.js).
// ESC/POS raster prints 1-bit-per-pixel with no driver-side gamma correction;
// Atkinson diffuses error across neighboring pixels and preserves midtone
// detail (logo, QR modules) that a hard threshold crushes into solid
// black/white blocks at this resolution. Do not "simplify" this to threshold.
const DITHER = 'atkinson';

// @point-of-sale/receipt-printer-encoder@3.0.3 builds its output buffer with
// `buffer.push(...bytes)` (spread), which blows V8's call-stack argument
// limit once a single .image() call's raster payload gets large enough —
// measured: a 576-wide, ~1100-tall receipt (78840 payload bytes) encodes
// fine, a 576x2000 one (144000 bytes) throws "Maximum call stack size
// exceeded" every time. A receipt with enough items easily crosses that.
// Standard ESC/POS practice for tall images is to emit one GS v 0 raster
// command per horizontal strip instead of one for the whole image — the
// print head just keeps advancing, so multiple stacked strips are visually
// identical to a single tall image. STRIP_ROWS is chosen well under the
// failure threshold with headroom for wider paper.
const STRIP_ROWS = 256; // multiple of 8; ~18KB payload per strip at 576px wide

/**
 * Converts a captured bitmap to ESC/POS raster bytes for a thermal printer.
 * @param {{image: Electron.NativeImage, geometry: {dots:number}, cutter: boolean}} params
 * @returns {Uint8Array}
 */
export function encodeBitmap({ image, geometry, cutter }) {
  const { width, height } = image.getSize();
  // Windows delivers BGRA (KTD3); verified with a byte dump before this unit
  // was closed — if the printed ticket ever comes out with red/blue swapped,
  // the platform's channel order changed and this swap needs revisiting.
  const bgra = image.toBitmap();

  const rgba = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];     // R <- B
    rgba[i + 1] = bgra[i + 1]; // G
    rgba[i + 2] = bgra[i];     // B <- R
    rgba[i + 3] = bgra[i + 3]; // A
  }

  // The encoder requires height to be a multiple of 8 (KTD6); width already
  // is, since paper-geometry.js rounds the effective dots down to 8. Pad any
  // remainder with opaque white so the extra rows print blank, not black.
  const paddedHeight = Math.ceil(height / 8) * 8;
  let pixels = rgba;
  if (paddedHeight !== height) {
    pixels = Buffer.alloc(width * paddedHeight * 4, 0xff);
    rgba.copy(pixels, 0);
  }

  const encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', imageMode: 'raster' });
  encoder.initialize();

  const rowBytes = width * 4;
  for (let y = 0; y < paddedHeight; y += STRIP_ROWS) {
    const stripHeight = Math.min(STRIP_ROWS, paddedHeight - y);
    const strip = pixels.subarray(y * rowBytes, (y + stripHeight) * rowBytes);
    encoder.image({ data: strip, width, height: stripHeight }, geometry.dots, stripHeight, DITHER);
  }

  if (cutter) {
    encoder.cut();
  }
  return encoder.encode();
}
