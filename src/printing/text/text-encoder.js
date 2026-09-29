import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

// Fixed code page CP858 (KTD10): Latin-1 accents, ñ/Ñ and the euro sign; `$`
// is plain ASCII and prints in any table. If a printer shows garbage on the
// text test page, this is the constant to revisit (per printer, later).
export const CODEPAGE = 'cp858';

// AFIP QR module size in dots, per paper. The AFIP URL encodes to a ~57-module
// QR, so 6 dots (~342 dots) fits 58mm and 8 dots (~456 dots) fits 80mm with a
// margin, keeping the QR as large as the paper allows: small QRs were the
// main scan-failure cause in the field
// (docs/solutions/ui-bugs/thermal-printer-paper-width-and-qr-readability.md).
const QR_SIZE = { '58mm': 6, '80mm': 8 };

/**
 * Encodes document blocks (documents.js) to ESC/POS bytes.
 * @param {Array<object>} blocks
 * @param {{cols:number, paper:string}} ctx - layoutContext() of the document
 * @param {{cutter:boolean, logo?: {data:Uint8Array|Buffer, width:number, height:number}|null}} options
 *   `cutter` comes from the per-printer setting (KTD2); the encoder never cuts
 *   on its own. `logo` is the already-rasterized logo (logo-cache.js), or null
 *   to print without one.
 * @returns {Uint8Array}
 */
export function encodeDocument(blocks, ctx, { cutter, logo = null } = {}) {
  const encoder = new ReceiptPrinterEncoder({
    language: 'esc-pos',
    columns: ctx.cols,
    imageMode: 'raster',
    newline: '\n',
  });
  encoder.initialize().codepage(CODEPAGE);

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
        .qrcode(block.data, { model: 2, size: QR_SIZE[ctx.paper] || QR_SIZE['80mm'], errorlevel: 'm' })
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
