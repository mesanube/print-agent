import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import QRCode from 'qrcode';

export const CODEPAGE = 'cp858';

const MAX_QR_MODULE_SIZE = 6;
const QUIET_ZONE_MODULES = 4;

function qrModuleSize(data, columns) {
  const moduleCount = QRCode.create(data, { errorCorrectionLevel: 'M' }).modules.size;
  const maxSize = Math.floor((columns * 12) / (moduleCount + QUIET_ZONE_MODULES * 2));
  return Math.max(1, Math.min(MAX_QR_MODULE_SIZE, maxSize));
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
      encoder
        .align('center')
        .qrcode(block.data, { model: 2, size: qrModuleSize(block.data, ctx.cols), errorlevel: 'm' })
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
