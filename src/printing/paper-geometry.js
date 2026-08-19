import { getPaperWidth } from '../core/store.js';

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

// Returns { dots, cssWidth, dpi, zoomFactor } for the configured paper.
// Unknown paper falls back to 80mm with a log, never crashes.
export function getPaperGeometry() {
  const paper = getPaperWidth();
  const entry = PAPER_TABLE[paper];
  if (!entry) {
    console.log(`[Paper] Unknown paper "${paper}", falling back to 80mm`);
    return { ...PAPER_TABLE['80mm'], paper: '80mm', zoomFactor: PAPER_TABLE['80mm'].dots / PAPER_TABLE['80mm'].cssWidth };
  }
  return { ...entry, paper, zoomFactor: entry.dots / entry.cssWidth };
}
