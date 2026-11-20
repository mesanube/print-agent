import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({ app: {}, BrowserWindow: vi.fn(), powerMonitor: { on: vi.fn() } }));
vi.mock('../printing/printer-manager.js', () => ({ getSystemPrinters: vi.fn(async () => []) }));
// Link persistence is backed by a real map so /link and /status are exercised
// against the real link-store module; the rest of the store stays stubbed.
const linkMemory = vi.hoisted(() => new Map());
vi.mock('../core/store.js', () => {
  const fn = (value = null) => vi.fn(() => value);
  return {
    getInstallationId: (...args) => (linkMemory.has('installationId') ? linkMemory.get('installationId') : (args[0] ?? null)),
    setInstallationId: (id) => linkMemory.set('installationId', id),
    getDirectJobsState: () => linkMemory.get('directJobs') ?? null,
    setDirectJobsState: (state) => linkMemory.set('directJobs', JSON.parse(JSON.stringify(state))),
    getPrintAgentLink: () => linkMemory.get('link') ?? null,
    setPrintAgentLink: (link) => (link ? linkMemory.set('link', link) : linkMemory.delete('link')),
    getSelectedPrinter: fn('Caja'), getDefaultTemplate: fn(), setDefaultTemplate: fn(),
    getPaperWidth: fn('80mm'), setPaperWidth: fn(), getWidthAdjust: fn(100), setWidthAdjust: fn(),
    getPrinterTransports: fn({}), getQRCodeEnabled: fn(), setQRCodeEnabled: fn(),
    getQRCodeSize: fn(), setQRCodeSize: fn(), getLogoEnabled: fn(), setLogoEnabled: fn(),
    getLogoSize: fn(), setLogoSize: fn(), getPrinterCutter: fn(true), setPrinterCutter: fn(),
    getPrintMode: fn('text'), setPrintMode: fn(), PRINT_MODES: ['text', 'compat'],
    getPrinterCodepage: fn('cp858'), setPrinterCodepage: fn(), PRINTER_CODEPAGES: ['cp858'],
    getPrinterCharSpacing: fn(0), setPrinterCharSpacing: fn(), CHAR_SPACINGS: [0, 1, 2, 3],
    getRegisterId: fn(), setRegisterId: fn(), getPrinterExplicitlySelected: fn(false), selectPrinterByOperator: fn(),
  };
});
const printReceipt = vi.fn();
vi.mock('../printing/index.js', () => ({
  printReceipt, printTestPage: vi.fn(), printOrder: vi.fn(), printOrderUpdate: vi.fn(),
  printInvoice: vi.fn(), printCashClose: vi.fn(), printDayZ: vi.fn(), printCalibrationPage: vi.fn(),
}));
const getPendingUpdateVersion = vi.fn(() => null);
vi.mock('../core/auto-updater.js', () => ({ getPendingUpdateVersion }));

const { createApi } = await import('./routes.js');
const { resetJobDedup } = await import('../printing/job-dedup.js');
const { runJob } = await import('../direct-jobs/job-runner.js');
const app = createApi({ isDevelopmentMode: false, getCurrentPort: () => 8847, appVersion: '1.6.3' });

const post = (path, body) => app.request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  linkMemory.clear();
  resetJobDedup();
  delete process.env.PRINT_AGENT_ALLOWED_API_URLS;
});

