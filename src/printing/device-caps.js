import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// GDI GetDeviceCaps indexes
const HORZRES = 8; // printable width in device units (dots)
const PHYSICALWIDTH = 110; // full physical page width
const PHYSICALOFFSETX = 112; // left non-printable margin
const LOGPIXELSX = 88; // horizontal resolution (dpi)

let isWindows = process.platform === 'win32';
let deviceCaps = null;

if (isWindows) {
  try {
    const koffi = require('koffi');
    const gdi32 = koffi.load('gdi32.dll');
    deviceCaps = {
      CreateDCW: gdi32.func('void *__stdcall CreateDCW(const char16_t *driver, const char16_t *device, const char16_t *port, void *dm)'),
      GetDeviceCaps: gdi32.func('int __stdcall GetDeviceCaps(void *hdc, int index)'),
      DeleteDC: gdi32.func('int __stdcall DeleteDC(void *hdc)'),
    };
  } catch (error) {
    console.error(`[DeviceCaps] Failed to load gdi32 via koffi: ${error.message}`);
    deviceCaps = null;
  }
}

/**
 * Reads the printer's printable width in points directly from GDI. Read-only:
 * opens a device context, queries capabilities, and closes it. Returns null
 * when the query is unavailable (non-Windows) or fails, so callers fall back
 * to the paper table instead of breaking.
 * @param {string} printerName
 * @returns {{horzRes:number, physicalWidth:number, offsetX:number, logPixelsX:number}|null}
 */
export function getPrintableWidthDots(printerName) {
  if (!isWindows || !deviceCaps) {
    return null;
  }
  let hdc = null;
  try {
    hdc = deviceCaps.CreateDCW(null, printerName, null, null);
    if (!hdc) {
      console.warn(`[DeviceCaps] CreateDCW failed for "${printerName}"`);
      return null;
    }
    return {
      horzRes: deviceCaps.GetDeviceCaps(hdc, HORZRES),
      physicalWidth: deviceCaps.GetDeviceCaps(hdc, PHYSICALWIDTH),
      offsetX: deviceCaps.GetDeviceCaps(hdc, PHYSICALOFFSETX),
      logPixelsX: deviceCaps.GetDeviceCaps(hdc, LOGPIXELSX),
    };
  } catch (error) {
    console.warn(`[DeviceCaps] GetDeviceCaps failed for "${printerName}": ${error.message}`);
    return null;
  } finally {
    if (hdc) {
      try { deviceCaps.DeleteDC(hdc); } catch { /* ignore */ }
    }
  }
}
