import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const autoUpdater = Object.assign(new EventEmitter(), {
  checkForUpdates: vi.fn(() => Promise.resolve()),
  quitAndInstall: vi.fn(),
});
vi.mock('electron-updater', () => ({ default: { autoUpdater } }));
vi.mock('electron', () => ({ powerMonitor: { on: vi.fn() } }));

const { initAutoUpdater, getPendingUpdateVersion, quitAndInstallIfReady } = await import('./auto-updater.js');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

describe('pending update state', () => {
  it('Covers AE4: reports the version once the update is downloaded, and installs it on Salir', () => {
    initAutoUpdater();
    expect(getPendingUpdateVersion()).toBeNull();
    expect(quitAndInstallIfReady()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    autoUpdater.emit('update-downloaded', { version: '1.7.0' });
    expect(getPendingUpdateVersion()).toBe('1.7.0');

    expect(quitAndInstallIfReady()).toBe(true);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });
});