describe('print routes on a stuck job (KTD4)', () => {
  it('Covers AE1: answers 500 with code PRINT_TIMEOUT, error and details, and accepts the same jobId again', async () => {
    printReceipt.mockRejectedValueOnce(Object.assign(new Error('Print receipt failed: stuck'), { code: 'PRINT_TIMEOUT' }));
    const first = await post('/print/receipt', { jobId: 'job-timeout', printerName: 'Caja' });
    expect(first.status).toBe(500);
    expect(await first.json()).toEqual({ error: 'Print receipt failed', details: 'Print receipt failed: stuck', code: 'PRINT_TIMEOUT' });

    printReceipt.mockResolvedValueOnce();
    const retry = await post('/print/receipt', { jobId: 'job-timeout', printerName: 'Caja' });
    expect(retry.status).toBe(200);
    expect((await retry.json()).duplicate).toBeUndefined();
    expect(printReceipt).toHaveBeenCalledTimes(2);
  });

  it('a common error answers 500 without a code, as before', async () => {
    printReceipt.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ENOENT' }));
    const response = await post('/print/receipt', { jobId: 'job-plain', printerName: 'Caja' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Print receipt failed', details: 'boom' });
  });
});

describe('GET /status update field', () => {
  it('reports the downloaded update version', async () => {
    getPendingUpdateVersion.mockReturnValueOnce('1.7.0');
    expect((await (await app.request('/status')).json()).updatePending).toBe('1.7.0');
  });

  it('reports null when no update is waiting', async () => {
    expect((await (await app.request('/status')).json()).updatePending).toBeNull();
  });
});

describe('settings charSpacing', () => {
  const put = (body) => app.request('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('saves a valid spacing for the given printer and returns it', async () => {
    const store = await import('../core/store.js');
    const response = await put({ printer: 'Cocina', charSpacing: 2 });
    expect(response.status).toBe(200);
    expect(store.setPrinterCharSpacing).toHaveBeenCalledWith('Cocina', 2);
    expect((await response.json()).settings).toHaveProperty('charSpacing');
  });

  it('ignores a spacing outside 0 to 3', async () => {
    const store = await import('../core/store.js');
    await put({ printer: 'Cocina', charSpacing: 7 });
    await put({ printer: 'Cocina', charSpacing: '2' });
    expect(store.setPrinterCharSpacing).not.toHaveBeenCalled();
  });

  it('GET reports the spacing of the selected printer', async () => {
    const response = await app.request('/settings');
    expect((await response.json()).charSpacing).toBe(0);
  });
});

describe('GET /status link fields (KTD16, R8)', () => {
  const getStatus = async () => (await app.request('/status')).json();
  const linkBody = {
    token: 'secret-token-value',
    apiBaseUrl: 'https://api.mesanube.ar',
    agentId: 'agent-1',
    organizationId: 'org-1',
    locationId: 'loc-1',
    registerId: 'reg-1',
  };

  it('announces the direct-jobs capability', async () => {
    expect((await getStatus()).capabilities).toContain('direct-jobs');
  });

  it('reports a stable installationId and the hostname, and keeps registerId', async () => {
    const first = await getStatus();
    const second = await getStatus();
    expect(first.installationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.installationId).toBe(first.installationId);
    expect(first.hostname).toBe((await import('os')).default.hostname());
    expect(first).toHaveProperty('registerId');
  });

  it('link is null when the agent was never linked', async () => {
    expect((await getStatus()).link).toBeNull();
  });

  it('after POST /link, link carries the ids and never the token', async () => {
    const response = await post('/link', linkBody);
    expect(response.status).toBe(200);

    const status = await getStatus();
    expect(status.link).toEqual({
      agentId: 'agent-1',
      organizationId: 'org-1',
      locationId: 'loc-1',
      registerId: 'reg-1',
    });
    expect(JSON.stringify(status)).not.toContain('secret-token-value');
  });
});

describe('POST /link (KTD3, R6, R7)', () => {
  const validBody = {
    token: 'secret-token-value',
    apiBaseUrl: 'https://api.mesanube.ar',
    agentId: 'agent-1',
    organizationId: 'org-1',
    locationId: 'loc-1',
    registerId: null,
  };

  it('stores the link for an allowed API url and the response has no token', async () => {
    const response = await post('/link', validBody);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('secret-token-value');
    expect(JSON.parse(text)).toEqual({
      success: true,
      link: { agentId: 'agent-1', organizationId: 'org-1', locationId: 'loc-1', registerId: null },
    });
    expect(linkMemory.get('link')).toMatchObject({ token: 'secret-token-value', apiBaseUrl: 'https://api.mesanube.ar' });
  });

  it('accepts a body without registerId', async () => {
    const { registerId, ...withoutRegister } = validBody;
    expect((await post('/link', withoutRegister)).status).toBe(200);
  });

  it('answers 400 for an API url outside the allowlist and changes nothing', async () => {
    const existing = { ...validBody, agentId: 'agent-old', token: 'old-token' };
    expect((await post('/link', existing)).status).toBe(200);

    const response = await post('/link', { ...validBody, apiBaseUrl: 'https://evil.example.com' });

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('secret-token-value');
    expect(linkMemory.get('link')).toMatchObject({ agentId: 'agent-old', token: 'old-token' });
  });

  it('a rejected first link leaves the agent unlinked', async () => {
    const response = await post('/link', { ...validBody, apiBaseUrl: 'http://localhost:3000' });
    expect(response.status).toBe(400);
    expect(linkMemory.has('link')).toBe(false);
  });

  it('accepts a development API url listed in PRINT_AGENT_ALLOWED_API_URLS', async () => {
    process.env.PRINT_AGENT_ALLOWED_API_URLS = 'http://localhost:3000';
    const response = await post('/link', { ...validBody, apiBaseUrl: 'http://localhost:3000' });
    expect(response.status).toBe(200);
    expect(linkMemory.get('link').apiBaseUrl).toBe('http://localhost:3000');
  });

  it.each([
    ['missing token', { token: undefined }],
    ['empty token', { token: '' }],
    ['non string token', { token: 123 }],
    ['missing agentId', { agentId: undefined }],
    ['missing organizationId', { organizationId: undefined }],
    ['missing locationId', { locationId: undefined }],
    ['non string registerId', { registerId: 42 }],
    ['missing apiBaseUrl', { apiBaseUrl: undefined }],
  ])('answers 400 on %s and changes nothing', async (_name, patch) => {
    const response = await post('/link', { ...validBody, ...patch });
    expect(response.status).toBe(400);
    expect(linkMemory.has('link')).toBe(false);
  });

  it('answers 400 on a body that is not JSON', async () => {
    const response = await app.request('/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'nope' });
    expect(response.status).toBe(400);
    expect(linkMemory.has('link')).toBe(false);
  });

  describe('cross-site requests', () => {
    const rawPost = (headers, body = validBody) => app.request('/link', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const existing = { ...validBody, agentId: 'agent-old', token: 'old-token' };

    it('rejects a text/plain simple request from a foreign origin and keeps the stored link', async () => {
      expect((await post('/link', existing)).status).toBe(200);

      const response = await rawPost({ 'Content-Type': 'text/plain', Origin: 'https://evil.example' });

      expect([403, 415]).toContain(response.status);
      expect(linkMemory.get('link')).toMatchObject({ agentId: 'agent-old', token: 'old-token' });
    });

    it('rejects application/json from a foreign origin with 403 and keeps the stored link', async () => {
      expect((await post('/link', existing)).status).toBe(200);

      const response = await rawPost({ 'Content-Type': 'application/json', Origin: 'https://evil.example' });

      expect(response.status).toBe(403);
      expect(linkMemory.get('link')).toMatchObject({ agentId: 'agent-old', token: 'old-token' });
    });

    it('rejects a non JSON content type without an origin with 415', async () => {
      const response = await rawPost({ 'Content-Type': 'text/plain' });
      expect(response.status).toBe(415);
      expect(linkMemory.has('link')).toBe(false);
    });

    it('rejects a request with no content type with 415', async () => {
      const response = await rawPost({});
      expect(response.status).toBe(415);
      expect(linkMemory.has('link')).toBe(false);
    });

    it.each([
      'https://app.mesanube.ar',
      'http://localhost:5173',
      'http://127.0.0.1:8100',
    ])('accepts application/json from the allowed origin %s', async (origin) => {
      const response = await rawPost({ 'Content-Type': 'application/json', Origin: origin });
      expect(response.status).toBe(200);
      expect(linkMemory.get('link')).toMatchObject({ token: 'secret-token-value' });
    });

    it('accepts application/json with a charset parameter', async () => {
      const response = await rawPost({ 'Content-Type': 'application/json; charset=utf-8' });
      expect(response.status).toBe(200);
    });

    it('accepts application/json with no Origin header (curl, native apps)', async () => {
      const response = await rawPost({ 'Content-Type': 'application/json' });
      expect(response.status).toBe(200);
    });
  });

  it('there is no local unlink endpoint', async () => {
    for (const method of ['POST', 'DELETE', 'PUT']) {
      const response = await app.request('/unlink', { method });
      expect(response.status).toBe(404);
    }
  });
});

describe('one dedup for the browser route and the direct poll (R4, U7)', () => {
  const receiptJob = (jobId) => ({ jobId, endpoint: 'receipt', body: { jobId, printerName: 'Caja' } });
  const makeApi = () => ({ ack: vi.fn(async () => ({})), fail: vi.fn(async () => ({})) });

  it('a jobId printed through the HTTP route and then offered by the poll is acked, not printed again', async () => {
    printReceipt.mockResolvedValue();
    expect((await post('/print/receipt', { jobId: 'dup-1', printerName: 'Caja' })).status).toBe(200);
    const api = makeApi();
    await runJob(receiptJob('dup-1'), api);
    expect(printReceipt).toHaveBeenCalledTimes(1);
    expect(api.ack).toHaveBeenCalledWith('dup-1');
  });

  it('a jobId printed by the poll and then sent by the browser answers duplicate and does not print', async () => {
    printReceipt.mockResolvedValue();
    await runJob(receiptJob('dup-2'), makeApi());
    const response = await post('/print/receipt', { jobId: 'dup-2', printerName: 'Caja' });
    expect((await response.json()).duplicate).toBe(true);
    expect(printReceipt).toHaveBeenCalledTimes(1);
  });

  it('a print that failed through the route releases the jobId, so the poll can print it', async () => {
    printReceipt.mockRejectedValueOnce(new Error('paper out'));
    expect((await post('/print/receipt', { jobId: 'dup-3', printerName: 'Caja' })).status).toBe(500);
    printReceipt.mockResolvedValueOnce();
    await runJob(receiptJob('dup-3'), makeApi());
    expect(printReceipt).toHaveBeenCalledTimes(2);
  });
});
