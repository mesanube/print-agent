import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours

let updateReady = false;

// If an update finished downloading, install it now and return true so the
// caller can skip its normal exit path. main.js's quit handler must call this
// instead of relying on autoInstallOnAppQuit's 'quit' listener, because
// app.exit() (used there for its own cleanup flow) skips the 'quit' event
// entirely -- so a downloaded update would otherwise never install.
export function quitAndInstallIfReady() {
  if (!updateReady) return false;
  autoUpdater.quitAndInstall(true, true);
  return true;
}

// Silent by design: checkForUpdates() (not checkForUpdatesAndNotify()) never
// shows OS notifications or dialogs. Downloads run in the background and the
// new version installs only on the next natural app restart.
export function initAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Update] Checking for update...');
  });
  autoUpdater.on('update-available', (info) => {
    console.log(`[Update] Update available: ${info.version}`);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[Update] No update available.');
  });
  autoUpdater.on('error', (error) => {
    console.error('[Update] Error checking for update:', error);
  });
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Update] Downloading: ${Math.round(progress.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    console.log(`[Update] Update ${info.version} downloaded. Will install on next restart.`);
  });

  // checkForUpdates() rejects on failure in addition to emitting 'error';
  // the 'error' listener above is the single source of truth for logging,
  // so swallow the rejection here to avoid an unhandled promise rejection.
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}
