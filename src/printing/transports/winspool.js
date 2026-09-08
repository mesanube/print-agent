import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const isWindows = process.platform === 'win32';
let raw = null;

if (isWindows) {
  try {
    const koffi = require('koffi');

    const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
    const DOC_INFO_1W = koffi.struct('DOC_INFO_1W', {
      pDocName: 'const char16_t *',
      pOutputFile: 'const char16_t *',
      pDatatype: 'const char16_t *',
    });

    const winspool = koffi.load('winspool.drv');
    const kernel32 = koffi.load('kernel32.dll');

    raw = {
      DOC_INFO_1W,
      OpenPrinterW: winspool.func('bool __stdcall OpenPrinterW(const char16_t *pPrinterName, _Out_ HANDLE *phPrinter, void *pDefault)'),
      StartDocPrinterW: winspool.func('int __stdcall StartDocPrinterW(HANDLE hPrinter, uint32_t Level, DOC_INFO_1W *pDocInfo)'),
      StartPagePrinter: winspool.func('bool __stdcall StartPagePrinter(HANDLE hPrinter)'),
      WritePrinter: winspool.func('bool __stdcall WritePrinter(HANDLE hPrinter, void *pBuf, uint32_t cbBuf, _Out_ uint32_t *pcWritten)'),
      EndPagePrinter: winspool.func('bool __stdcall EndPagePrinter(HANDLE hPrinter)'),
      EndDocPrinter: winspool.func('bool __stdcall EndDocPrinter(HANDLE hPrinter)'),
      ClosePrinter: winspool.func('bool __stdcall ClosePrinter(HANDLE hPrinter)'),
      GetLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
    };
  } catch (error) {
    console.error(`[Winspool] Failed to load winspool.drv via koffi: ${error.message}`);
    raw = null;
  }
}

function checkAvailable() {
  if (!isWindows || !raw) {
    throw new Error('winspool is only available on Windows.');
  }
}

function lastErrorCode() {
  return raw.GetLastError();
}

/**
 * Opens a handle to a Windows printer queue by name.
 * @param {string} printerName
 * @returns {unknown} the printer HANDLE
 */
export function openPrinter(printerName) {
  checkAvailable();
  const phPrinter = [null];
  if (!raw.OpenPrinterW(printerName, phPrinter, null)) {
    throw new Error(`OpenPrinterW failed for "${printerName}" (error ${lastErrorCode()})`);
  }
  return phPrinter[0];
}

/**
 * Starts a print job with datatype "RAW" so the spooler hands the bytes to
 * the port monitor untransformed (R4, R9 — works for USB and network ports
 * alike, no driver involved).
 * @param {unknown} hPrinter
 * @param {string} docName
 * @returns {number} the job id
 */
export function startDocPrinter(hPrinter, docName) {
  checkAvailable();
  const docInfo = { pDocName: docName, pOutputFile: null, pDatatype: 'RAW' };
  const jobId = raw.StartDocPrinterW(hPrinter, 1, docInfo);
  if (jobId === 0) {
    throw new Error(`StartDocPrinterW failed (error ${lastErrorCode()})`);
  }
  return jobId;
}

export function startPagePrinter(hPrinter) {
  checkAvailable();
  if (!raw.StartPagePrinter(hPrinter)) {
    throw new Error(`StartPagePrinter failed (error ${lastErrorCode()})`);
  }
}

/**
 * Writes a buffer of raw bytes to the printer. Throws if the write is short.
 * @param {unknown} hPrinter
 * @param {Buffer} buffer
 */
export function writePrinter(hPrinter, buffer) {
  checkAvailable();
  const pcWritten = [0];
  if (!raw.WritePrinter(hPrinter, buffer, buffer.length, pcWritten)) {
    throw new Error(`WritePrinter failed (error ${lastErrorCode()})`);
  }
  if (pcWritten[0] !== buffer.length) {
    throw new Error(`WritePrinter wrote ${pcWritten[0]} of ${buffer.length} bytes`);
  }
}

export function endPagePrinter(hPrinter) {
  checkAvailable();
  if (!raw.EndPagePrinter(hPrinter)) {
    throw new Error(`EndPagePrinter failed (error ${lastErrorCode()})`);
  }
}

export function endDocPrinter(hPrinter) {
  checkAvailable();
  if (!raw.EndDocPrinter(hPrinter)) {
    throw new Error(`EndDocPrinter failed (error ${lastErrorCode()})`);
  }
}

export function closePrinter(hPrinter) {
  checkAvailable();
  if (!raw.ClosePrinter(hPrinter)) {
    throw new Error(`ClosePrinter failed (error ${lastErrorCode()})`);
  }
}
