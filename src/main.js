// MUST be the first import. Populates process.env from .env so debug flags
// like PRINT_AGENT_DRY_RUN are visible to modules that read process.env at
// load time (windows-printer.js, etc.).
import './core/load-env.js';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { startServer } from './server/index.js';
import { findAvailablePort } from './shared/network-helpers.js';
import { setupSettingsIPC } from './settings/index.js';
import i18next from './core/i18n.js';
import { initializeEventListeners } from './core/app-events.js';
import { createTray, updateDockMenu } from './core/tray.js';
import { autoSelectPrinter } from './printing/printer-manager.js';
import { destroyPrintWindow } from './printing/windows-printer.js';
import { initAutoUpdater, quitAndInstallIfReady } from './core/auto-updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prevent multiple instances of the app from running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Print Agent is already running. Exiting this instance.');
  app.quit();
} else {
  // Handle second instance attempt - focus the existing instance
  app.on('second-instance', () => {
    console.log('Second instance attempted to start. Focusing existing instance.');
    // On macOS, show the app in dock if hidden
    if (process.platform === 'darwin') {
      app.dock?.show();
    }
    // You can also show a notification or focus a window here if needed
  });
}

app.whenReady().then(async () => {
  console.log('Print Agent starting...');
  try {
    // Initialize electron-store for persistence in renderer processes
    Store.initRenderer();

    // Wait for i18next to be ready
    await i18next.ready;

    // Always launch at login. Not user-configurable.
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
      name: 'Mesanube Impresora'
    });
    console.log('[Startup] Login item settings applied: true (hardcoded)');

    // Set up all application event listeners (quit, i18n changes, etc.)
    initializeEventListeners();
    
    // Set up IPC handlers for the settings window
    setupSettingsIPC();
    
    // Create the system tray icon and menu
    const tray = createTray();
    
    // Create the macOS dock menu
    if (process.platform === 'darwin') {
      updateDockMenu();
    }
    
    // Start the API server
    const isDevelopment = !app.isPackaged;
    await startServer(findAvailablePort, tray, isDevelopment);
    
    // Auto-select the default or first available printer
    await autoSelectPrinter();

    // Check for and silently apply agent updates (packaged builds only)
    if (app.isPackaged) {
      initAutoUpdater();
    }

    console.log('Print Agent initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Print Agent:', error);
    app.quit();
  }
});

// Cleanup resources before quitting
let quitHandled = false;
app.on('before-quit', async (event) => {
  // quitAndInstallIfReady() below drives its own app.quit(), which re-fires
  // this same 'before-quit' listener. Without this guard that re-entrant
  // call would preventDefault() again and loop forever instead of letting
  // the quit (and the update install) actually complete.
  if (quitHandled) {
    return;
  }
  quitHandled = true;

  console.log('[Cleanup] Starting cleanup before quit...');

  // Prevent default quit to allow cleanup to complete
  event.preventDefault();

  try {
    // Destroy the shared print window
    destroyPrintWindow();

    // Clean up temp receipt files
    const tempDir = os.tmpdir();
    console.log(`[Cleanup] Scanning temp directory: ${tempDir}`);

    const files = await fs.readdir(tempDir);
    const receiptFiles = files.filter(f => f.startsWith('receipt-') && f.endsWith('.png'));

    if (receiptFiles.length > 0) {
      console.log(`[Cleanup] Found ${receiptFiles.length} temp receipt files to delete`);
      await Promise.all(
        receiptFiles.map(async (file) => {
          const filePath = path.join(tempDir, file);
          try {
            await fs.unlink(filePath);
            console.log(`[Cleanup] Deleted: ${file}`);
          } catch (err) {
            console.warn(`[Cleanup] Could not delete ${file}: ${err.message}`);
          }
        })
      );
    } else {
      console.log('[Cleanup] No temp receipt files found');
    }

    console.log('[Cleanup] Cleanup complete');
  } catch (error) {
    console.error('[Cleanup] Error during cleanup:', error);
  } finally {
    // If an update finished downloading, quitAndInstallIfReady() installs it
    // and drives its own quit; app.exit(0) below must not also run in that
    // case. A failure here must still fall through to app.exit(0) so the
    // process never hangs instead of quitting.
    try {
      if (!quitAndInstallIfReady()) {
        app.exit(0);
      }
    } catch (error) {
      console.error('[Update] quitAndInstall failed, forcing exit:', error);
      app.exit(0);
    }
  }
});