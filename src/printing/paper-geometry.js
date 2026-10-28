import { getPaperWidth, getWidthAdjust } from '../core/store.js';
import { queryPrintableWidth } from './worker/print-worker-client.js';
import { isPrintTimeout } from './worker/time-budget.js';

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

// The GDI width query can block, so it runs in the printer's process (see
// worker/print-worker-client.js). getPaperGeometry stays synchronous by reading
// the last answer from this cache; callers await ensurePrintableWidth first.
// A timed out or null answer is not cached, so the next job asks again.
const CAPS_TTL_MS = 5 * 60 * 1000;
const capsCache = new Map(); // printerName -> { caps, at }

/**
 * Fills the printable width cache for a printer. Only a timeout propagates
 * (the job has no time left); any other failure falls back to the paper table.
 * @param {string|null} printerName
 */
export async function ensurePrintableWidth(printerName, { now = Date.now } = {}) {
  if (!printerName || process.platform !== 'win32') return;
  const hit = capsCache.get(printerName);
  if (hit && now() - hit.at < CAPS_TTL_MS) return;
  try {
    const caps = await queryPrintableWidth(printerName);
    if (caps) capsCache.set(printerName, { caps, at: now() });
  } catch (error) {
    if (isPrintTimeout(error)) throw error;
    console.warn(`[Paper] Printable width query failed for "${printerName}": ${error.message}`);
  }
}

/** Test hook: forgets every cached width. */
export function clearPrintableWidthCache() {
  capsCache.clear();
}

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
  const paper = getPaperWidth(printerName);
  const entry = PAPER_TABLE[paper];
  const base = entry || PAPER_TABLE['80mm'];
  if (!entry) {
    console.log(`[Paper] Unknown paper "${paper}", falling back to 80mm`);
  }

  let dots = base.dots;
  let origin = 'table';

  const caps = printerName ? capsCache.get(printerName)?.caps ?? null : null;
  if (caps && Number.isFinite(caps.horzRes) &&
      caps.horzRes >= base.dots * PLAUSIBILITY_MIN &&
      caps.horzRes <= base.dots * PLAUSIBILITY_MAX) {
    dots = roundDownTo8(caps.horzRes);
    origin = 'device';
  } else if (caps) {
    console.log(`[Paper] Device reported ${caps.horzRes}px for "${printerName}", outside plausible band for ${paper} (${Math.round(base.dots * PLAUSIBILITY_MIN)}-${Math.round(base.dots * PLAUSIBILITY_MAX)}), using table ${base.dots}`);
  }

  // Width adjust compensates for a driver that scales the bitmap to the
  // physical page instead of drawing it dot-for-dot — the residual case no
  // device query can detect (see U2/H4). Neutral at 100. Applied after the
  // device query so it always corrects the actually-chosen width, then
  // rounded down to a multiple of 8 again for the encoder's sake.
  const widthAdjust = getWidthAdjust(printerName);
  if (widthAdjust !== 100) {
    dots = roundDownTo8(dots * (widthAdjust / 100));
  }

  console.log(`[Paper] Effective width ${dots}px (${origin}, adjust ${widthAdjust}%) for ${paper} on "${printerName || 'default'}"`);
  return { dots, cssWidth: base.cssWidth, dpi: base.dpi, paper, zoomFactor: dots / base.cssWidth, origin };
}
