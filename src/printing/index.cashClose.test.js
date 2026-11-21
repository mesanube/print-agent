import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A dry run (PRINT_AGENT_DRY_RUN=1) writes the rendered ticket to ~/print-agent-debug
// instead of printing. Receipts always take the Windows renderer, so they leave a file
// with only that flag; the cash-close used to be a silent no-op off-Windows, so on
// macOS the route answered "success" and nothing was rendered or captured. It now
// reaches the renderer on Windows, with USE_WINDOWS_PATH=1, or in a dry run.
const { printCashCloseWindows } = vi.hoisted(() => ({ printCashCloseWindows: vi.fn() }));
vi.mock('./windows-printer.js', () => ({
  printReceipt: vi.fn(), printOrder: vi.fn(), printOrderUpdate: vi.fn(), printTestPage: vi.fn(), printInvoice: vi.fn(),
  printCashClose: printCashCloseWindows, printDayZ: vi.fn(), printCalibrationPage: vi.fn(), printTextTestPage: vi.fn(),
}));
vi.mock('./unix-printer.js', () => ({
  printReceipt: vi.fn(), printOrder: vi.fn(), printOrderUpdate: vi.fn(), printTestPage: vi.fn(),
}));

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

// The platform and the flags are read when the module loads, so each case reloads it.
const loadDispatcher = async ({ platform, windowsPath = false, dryRun = false }) => {
  vi.resetModules();
  Object.defineProperty(process, 'platform', { value: platform });
  if (windowsPath) process.env.USE_WINDOWS_PATH = '1';
  else delete process.env.USE_WINDOWS_PATH;
  if (dryRun) process.env.PRINT_AGENT_DRY_RUN = '1';
  else delete process.env.PRINT_AGENT_DRY_RUN;
  return import('./index.js');
};

describe('printCashClose platform routing', () => {
  const data = { restaurant: { name: 'Bar' }, summary: { sales: {} } };

  beforeEach(() => {
    printCashCloseWindows.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
    delete process.env.USE_WINDOWS_PATH;
    delete process.env.PRINT_AGENT_DRY_RUN;
    vi.restoreAllMocks();
  });

  it('on Windows it prints', async () => {
    const { printCashClose } = await loadDispatcher({ platform: 'win32' });
    await printCashClose(data, 'Printer_POS_80');
    expect(printCashCloseWindows).toHaveBeenCalledWith(data, 'Printer_POS_80', null);
  });

  it('off Windows with USE_WINDOWS_PATH=1 it reaches the Windows renderer', async () => {
    const { printCashClose } = await loadDispatcher({ platform: 'darwin', windowsPath: true });
    await printCashClose(data, 'Printer_POS_80');
    expect(printCashCloseWindows).toHaveBeenCalledWith(data, 'Printer_POS_80', null);
  });

  it('off Windows in a dry run it reaches the renderer, so the ticket is captured to a file', async () => {
    const { printCashClose } = await loadDispatcher({ platform: 'darwin', dryRun: true });
    await printCashClose(data, 'Printer_POS_80');
    expect(printCashCloseWindows).toHaveBeenCalledWith(data, 'Printer_POS_80', null);
  });

  it('off Windows with no flag it stays a no-op (nothing would reach a real printer)', async () => {
    const { printCashClose } = await loadDispatcher({ platform: 'darwin' });
    await printCashClose(data, 'Printer_POS_80');
    expect(printCashCloseWindows).not.toHaveBeenCalled();
  });
});
