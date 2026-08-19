const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App config
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),

  // Printer selection
  selectPrinter: (printerName) => ipcRenderer.invoke('select-printer', printerName),

  // Test prints
  printDataUrl: (dataUrl) => ipcRenderer.invoke('print-data-url', dataUrl),
  browseAndPrintImage: () => ipcRenderer.invoke('browse-and-print-image'),
  testPrint: (restaurantData) => ipcRenderer.invoke('test-print', restaurantData),


  // Refresh printers
  refreshPrinters: () => ipcRenderer.invoke('refresh-printers'),

  // Close settings window
  closeSettings: () => ipcRenderer.invoke('close-settings'),

  // I18n
  i18nInit: () => ipcRenderer.invoke('i18n:get-init'),
  changeLanguage: (lng) => ipcRenderer.invoke('i18n:change-language', lng),
  onLanguageChange: (callback) => ipcRenderer.on('language-changed', (event, ...args) => callback(...args)),

  // Listen for printer events
  onPrintersLoading: (callback) => ipcRenderer.on('printers-loading', callback),
  onPrintersLoaded: (callback) => ipcRenderer.on('printers-loaded', callback),
  onPrintersError: (callback) => ipcRenderer.on('printers-error', callback),

  // Template Management API
  getTemplates: () => ipcRenderer.invoke('get-templates'),
  setDefaultTemplate: (templateName) => ipcRenderer.invoke('set-default-template', templateName),
  getTemplatePreviewHtml: (templateName, qrCodeSize) => ipcRenderer.invoke('get-template-preview-html', templateName, qrCodeSize),

  // Logo Management API
  getLogoConfig: () => ipcRenderer.invoke('get-logo-config'),
  selectLogoFile: () => ipcRenderer.invoke('select-logo-file'),
  setLogoSize: (size) => ipcRenderer.invoke('set-logo-size', size),
  setQRCodeEnabled: (enabled) => ipcRenderer.invoke('set-qrcode-enabled', enabled),
  removeLogo: () => ipcRenderer.invoke('remove-logo'),
  
  // Logo Enabled API
  setLogoEnabled: (enabled) => ipcRenderer.invoke('set-logo-enabled', enabled),
  setQRCodeSize: (size) => ipcRenderer.invoke('set-qrcode-size', size),

  // Cutter API
  setCutterEnabled: (enabled) => ipcRenderer.invoke('set-cutter-enabled', enabled),

  // Paper Width API
  setPaperWidth: (width) => ipcRenderer.invoke('set-paper-width', width),
  setWidthAdjust: (percent) => ipcRenderer.invoke('set-width-adjust', percent),
  printCalibrationPage: () => ipcRenderer.invoke('print-calibration-page'),

  // Printer Transport API
  getPrinterTransport: (printerName) => ipcRenderer.invoke('get-printer-transport', printerName),
  setPrinterTransport: (printerName, mode) => ipcRenderer.invoke('set-printer-transport', printerName, mode),

  // Export API
  saveDataUrlAsImage: (dataUrl) => ipcRenderer.invoke('save-data-url-as-image', dataUrl),

  // Clean up listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});