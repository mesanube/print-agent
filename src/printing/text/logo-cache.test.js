import { describe, it, expect, vi } from 'vitest';
import { createLogoCache } from './logo-cache.js';

const png = new Uint8Array([1, 2, 3]);
const okFetch = () => vi.fn(async () => ({ ok: true, arrayBuffer: async () => png.buffer }));
// A fake decoder: returns an RGBA raster of the requested width, 10 rows tall.
const fakeDecode = vi.fn((buffer, maxWidth) => ({ data: new Uint8Array(maxWidth * 10 * 4), width: maxWidth, height: 10 }));

describe('createLogoCache', () => {
  it('downloads and converts a logo once per URL and width', async () => {
    const fetchImpl = okFetch();
    const cache = createLogoCache({ fetchImpl, decode: fakeDecode });
    const first = await cache.get('https://cdn/logo.png', 576);
    const second = await cache.get('https://cdn/logo.png', 576);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('converts again for a different paper width', async () => {
    const fetchImpl = okFetch();
    const cache = createLogoCache({ fetchImpl, decode: fakeDecode });
    await cache.get('https://cdn/logo.png', 576);
    const small = await cache.get('https://cdn/logo.png', 384);
    expect(small.width).toBeLessThanOrEqual(384);
  });

  it('pads the raster height to a multiple of 8 with white rows', async () => {
    const cache = createLogoCache({ fetchImpl: okFetch(), decode: fakeDecode });
    const logo = await cache.get('https://cdn/logo.png', 576);
    expect(logo.height % 8).toBe(0);
    expect(logo.data.length).toBe(logo.width * logo.height * 4);
    expect(logo.data[logo.data.length - 1]).toBe(0xff);
  });

  it('returns null, without throwing, when the logo cannot be downloaded', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    const log = vi.fn();
    const cache = createLogoCache({ fetchImpl, decode: fakeDecode, log });
    await expect(cache.get('https://cdn/missing.png', 576)).resolves.toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it('retries a failed logo on the next print instead of caching the failure', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => png.buffer });
    const cache = createLogoCache({ fetchImpl, decode: fakeDecode, log: () => {} });
    expect(await cache.get('https://cdn/logo.png', 576)).toBeNull();
    expect(await cache.get('https://cdn/logo.png', 576)).not.toBeNull();
  });

  it('returns null for an empty URL without fetching', async () => {
    const fetchImpl = okFetch();
    const cache = createLogoCache({ fetchImpl, decode: fakeDecode });
    expect(await cache.get('', 576)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
