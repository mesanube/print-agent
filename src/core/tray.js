import { app, Tray, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { showSettingsWindow } from '../settings/index.js';
import { startServer, stopServer } from '../server/index.js';
import { findAvailablePort } from '../shared/network-helpers.js';
import i18next from './i18n.js';
import { showStatus, changeLanguage } from './app-events.js';
import { checkForUpdatesManually, onUpdateStatusChange } from './auto-updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const iconDir = path.join(__dirname, '..', '..');
const icons = {
  base: path.join(iconDir, 'icon-32.png'),
  checking: path.join(iconDir, 'icon-32-checking.png'),
  ready: path.join(iconDir, 'icon-32-update-ready.png')
};

let tray = null;
let updateStatus = 'idle'; // 'idle' | 'checking' | 'ready'
let blinkInterval = null;
let blinkOn = false;

// 'checking' has no natural end frame to hold on, so blink between the base
// and checking icons instead of a single static badge -- a static badge that
// never changes reads as broken/stuck rather than "in progress".
function applyUpdateStatusToTray() {
  if (!tray) return;

  clearInterval(blinkInterval);
  blinkInterval = null;

  if (updateStatus === 'checking') {
    blinkInterval = setInterval(() => {
      blinkOn = !blinkOn;
      tray.setImage(blinkOn ? icons.checking : icons.base);
    }, 400);
    tray.setToolTip(i18next.t('tray.checkingForUpdates'));
  } else if (updateStatus === 'ready') {
    tray.setImage(icons.ready);
    tray.setToolTip(i18next.t('tray.updateReadyToInstall'));
  } else {
    tray.setImage(icons.base);
    tray.setToolTip('Print Agent - Ready');
  }
}

async function restartServer() {
  stopServer();
  const isDevelopment = !app.isPackaged;
  await startServer(findAvailablePort, tray, isDevelopment);
}

export function createTray() {
  try {
    if (!tray) {
      tray = new Tray(icons.base);

      tray.on('click', () => {
        showSettingsWindow();
      });
      tray.on('right-click', () => {
        tray.popUpContextMenu();
      });

      onUpdateStatusChange((status) => {
        updateStatus = status;
        applyUpdateStatusToTray();
      });
    }

    const menuTemplate = [
      {
        label: i18next.t('tray.viewStatus'),
        click: () => showStatus()
      },
      {
        label: i18next.t('tray.configurePrinter'),
        click: () => showSettingsWindow()
      },
      {
        label: i18next.t('tray.restartServer'),
        click: async () => {
          await restartServer();
        }
      },
      ...(app.isPackaged ? [{
        label: i18next.t('tray.checkForUpdates'),
        click: () => checkForUpdatesManually()
      }] : []),
      {
        label: i18next.t('tray.language'),
        submenu: [
          {
            label: i18next.t('tray.english'),
            type: 'radio',
            checked: i18next.language === 'en',
            click: () => changeLanguage('en')
          },
          {
            label: i18next.t('tray.spanish'),
            type: 'radio',
            checked: i18next.language === 'es',
            click: () => changeLanguage('es')
          }
        ]
      },
      { type: 'separator' },
      {
        label: i18next.t('tray.exit'),
        click: () => {
          app.isQuittingGracefully = true;
          app.quit();
        }
      }
    ];

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    tray.setContextMenu(contextMenu);
    // Re-apply after a rebuild (e.g. language change) so an in-progress
    // check or a pending update doesn't silently revert to the idle icon.
    applyUpdateStatusToTray();
    return tray;
  } catch (error) {
    console.error('Failed to create system tray:', error);
    return null;
  }
}

export function updateDockMenu() {
  if (process.platform !== 'darwin') return;

  const dockMenu = Menu.buildFromTemplate([
    {
      label: i18next.t('tray.configurePrinter'),
      click: () => {
        console.log('Dock: Configurar Impresora clicked');
        showSettingsWindow();
      }
    },
    {
      label: i18next.t('tray.viewStatus'),
      click: () => showStatus()
    }
  ]);
  app.dock.setMenu(dockMenu);
}