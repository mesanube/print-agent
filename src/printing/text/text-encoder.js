import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import QRCode from 'qrcode';

export const CODEPAGE = 'cp858';

// Dots per QR module, per paper. Capped by what fits the printable width.
const QR_MODULE_DOTS = { '58mm': 4, '80mm': 5 };
const QUIET_ZONE_MODULES = 4;

// The QR goes out as a raster image instead of the native GS ( k command:
// cheap 58mm firmwares print a short native QR but drop one whose data needs
// the high length byte (over 255 bytes, which every AFIP URL does).
function qrImage(data, ctx) {
  const { modules } = QRCode.create(data, { errorCorrectionLevel: 'M' });
  const total = modules.size + QUIET_ZONE_MODULES * 2;
  const fit = Math.floor((ctx.cols * 12) / total);
  const dots = Math.max(1, Math.min(QR_MODULE_DOTS[ctx.paper] || QR_MODULE_DOTS['80mm'], fit));
  const size = Math.ceil((total * dots) / 8) * 8;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      const top = (row + QUIET_ZONE_MODULES) * dots;
      const left = (col + QUIET_ZONE_MODULES) * dots;
      for (let y = top; y < top + dots; y++) {
        const start = (y * size + left) * 4;
        for (let i = start; i < start + dots * 4; i += 4) {
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
        }
      }
    }
  }
  return { data: pixels, width: size, height: size };
}

/**
 * Encodes document blocks (documents.js) to ESC/POS bytes.
 * @param {Array<object>} blocks
 * @param {{cols:number, paper:string}} ctx - layoutContext() of the document
 * @param {{cutter:boolean, logo?: {data:Uint8Array|Buffer, width:number, height:number}|null, codepage?:string}} options
 *   `cutter` comes from the per-printer setting (KTD2); the encoder never cuts
 *   on its own. `logo` is the already-rasterized logo (logo-cache.js), or null
 *   to print without one.
 * @returns {Uint8Array}
 */
export function encodeDocument(blocks, ctx, { cutter, logo = null, codepage = CODEPAGE } = {}) {
  const encoder = new ReceiptPrinterEncoder({
    language: 'esc-pos',
    columns: ctx.cols,
    imageMode: 'raster',
    newline: '\n',
  });
  encoder.initialize().codepage(codepage);

  for (const block of blocks) {
    if (block.type === 'text') {
      encoder
        .bold(!!block.bold)
        .invert(!!block.invert)
        .width(block.width || 1)
        .height(block.height || 1)
        .text(block.text)
        .newline()
        .bold(false)
        .invert(false)
        .width(1)
        .height(1);
    } else if (block.type === 'qr') {
      const image = qrImage(block.data, ctx);
      encoder
        .align('center')
        .image(image, image.width, image.height, 'threshold')
        .align('left')
        .newline();
    } else if (block.type === 'logo') {
      if (logo) {
        encoder.align('center').image(logo, logo.width, logo.height, 'atkinson').align('left').newline();
      }
    } else if (block.type === 'feed') {
      for (let i = 0; i < (block.lines || 1); i++) encoder.newline();
    }
  }

  if (cutter) encoder.cut();
  return encoder.encode();
}
