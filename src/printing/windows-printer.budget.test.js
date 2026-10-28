import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The image path serializes jobs on one shared offscreen window. These tests
// cover what the time budget (KTD2) guarantees there: a capture that never
// answers cannot hold the queue, and a job that waited too long never prints.
const windows = [];
let hangFirstCapture = true;
const ensurePrintableWidth = vi.fn(async () => {});
const BrowserWindow = vi.fn(() => {
  const win = {
    destroyed: false,
    isDestroyed: () => win.destroyed,
    destroy: () => { win.destroyed = true; },
    // The first window hangs forever; later ones fail at once so a test can
    // tell that a job reached the capture step.
    loadURL: hangFirstCapture && windows.length === 0 ? () => new Promise(() => {}) : () => Promise.reject(new Error('reached-capture')),
  };
  windows.push(win);
  return win;
});
vi.mock('electron', () => ({ BrowserWindow }));
vi.mock('../core/store.js', () => ({
  getSelectedPrinter: vi.fn(() => 'Fiscal'),
  getPrinterCutter: vi.fn(() => true),
  getPrinterTransport: vi.fn(() => 'gdi'),
  getPrintMode: vi.fn(() => 'compat'),
  getPrinterCodepage: vi.fn(() => 'cp858'),
  getPrinterCharSpacing: vi.fn(() => 0),
  getPaperWidth: vi.fn(() => '80mm'),
}));
vi.mock('./template-manager.js', () => ({
  generateHtmlFromTemplate: vi.fn(async () => '<html></html>'),
  renderCashCloseHtml: vi.fn(async () => '<html></html>'),
  renderDayZHtml: vi.fn(async () => '<html></html>'),
}));
vi.mock('./printer-manager.js', () => ({ requireSystemPrinter: vi.fn(async (name) => ({ name })) }));
vi.mock('./paper-geometry.js', () => ({
  getPaperGeometry: vi.fn(() => ({ dots: 576, cssWidth: 309, zoomFactor: 1.86, paper: '80mm' })),
  ensurePrintableWidth: (...args) => ensurePrintableWidth(...args),
}));
vi.mock('./calibration-page.js', () => ({ renderCalibrationHtml: vi.fn(() => '') }));
const printBitmapGdi = vi.fn();
vi.mock('./transports/gdi-transport.js', () => ({ printBitmap: printBitmapGdi }));
vi.mock('./transports/raw-transport.js', () => ({ printBitmap: vi.fn(), writeRaw: vi.fn() }));

const { printReceipt } = await import('./windows-printer.js');
const { runWithBudget } = await import('./worker/time-budget.js');

const receipt = { order: { items: [], orderTotal: 0 }, restaurant: { name: 'Bar' } };
const print = (options) => runWithBudget(() => printReceipt(receipt, 'Fiscal'), options);

beforeEach(() => {
  vi.useFakeTimers();
  windows.length = 0;
  hangFirstCapture = true;
  vi.clearAllMocks();
  ensurePrintableWidth.mockImplementation(async () => {});
});
afterEach(() => vi.useRealTimers());

describe('print budget on the image path', () => {
  it('Covers AE1: a capture that never ends times out at 9 s and the next queued job runs', async () => {
    const first = print().catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const second = print().catch((e) => e);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await first).code).toBe('PRINT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(0);
    expect((await second).message).toBe('reached-capture');
    expect(windows[0].destroyed).toBe(true);
    expect(windows).toHaveLength(2);
  });

  it('a job whose time ran out while queued is rejected without printing or opening a window', async () => {
    const first = print().catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const queued = print({ totalMs: 2000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await queued).code).toBe('PRINT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(6000);
    expect((await first).code).toBe('PRINT_TIMEOUT');
    expect(windows).toHaveLength(1);
    expect(printBitmapGdi).not.toHaveBeenCalled();
  });
});

describe('a stuck printer does not hold up other printers', () => {
  it('a job whose printer never answers its width query does not delay a job for another printer', async () => {
    hangFirstCapture = false;
    ensurePrintableWidth.mockImplementation((name) => (name === 'Stuck' ? new Promise(() => {}) : Promise.resolve()));
    const stuck = runWithBudget(() => printReceipt(receipt, 'Stuck')).catch((e) => e);
    const healthy = runWithBudget(() => printReceipt(receipt, 'Fiscal')).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect((await healthy).message).toBe('reached-capture');
    await vi.advanceTimersByTimeAsync(9000);
    expect(stuck).toBeInstanceOf(Promise);
  });
});
