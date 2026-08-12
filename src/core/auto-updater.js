import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours

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
    console.log(`[Update] Update ${info.version} downloaded. Will install on next restart.`);
  });

  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
}
