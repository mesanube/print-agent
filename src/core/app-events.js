import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { getServer, getCurrentPort } from '../server/index.js';
import i18next from './i18n.js';
import { cleanupSettingsIPC, showSettingsWindow } from '../settings/index.js';
import { createTray, updateDockMenu } from './tray.js';

export async function changeLanguage(lng) {
  await i18next.changeLanguage(lng);
}

export function showStatus() {
  const server = getServer();
  const currentPort = getCurrentPort();
  const status = `${i18next.t('statusDialog.messageTitle')}
${i18next.t('statusDialog.server')} ${server ? i18next.t('statusDialog.running') : i18next.t('statusDialog.stopped')}
${i18next.t('statusDialog.port')} ${currentPort || i18next.t('statusDialog.notAssigned')}`;
  
  dialog.showMessageBox({
    type: 'info',
    title: i18next.t('statusDialog.title'),
    message: status,
    buttons: ['OK']
  });
}

export function initializeEventListeners() {
  // Listen for language changes to update UI
  i18next.on('languageChanged', (lng) => {
    createTray(); // Rebuild tray menu
    updateDockMenu(); // Rebuild dock menu for macOS

    // Notify all renderer windows of the language change
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('language-changed', {
        language: lng,
        resources: i18next.getResourceBundle(lng, 'translation')
      });
    });
  });
  // Provide i18n resources to renderer processes
  ipcMain.handle('i18n:get-init', (event) => {
    return {
      language: i18next.language,
      resources: i18next.getResourceBundle(i18next.language, 'translation')
    };
  });
  // Handle language change requests from renderer processes
  ipcMain.handle('i18n:change-language', (event, lng) => {
    changeLanguage(lng);
  });
  // Prevent app from quitting when all windows are closed
  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });
  // Prevent app from quitting when trying to close
  app.on('before-quit', (event) => {
    if (!app.isQuittingGracefully) {
      event.preventDefault();
    }
  });
  // Clean up when app is about to quit
  app.on('will-quit', () => {
    cleanupSettingsIPC();
  });
  // Handle dock icon click to show printer settings on macOS
  if (process.platform === 'darwin') {
    app.on('activate', () => {
      showSettingsWindow();
    });
  }
}