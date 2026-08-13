import QRCode from 'qrcode';

/**
 * Generates QR code as SVG string for direct HTML embedding
 * @param {string} data - The data to encode in the QR code
 * @param {object} options - QR code generation options
 * @returns {Promise<string>} - SVG string of the QR code
 */
export async function generateQRCodeSVG(data, options = {}) {
  try {
    const defaultOptions = {
      width: 120,
      margin: 4,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      ...options
    };
    const svgString = await QRCode.toString(data, {
      type: 'svg',
      ...defaultOptions
    });
    return svgString;
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    throw new Error(`QR code generation failed: ${error.message}`);
  }
}

/**
 * Generates complete HTML for QR code display
 * @param {string} data - The data to encode
 * @param {object} options - QR code options
 * @returns {Promise<string>} - Complete HTML string with QR code
 */
export async function generateQRCodeHTML(data, options = {}) {
  try {
    const svgString = await generateQRCodeSVG(data, options);
    const sizePercent = options.sizePercent || 75;

    return `
      <div style="text-align: center; margin: 10px 0;">
        <div style="display: inline-block; width: ${sizePercent}% !important; max-width: ${sizePercent}% !important;">
          ${svgString}
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Failed to generate QR code HTML:', error);
  }
}

/**
 * Generates an AFIP QR code as a module-pixel-aligned PNG and returns the
 * <img> HTML to drop into a template.
 *
 * Why PNG (and not SVG): the receipt HTML is rasterized into a fixed-width
 * (640 device-px) PNG by Electron's offscreen capturePage. An SVG embedded
 * in a percentage-sized container is rasterized fresh at the small target
 * size by Chromium, which can produce fuzzy module edges and unreliable
 * scans. Pre-rendering the QR as a PNG whose pixel grid is an integer
 * multiple of the QR's module count means each module lands on whole
 * pixels — Chromium's downsample (or pixelated nearest-neighbour) into
 * the capture buffer preserves crisp edges.
 *
 * Geometry & the "cap" — why one number works for both paper widths:
 *
 * The capture buffer is 640 device-px wide regardless of paper. Different
 * thermal printers map that buffer to physical paper differently:
 *   - 58mm printers (~384-dot printable area) scale the 640 buffer DOWN to
 *     fit the narrower paper. Anything in the buffer ends up on paper.
 *   - 80mm printers (~568-dot printable area) render closer to 1:1 against
 *     the buffer. Anything wider than ~568 device-px in the buffer FALLS
 *     OFF the right edge after centering.
 *
 * So a single device-px cap that's safely under 568 protects 80mm from
 * clipping, and on 58mm the printer's downscale stretches that same source
 * back up to fill the narrower printable area. We don't need to know the
 * declared paper size — the printer's scaling behaviour does the right
 * thing as long as we never exceed the 80mm-safe cap.
 *
 * Default cap: 60% × 640 = 384 device-px. That leaves ~92 dots of slack
 * on each side of an 80mm printer's printable area after centering, and
 * fills 58mm naturally via the printer's downscale.
 */
export async function generateAfipQRCodePngHTML(data, options = {}) {
  const {
    sizePercent = 80,
    captureWidthDevicePx = 640,
    maxDevicePx = Math.round(0.8 * 640), // 80mm-safe ceiling, see geometry note above
  } = options;

  const qr = QRCode.create(data, { errorCorrectionLevel: 'H' });
  const margin = 4;
  const totalModules = qr.modules.size + margin * 2;

  const fromPercent = Math.round((sizePercent / 100) * captureWidthDevicePx);
  const targetDevicePx = Math.min(fromPercent, maxDevicePx);
  const pxPerModule = Math.max(1, Math.floor(targetDevicePx / totalModules));
  // Force even so the CSS width is an integer (zoomFactor 2.0 → /2).
  const evenPxPerModule = pxPerModule % 2 === 0 ? pxPerModule : pxPerModule - 1 || 1;
  const sourceWidthPx = totalModules * evenPxPerModule;
  const cssWidthPx = Math.round(sourceWidthPx / 2);

  const dataUrl = await QRCode.toDataURL(data, {
    type: 'image/png',
    width: sourceWidthPx,
    margin,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  return `
    <div style="text-align: center; margin: 10px 0;">
      <img src="${dataUrl}"
           alt="QR AFIP"
           width="${cssWidthPx}"
           height="${cssWidthPx}"
           style="display: inline-block; image-rendering: pixelated;">
    </div>
  `;
}

/**
 * Generates QR code data from order and restaurant information
 * @param {object} orderData - The order data
 * @param {object} restaurantData - The restaurant data
 * @returns {string} - Formatted data for QR code
 */
export function generateQRCodeData(orderData, restaurantData) {
  const qrData = {
    type: 'receipt',
    restaurant: {
      name: restaurantData.name,
      address: restaurantData.address
    },
    order: {
      id: orderData.id || `TABLE-${orderData.table}-${Date.now()}`,
      table: orderData.table,
      waiter: orderData.waiter?.name,
      total: orderData.orderTotal,
      date: new Date().toISOString(),
      items: orderData.items?.map(item => ({
        name: item.menuItem?.name || item.name,
        quantity: item.quantity,
        price: item.menuItem?.price || item.price
      }))
    }
  };
  return JSON.stringify(qrData, null, 2);
}

/**
 * Generates AFIP-compliant QR code data URL for invoices (RG 4892)
 * @param {object} invoiceData - Invoice data with AFIP fields
 * @returns {string} - QR data URL for AFIP validation
 */
export function generateAfipQRCodeData(invoiceData) {
  console.log(invoiceData.docEmisor)
  const qrData = {
    ver: 1,
    fecha: invoiceData.fechaEmision,
    cuit: invoiceData.docEmisor || invoiceData.emisor?.cuit || invoiceData.cuit,
    ptoVta: invoiceData.puntoVenta,
    tipoCmp: invoiceData.tipoComprobante,
    nroCmp: invoiceData.numeroComprobante,
    importe: invoiceData.total,
    moneda: 'ARS', // Always use ARS
    ctz: 1,
    tipoDocRec: invoiceData.tipoDocReceptor || invoiceData.receptor?.tipoDoc,
    nroDocRec: invoiceData.docReceptor || invoiceData.receptor?.nroDoc,
    tipoCodAut: 'E',
    codAut: parseInt(invoiceData.cae),
  };

  const qrPayload = Buffer.from(JSON.stringify(qrData)).toString('base64url');
  return `https://www.afip.gob.ar/fe/qr/?p=${qrPayload}`;
}