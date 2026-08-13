import { powerMonitor } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours

let updateReady = false;
let checkForUpdates = null;

// Manually triggers the same update check the startup/interval/wake paths
// use (e.g. from the tray menu, for testing). No-op before initAutoUpdater()
// has run (unpackaged dev builds never call it).
export function checkForUpdatesManually() {
  checkForUpdates?.();
}

// Status pub/sub so the tray icon can reflect update activity without
// auto-updater.js depending on tray.js. Statuses: 'idle' | 'checking' |
// 'ready' (downloaded, waiting to install on restart).
const statusListeners = new Set();

export function onUpdateStatusChange(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setStatus(status) {
  for (const listener of statusListeners) listener(status);
}

// If an update finished downloading, install it now and return true so the
// caller can skip its normal exit path. main.js's quit handler must call this
// instead of relying on autoInstallOnAppQuit's 'quit' listener, because
// app.exit() (used there for its own cleanup flow) skips the 'quit' event
// entirely -- so a downloaded update would otherwise never install.
// quitAndInstall() itself drives Electron's normal app.quit() to actually
// close the app, so this must only ever be called once per process -- the
// caller is responsible for its own quit-handler re-entrancy guard.
export function quitAndInstallIfReady() {
  if (!updateReady) return false;
  updateReady = false;
  // Positional (isSilent, isForceRunAfter) args are correct for the
  // electron-updater ^6.8.9 range pinned in package.json. electron-builder's
  // v27 migration switches this to quitAndInstall({ isSilent, isForceRunAfter })
  // -- update this call if that major version is ever adopted.
  autoUpdater.quitAndInstall(true, true);
  return true;
}

// Silent by design: checkForUpdates() (not checkForUpdatesAndNotify()) never
// shows OS notifications or dialogs. Downloads run in the background and the
// new version installs only on the next natural app restart.
export function initAutoUpdater() {
  autoUpdater.autoDownload = true;
  // Install is triggered explicitly via quitAndInstallIfReady() from main.js's
  // quit handler, not by electron-updater's own 'quit' listener -- running
  // both would risk a double install attempt.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    setStatus('checking');
    console.log('[Update] Checking for update...');
  });
  autoUpdater.on('update-available', (info) => {
    console.log(`[Update] Update available: ${info.version}`);
  });
  autoUpdater.on('update-not-available', () => {
    setStatus('idle');
    console.log('[Update] No update available.');
  });
  autoUpdater.on('error', (error) => {
    setStatus('idle');
    console.error('[Update] Error checking for update:', error);
  });
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Update] Downloading: ${Math.round(progress.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    setStatus('ready');
    console.log(`[Update] Update ${info.version} downloaded. Will install on next restart.`);
  });

  // checkForUpdates() rejects on failure in addition to emitting 'error';
  // the 'error' listener above is the single source of truth for logging,
  // so swallow the rejection here to avoid an unhandled promise rejection.
  checkForUpdates = () => autoUpdater.checkForUpdates().catch(() => {});
  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);

  // The interval above only advances while the machine is awake, so a
  // cashier's computer that sleeps right after a check would otherwise wait
  // out the full interval again after waking, even if that's hours later.
  // Checking again on wake closes that gap.
  powerMonitor.on('resume', checkForUpdates);
}
