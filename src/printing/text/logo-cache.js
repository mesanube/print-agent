// Location logo for the text path (KTD12): one small raster image printed with
// the ESC/POS image command, not the whole ticket as an image. It is
// downloaded, scaled to fit the paper width and converted to RGBA once per
// (URL, width), then kept in memory, so the logo does not bring back the
// latency of the image path. A logo that cannot be fetched or decoded yields
// null: the ticket prints whole without it, and the next print tries again.

const DOTS_MULTIPLE = 8;

// Electron's nativeImage decodes PNG/JPEG without extra dependencies. It is
// imported lazily so this module stays testable outside Electron.
async function decodeWithNativeImage(buffer, maxWidth) {
  const { nativeImage } = await import('electron');
  let image = nativeImage.createFromBuffer(Buffer.from(buffer));
  if (image.isEmpty()) throw new Error('logo is not a decodable image');
  const { width } = image.getSize();
  if (width > maxWidth) image = image.resize({ width: maxWidth, quality: 'best' });
  const size = image.getSize();
  // toBitmap() is BGRA on Windows (see receipt-encoder.js); the encoder wants RGBA.
  const bgra = image.toBitmap();
  const rgba = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = bgra[i + 3];
  }
  return { data: rgba, width: size.width, height: size.height };
}

// The ESC/POS raster command needs width and height in multiples of 8. Pads
// with opaque white so the extra pixels print blank.
function padTo8({ data, width, height }) {
  const w = Math.max(DOTS_MULTIPLE, Math.floor(width / DOTS_MULTIPLE) * DOTS_MULTIPLE);
  const h = Math.ceil(height / DOTS_MULTIPLE) * DOTS_MULTIPLE;
  if (w === width && h === height) return { data, width, height };
  const out = new Uint8Array(w * h * 4).fill(0xff);
  const copyWidth = Math.min(w, width);
  for (let y = 0; y < height; y++) {
    out.set(data.subarray(y * width * 4, y * width * 4 + copyWidth * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

/**
 * @param {{fetchImpl?: Function, decode?: Function, log?: Function}} [deps]
 */
export function createLogoCache({ fetchImpl = (...args) => fetch(...args), decode = decodeWithNativeImage, log = console.warn } = {}) {
  const cache = new Map();

  /**
   * @param {string} url - receiptSettings.logoUrl
   * @param {number} maxWidth - printable width in dots
   * @returns {Promise<{data:Uint8Array, width:number, height:number}|null>}
   */
  async function get(url, maxWidth) {
    if (!url) return null;
    const key = `${url}|${maxWidth}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const raster = padTo8(await decode(new Uint8Array(buffer), maxWidth));
      cache.set(key, raster);
      return raster;
    } catch (error) {
      log(`[Logo] Could not load receipt logo ${url}: ${error.message}. Printing without it.`);
      return null;
    }
  }

  return { get };
}

export const logoCache = createLogoCache();
