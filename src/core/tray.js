import { app, Tray, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { showSettingsWindow } from '../settings/index.js';
import { startServer, stopServer } from '../server/index.js';
import { findAvailablePort } from '../shared/network-helpers.js';
import i18next from './i18n.js';
import { showStatus, changeLanguage } from './app-events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray = null;

async function restartServer() {
  stopServer();
  const isDevelopment = !app.isPackaged;
  await startServer(findAvailablePort, tray, isDevelopment);
}

export function createTray() {
  try {
    if (!tray) {
      const iconPath = path.join(__dirname, '..', '..', 'icon-32.png');
      tray = new Tray(iconPath);

      tray.on('click', () => {
        showSettingsWindow();
      });
      tray.on('right-click', () => {
        tray.popUpContextMenu();
      });
    }

    tray.setToolTip('Print Agent - Ready');
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