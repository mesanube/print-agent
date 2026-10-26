import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../core/store.js', () => ({ getPaperWidth: vi.fn(() => '80mm'), getWidthAdjust: vi.fn(() => 100) }));
const queryPrintableWidth = vi.fn();
vi.mock('./worker/print-worker-client.js', () => ({ queryPrintableWidth }));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { value: 'win32' });
const { getPaperGeometry, ensurePrintableWidth, clearPrintableWidthCache } = await import('./paper-geometry.js');
afterAll(() => Object.defineProperty(process, 'platform', originalPlatform));

const timeout = () => Object.assign(new Error('stuck'), { code: 'PRINT_TIMEOUT' });

beforeEach(() => {
  clearPrintableWidthCache();
  vi.clearAllMocks();
});

describe('printable width cache', () => {
  it('uses the table until the width is known, then the plausible device width', async () => {
    expect(getPaperGeometry('Caja').origin).toBe('table');
    queryPrintableWidth.mockResolvedValue({ horzRes: 560 });
    await ensurePrintableWidth('Caja');
    expect(getPaperGeometry('Caja')).toMatchObject({ dots: 560, origin: 'device' });
  });

  it('asks the printer process once while the answer is fresh', async () => {
    queryPrintableWidth.mockResolvedValue({ horzRes: 576 });
    await ensurePrintableWidth('Caja');
    await ensurePrintableWidth('Caja');
    expect(queryPrintableWidth).toHaveBeenCalledTimes(1);
  });

  it('does not cache a null answer, so the next job asks again', async () => {
    queryPrintableWidth.mockResolvedValue(null);
    await ensurePrintableWidth('Caja');
    await ensurePrintableWidth('Caja');
    expect(queryPrintableWidth).toHaveBeenCalledTimes(2);
    expect(getPaperGeometry('Caja').origin).toBe('table');
  });

  it('propagates a timeout without caching it, but swallows other failures', async () => {
    queryPrintableWidth.mockRejectedValueOnce(timeout());
    await expect(ensurePrintableWidth('Caja')).rejects.toMatchObject({ code: 'PRINT_TIMEOUT' });
    queryPrintableWidth.mockRejectedValueOnce(new Error('CreateDCW failed'));
    await expect(ensurePrintableWidth('Caja')).resolves.toBeUndefined();
    expect(getPaperGeometry('Caja').origin).toBe('table');
  });
});
