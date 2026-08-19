import { BrowserWindow, ipcMain, dialog, app, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { getSystemPrinters } from '../printing/printer-manager.js';
import { printTestPage, printCalibrationPage } from '../printing/index.js';
import { printReceiptNative } from '../printing/native/windows-native-printer.js';
import i18next from '../core/i18n.js';
import { generateQRCodeHTML, generateQRCodeData } from '../printing/qrcode-generator.js';
import {
    selectPrinterByOperator, getSelectedPrinter, setDefaultTemplate, getDefaultTemplate,
    setLogoPath, getLogoSize, setLogoSize,
    getQRCodeEnabled, setQRCodeEnabled, getQRCodeSize, setQRCodeSize,
    setLogoEnabled, getLogoEnabled, getLogoPath,
    setCutterEnabled, getCutterEnabled,
    setPaperWidth, getPaperWidth,
    setWidthAdjust, getWidthAdjust
} from '../core/store.js';
import { getAbsoluteLogoPath, getLogoAsBase64 } from '../shared/file-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let settingsWindow = null;
// --- Window Management ---
export function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isVisible()) {
    settingsWindow.show();
    return;
  }
  
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const isMac = process.platform === 'darwin';

  settingsWindow = new BrowserWindow({
    width: isMac ? 450 : 800,
    height: 650,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // Correct path
    }
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html')); // Correct path

  settingsWindow.on('minimize', (event) => {
    event.preventDefault();
    settingsWindow.hide();
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  settingsWindow.webContents.once('did-finish-load', () => {
    loadPrinters();
  });
}

// --- File System Operations (Moved from utils.js) ---
function getTemplates() {
  const templatesDir = path.join(__dirname, '..', 'printing', 'templates');
  try {
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir);
      console.log(`[Templates] Created templates directory: ${templatesDir}`);
      return [];
    }
    const files = fs.readdirSync(templatesDir);
    return files.filter(file => file.endsWith('.html'));
  } catch (error) {
    console.error('[Templates] Failed to read templates directory:', error);
    return [];
  }
}

async function copyLogoToAppData(sourcePath) {
  try {
    const userDataPath = app.getPath('userData');
    const logosDir = path.join(userDataPath, 'logos');
    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true });
    }

    const logoFileName = `logo-${Date.now()}${path.extname(sourcePath)}`;
    const destinationPath = path.join(logosDir, logoFileName);
    await fsp.copyFile(sourcePath, destinationPath);
    setLogoPath(destinationPath);
    console.log('[Logo] Logo copied to:', destinationPath);
    return destinationPath;
  } catch (error)
{
    console.error('[Logo] Failed to copy logo:', error);
    throw error;
  }
}

// --- IPC Logic ---
async function loadPrinters() {
  try {
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    settingsWindow.webContents.send('printers-loading', true);

    const printers = await getSystemPrinters();
    const currentPrinter = getSelectedPrinter();
    settingsWindow.webContents.send('printers-loaded', {
      printers: printers,
      currentPrinter: currentPrinter
    });
  } catch (error) {
    console.error('Failed to load printers:', error);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('printers-error', {
        message: i18next.t('ipcMessages.printersError')
      });
    }
  }
}

