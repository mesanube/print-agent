import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// The print path must not open the hidden BrowserWindow that the Windows
// default-printer lookup needs: validating the job's printer only needs the
// native name list. process.platform is forced to win32 before the module is
// imported, since printer-manager.js branches on it at call time.
const BrowserWindow = vi.fn();
vi.mock('electron', () => ({ BrowserWindow }));
vi.mock('./native/windows-native-printer.js', () => ({
  getAllPrintersNative: vi.fn(() => [{ name: 'Caja' }, { name: 'Cocina' }]),
}));
vi.mock('../core/store.js', () => ({ getSelectedPrinter: vi.fn(), setSelectedPrinter: vi.fn() }));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
let requireSystemPrinter;

beforeAll(async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  ({ requireSystemPrinter } = await import('./printer-manager.js'));
});

afterAll(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
});

describe('requireSystemPrinter on Windows', () => {
  it('validates the job printer from the native list without opening a window', async () => {
    await expect(requireSystemPrinter('Cocina')).resolves.toMatchObject({ name: 'Cocina' });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it('still fails with the usual error for a printer that does not exist', async () => {
    await expect(requireSystemPrinter('Gone')).rejects.toThrow('Printer "Gone" not found. Available printers: Caja, Cocina');
    expect(BrowserWindow).not.toHaveBeenCalled();
  });
});
