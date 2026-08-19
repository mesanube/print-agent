import { getPaperWidth } from '../core/store.js';
import { getPrintableWidthDots } from './device-caps.js';

// Single source of truth for print geometry: the printable width in dots at the
// printer, the CSS design width, and the zoom factor that maps one onto the
// other. Every other module derives its numbers from here (see plan
// 2026-08-19-001: R2, KTD1). 203 dpi is the resolution of essentially the whole
// thermal range; the table is keyed by paper so 300 dpi can be added without
// reshaping anything.
const PAPER_TABLE = {
  '80mm': { dots: 576, cssWidth: 309, dpi: 203 },
  '58mm': { dots: 384, cssWidth: 250, dpi: 203 },
};

// Acceptable deviation of a driver-reported printable width from the paper
// table. Keeps the query honest against absurd driver sizes (some thermal
// drivers report letter-size pages) while tolerating real 203dpi measurements.
const PLAUSIBILITY_MIN = 0.8;
const PLAUSIBILITY_MAX = 1.25;
const DOTS_MULTIPLE = 8;

const roundDownTo8 = (n) => Math.floor(n / DOTS_MULTIPLE) * DOTS_MULTIPLE;

/**
 * Resolves the effective print geometry for the configured paper on a printer.
 * Uses the device-reported printable width when it is plausible, falling back
 * to the paper table otherwise. The width is rounded down to a multiple of 8 so
 * the ESC/POS raster encoder never sees a non-multiple width.
 * @param {string|null} printerName
 * @returns {{dots:number, cssWidth:number, dpi:number, paper:string, zoomFactor:number, origin:string}}
 */
export function getPaperGeometry(printerName = null) {
  const paper = getPaperWidth();
  const entry = PAPER_TABLE[paper];
  const base = entry || PAPER_TABLE['80mm'];
  if (!entry) {
    console.log(`[Paper] Unknown paper "${paper}", falling back to 80mm`);
  }

  let dots = base.dots;
  let origin = 'table';

  const caps = printerName ? getPrintableWidthDots(printerName) : null;
  if (caps && Number.isFinite(caps.horzRes) &&
      caps.horzRes >= base.dots * PLAUSIBILITY_MIN &&
      caps.horzRes <= base.dots * PLAUSIBILITY_MAX) {
    dots = roundDownTo8(caps.horzRes);
    origin = 'device';
  } else if (caps) {
    console.log(`[Paper] Device reported ${caps.horzRes}px for "${printerName}", outside plausible band for ${paper} (${Math.round(base.dots * PLAUSIBILITY_MIN)}-${Math.round(base.dots * PLAUSIBILITY_MAX)}), using table ${base.dots}`);
  }

  console.log(`[Paper] Effective width ${dots}px (${origin}) for ${paper} on "${printerName || 'default'}"`);
  return { dots, cssWidth: base.cssWidth, dpi: base.dpi, paper, zoomFactor: dots / base.cssWidth, origin };
}