export function setupSettingsIPC() {
  ipcMain.handle('get-app-config', () => {
    return { platform: process.platform };
  });
  ipcMain.handle('select-printer', async (event, printerName) => {
    try {
      const printers = await getSystemPrinters();
      const printer = printers.find(p => p.name === printerName);
      if (!printer) {
        return { success: false, message: i18next.t('ipcMessages.printerNotFound') };
      }
      // Operator opt-in from the settings window: persist + mark explicit flag.
      selectPrinterByOperator(printerName);
      return { success: true, message: i18next.t('ipcMessages.selectSuccess', { displayName: printer.displayName }) };
    } catch (error) {
   
       
      console.error('Failed to select printer:', error);
      return { success: false, message: i18next.t('ipcMessages.selectError') };
    }
  });
  ipcMain.handle('test-print', async (event, restaurantData) => {
    try {
      await printTestPage(restaurantData);
      return { success: true, message: i18next.t('ipcMessages.testSuccess') };
    } catch (error) {
      console.error('Template test print failed:', error);
      return { success: false, message: i18next.t('ipcMessages.testError', { message: error.message }) };
    }
  });
  ipcMain.handle('print-data-url', async (event, dataUrl) => {
    const selectedPrinter = getSelectedPrinter();
    if (!selectedPrinter) {
        return { success: false, message: i18next.t('ipcMessages.noPrinterForTest') };
    }
    const tempPath = path.join(os.tmpdir(), `print-job-${Date.now()}.png`);
    try {
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        await fsp.writeFile(tempPath, base64Data, 'base64');
        
        printReceiptNative({
            printerName: selectedPrinter,
            imageInput: tempPath,
            cutter: getCutterEnabled(), // Use stored setting
        });

        return { success: true, message: i18next.t('ipcMessages.testSuccess') };
    } catch (error) {
        console.error('Failed to print data URL:', error);
        return { success: false, message: i18next.t('ipcMessages.testError', { message: error.message }) };
    } finally {
        await fsp.unlink(tempPath).catch(err => console.warn(`Could not delete temp file: ${tempPath}`, err));
    }
  });
  ipcMain.handle('browse-and-print-image', async () => {
    const selectedPrinter = getSelectedPrinter();
    if (!selectedPrinter) {
        return { success: false, message: i18next.t('ipcMessages.noPrinterForTest'), canceled: false };
    }

    try {
        const result = await dialog.showOpenDialog(settingsWindow, {
            title: 'Select Image to Print',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, message: 'No file selected', canceled: true };
        }

        const imagePath = result.filePaths[0];
        printReceiptNative({
            printerName: selectedPrinter,
            imageInput: imagePath,
            cutter: getCutterEnabled(), // Use stored setting
        });
        
        return { success: true, message: 'Image print job sent successfully.' };

    } catch (error) {
        console.error('Failed to browse and print image:', error);
        return { success: false, message: `Image print failed: ${error.message}`, canceled: false };
    }
  });
  ipcMain.handle('refresh-printers', async () => {
    loadPrinters();
    return { success: true };
  });
  ipcMain.handle('close-settings', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
    return { success: true };
  });
  ipcMain.handle('get-templates', () => {
    const templates = getTemplates();
    const defaultTemplate = getDefaultTemplate();
    return { templates, defaultTemplate };
  });
  ipcMain.handle('set-default-template', (event, templateName) => {
    setDefaultTemplate(templateName);
    return { success: true, message: `Default template set to ${templateName}` };
  });
  ipcMain.handle('save-data-url-as-image', async (event, dataUrl) => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog(settingsWindow, {
            title: 'Save Receipt Image',
            defaultPath: `receipt-${Date.now()}.png`,
            filters: [
                { name: 'PNG Image', extensions: ['png'] },
                { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
            ]
        });

        if (canceled || !filePath) {
            return { success: true, canceled: true };
        }

        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        const pngBuffer = Buffer.from(base64Data, 'base64');
        let finalBuffer;

        if (path.extname(filePath).toLowerCase() === '.png') {
            finalBuffer = pngBuffer;
        } else {
            const image = nativeImage.createFromBuffer(pngBuffer);
            finalBuffer = image.toJPEG(90); // 90% quality
        }

        await fsp.writeFile(filePath, finalBuffer);

        return { success: true, message: `Image saved to ${path.basename(filePath)}` };

    } catch (error) {
        console.error('Failed to save image:', error);
        return { success: false, message: `Error saving file: ${error.message}` };
    }
  });
  ipcMain.handle('get-template-preview-html', async (event, templateName, qrCodeSize = 60) => {
    try {
      const templatePath = path.join(__dirname, '..', 'printing', 'templates', templateName);
      const template = await fsp.readFile(templatePath, 'utf-8');
      
      if (!template || template.trim() === '') {
        throw new Error(`Template file '${templateName}' is empty.`);
      }

      const restaurantData = { name: "Preview Restaurant", address: "123 Main Street" };
      const orderData = {
        table: 'PREVIEW', waiter: { name: 'Preview User' },
        items: [ { name: 'Sample Item 1', quantity: 1, price: 5.00 }, { name: 'Sample Item 2', quantity: 2, price: 10.00 }, ],
        orderTotal: 25.00, notes: 'This is a preview.'
      };

      const subtotal = orderData.orderTotal || 0;
      const taxRate = 0.085;
      const tax = subtotal * taxRate;
   
      const grandTotal = subtotal + tax;
      let itemsHtml = '';
      if (templateName === 'classic-table-receipt.html') {
        orderData.items.forEach(item => {
          const total = (item.price * item.quantity).toFixed(2);
          itemsHtml += `<tr><td class="item-name">${item.name}</td><td class="item-quantity">${item.quantity}</td><td class="item-price">$${item.price.toFixed(2)}</td><td class="item-total">$${total}</td></tr>`;
        });
      } else {
        orderData.items.forEach(item => {
          const total = (item.price * item.quantity).toFixed(2);
          itemsHtml += `<div class="item"><span>${item.name.padEnd(20)} x${item.quantity}</span><span>$${total}</span></div>`;
        });
      }
      
      const now = new Date();
      let finalHtml = template
        .replace('{{restaurant.name}}', restaurantData.name)
        .replace('{{restaurant.address}}', restaurantData.address)
        .replace('{{order.table}}', orderData.table)
        .replace('{{order.waiter}}', orderData.waiter.name)
        .replace('{{order.date}}', now.toLocaleDateString())
        .replace('{{order.time}}', now.toLocaleTimeString())
        .replace('{{order.items}}', itemsHtml)
        .replace('{{order.total}}', orderData.orderTotal.toFixed(2))
        .replace('{{order.tax}}', tax.toFixed(2))
        .replace('{{order.grandTotal}}', grandTotal.toFixed(2))
       
        .replace('{{order.notes}}', orderData.notes ? `<div class="notes-section"><strong>ORDER NOTES:</strong><p>${orderData.notes}</p></div>` : '');
      const logoEnabled = getLogoEnabled();
      const logoBase64 = getLogoAsBase64();
      if (logoEnabled && logoBase64) {
        const logoSizePercent = getLogoSize();
        const logoHtml = `<div style="text-align: center; margin-bottom: 10px;"><img src="${logoBase64}" style="width: ${logoSizePercent}% !important; max-width: ${logoSizePercent}% !important; height: auto !important; display: inline-block !important;" alt="Restaurant Logo" class="receipt-logo"></div>`;
        finalHtml = finalHtml.replace('{{restaurant.logo}}', logoHtml);
      } else {
        finalHtml = finalHtml.replace('{{restaurant.logo}}', '');
      }

      const qrEnabled = getQRCodeEnabled();
      if (qrEnabled) {
        const qrData = generateQRCodeData(orderData, restaurantData);
        const qrCodeHtml = await generateQRCodeHTML(qrData, {
          width: 100, margin: 1, sizePercent: qrCodeSize
        });
        finalHtml = finalHtml.replace('{{order.qrCode}}', qrCodeHtml);
      } else {
        finalHtml = finalHtml.replace('{{order.qrCode}}', '');
      }

      return { success: true, html: finalHtml };
    } catch (error) {
      console.error('Failed to generate template preview:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('get-logo-config', () => {
    return {
      logoPath: getLogoPath(),
      logoBase64: getLogoAsBase64(),
      logoSize: getLogoSize(),
      logoEnabled: getLogoEnabled(),
      qrCodeEnabled: getQRCodeEnabled(),
      qrCodeSize: getQRCodeSize(),
      cutterEnabled: getCutterEnabled(), // Return cutter setting
      paperWidth: getPaperWidth(),
      widthAdjust: getWidthAdjust()
    };
  });
  ipcMain.handle('select-logo-file', async () => {
    try {
      const result = await dialog.showOpenDialog(settingsWindow, {
        title: 'Select Logo Image',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'] }],
        properties: ['openFile']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const logoPath = await copyLogoToAppData(result.filePaths[0]);
        const logoBase64 = getLogoAsBase64();
        return { success: true, logoPath, logoBase64 };
      }
      return { success: false, message: 'No file selected' };
    } catch (error) {
      console.error('Failed to select logo file:', error);
      return { success: false, message: error.message };
    }
  });
  ipcMain.handle('set-logo-size', (event, size) => {
    const sizeNum = parseInt(size);
    if (!isNaN(sizeNum) && sizeNum >= 10 && sizeNum <= 100) {
      setLogoSize(sizeNum);
      return { success: true };
    }
    return { success: false, message: 'Invalid logo size. Must be between 10 and 100.' };
  });
  ipcMain.handle('set-qrcode-enabled', (event, enabled) => {
    setQRCodeEnabled(enabled);
    return { success: true };
  });
  ipcMain.handle('set-logo-enabled', (event, enabled) => {
    setLogoEnabled(enabled);
    return { success: true };
  });
  ipcMain.handle('set-qrcode-size', (event, size) => {
    const sizeNum = parseInt(size);
    if (!isNaN(sizeNum) && sizeNum >= 20 && sizeNum <= 100) {
      setQRCodeSize(sizeNum);
      return { success: true };
    }
    return { success: false, message: 'Invalid QR code size. Must be between 20 and 100.' };
  });
  // NEW: Handle saving the cutter setting
  ipcMain.handle('set-cutter-enabled', (event, enabled) => {
    setCutterEnabled(enabled);
    return { success: true };
  });
  ipcMain.handle('set-paper-width', (event, width) => {
    if (width !== '80mm' && width !== '58mm') {
      console.warn('[PaperWidth] Rejected invalid value:', width);
      return { success: false, message: 'Invalid paper width. Must be "80mm" or "58mm".' };
    }
    setPaperWidth(width);
    console.log('[PaperWidth] Saved, store now reads:', getPaperWidth());
    return { success: true };
  });
  ipcMain.handle('set-width-adjust', (event, percent) => {
    const value = Number(percent);
    if (!Number.isFinite(value) || value < 50 || value > 150) {
      console.warn('[WidthAdjust] Rejected out-of-range value:', percent);
      return { success: false, message: 'Invalid width adjust. Must be a number between 50 and 150.' };
    }
    setWidthAdjust(value);
    console.log('[WidthAdjust] Saved, store now reads:', getWidthAdjust());
    return { success: true };
  });
  ipcMain.handle('print-calibration-page', async () => {
    try {
      const selectedPrinter = getSelectedPrinter();
      await printCalibrationPage(selectedPrinter);
      return { success: true, message: i18next.t('ipcMessages.calibrationSuccess') };
    } catch (error) {
      console.error('Calibration page print failed:', error);
      return { success: false, message: i18next.t('ipcMessages.calibrationError', { message: error.message }) };
    }
  });
  ipcMain.handle('remove-logo', async () => {
    try {
      const currentPath = getAbsoluteLogoPath();
      if (currentPath) {
        await fsp.unlink(currentPath).catch(() => {}); // Ignore errors
      }
      setLogoPath(null);
      return { success: true };
    } catch (error) {
      console.error('Failed to remove logo:', error);
      return { success: false, message: error.message };
    }
  });
}

export function cleanupSettingsIPC() {
  ipcMain.removeHandler('select-printer');
  ipcMain.removeHandler('test-print');
  ipcMain.removeHandler('refresh-printers');
  ipcMain.removeHandler('close-settings');
  ipcMain.removeHandler('get-templates');
  ipcMain.removeHandler('set-default-template');
  ipcMain.removeHandler('get-template-preview-html');
  ipcMain.removeHandler('get-logo-config');
  ipcMain.removeHandler('select-logo-file');
  ipcMain.removeHandler('set-logo-size');
  ipcMain.removeHandler('set-qrcode-enabled');
  ipcMain.removeHandler('remove-logo');
  ipcMain.removeHandler('set-qrcode-size');
  ipcMain.removeHandler('set-logo-enabled');
  ipcMain.removeHandler('get-app-config');
  ipcMain.removeHandler('print-data-url');
  ipcMain.removeHandler('browse-and-print-image');
  ipcMain.removeHandler('save-data-url-as-image');
  // NEW: Clean up new handlers
  ipcMain.removeHandler('set-cutter-enabled');
  ipcMain.removeHandler('set-paper-width');
  ipcMain.removeHandler('set-width-adjust');
  ipcMain.removeHandler('print-calibration-page');
}