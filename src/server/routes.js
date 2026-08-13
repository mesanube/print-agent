import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getSystemPrinters } from '../printing/printer-manager.js';
import {
  getSelectedPrinter,
  getDefaultTemplate, setDefaultTemplate,
  getPaperWidth, setPaperWidth,
  getQRCodeEnabled, setQRCodeEnabled,
  getQRCodeSize, setQRCodeSize,
  getLogoEnabled, setLogoEnabled,
  getLogoSize, setLogoSize,
  getCutterEnabled, setCutterEnabled,
  getRegisterId, setRegisterId,
  getPrinterExplicitlySelected, selectPrinterByOperator,
} from '../core/store.js';
import { printTestPage, printReceipt, printOrder, printOrderUpdate, printInvoice, printCashClose, printDayZ } from '../printing/index.js';

// In-memory idempotency cache for print jobs, keyed by a generic `jobId`.
// Covers kitchen comandas/updates (jobId = kitchenTicketId) AND the SSE
// fan-out receipt/invoice/NC jobs. Protects against an SSE replay, a manual
// reprint racing through twice, or two machines sharing the same printer name.
// Short TTL — long enough to absorb a network retry, short enough that
// intentional reprints later (a fresh jobId) aren't blocked.
const PRINT_JOB_TTL_MS = 5 * 60 * 1000;
const printedJobs = new Map(); // jobId → printedAt timestamp

const isDuplicateJob = (jobId) => {
  if (!jobId) return false;
  const printedAt = printedJobs.get(jobId);
  if (!printedAt) return false;
  if (Date.now() - printedAt > PRINT_JOB_TTL_MS) {
    printedJobs.delete(jobId);
    return false;
  }
  return true;
};

const recordJob = (jobId) => {
  if (!jobId) return;
  printedJobs.set(jobId, Date.now());
  // Best-effort eviction so the map can't grow unbounded over a long
  // uptime — sweep entries past TTL on each insert.
  if (printedJobs.size > 256) {
    const cutoff = Date.now() - PRINT_JOB_TTL_MS;
    for (const [id, ts] of printedJobs) {
      if (ts < cutoff) printedJobs.delete(id);
    }
  }
};

export function createApi(options) {
  const { isDevelopmentMode, getCurrentPort } = options;
  const app = new Hono();

  // Enable CORS for all endpoints
  app.use('*', cors({
    origin: (origin) => {
      // Allow requests with no origin (curl, native apps, Postman, etc.)
      if (!origin) return origin;

      // Allow production and staging domains
      if (origin === 'https://app.mesanube.ar') return origin;
      if (origin === 'https://api.mesanube.ar') return origin;

      // Allow localhost for development (any port)
      if (origin.startsWith('http://localhost:')) return origin;
      if (origin.startsWith('http://127.0.0.1:')) return origin;

      // Log and reject unknown origins
      console.warn(`[CORS] Rejected origin: ${origin}`);
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length', 'X-Request-ID']
  }));

  // API Endpoints
  app.get('/status', (c) => {
    const { challenge } = c.req.query();
    return c.json({
      challenge: challenge || null,
      status: 'running',
      port: getCurrentPort(),
      printWindow: 'ready', // Legacy compatibility
      uptime: process.uptime(),
      selectedPrinter: getSelectedPrinter(),
      printerExplicitlySelected: getPrinterExplicitlySelected(),
      registerId: getRegisterId()
    });
  });

  app.get('/printers', async (c) => {
    try {
      const systemPrinters = await getSystemPrinters();
      return c.json({
        printers: systemPrinters,
        total: systemPrinters.length,
        selectedPrinter: getSelectedPrinter(),
        note: 'Dynamically fetched from system. Use POST /select-printer to choose one.'
      });
    } catch (error) {
      return c.json({
        error: 'Failed to get system printers',
        details: error.message,
        note: 'Check that printers are properly configured on your system.'
      }, 500);
    }
  });

  // GET /settings — full settings snapshot. Mirrors the IPC surface used by
  // the Electron settings window so an agent (or a remote troubleshooter) can
  // adjust paper width, QR, template, etc. without the desktop UI. (todo 014)
  app.get('/settings', (c) => {
    return c.json({
      selectedPrinter: getSelectedPrinter(),
      defaultTemplate: getDefaultTemplate(),
      paperWidth: getPaperWidth(),
      qrCodeEnabled: getQRCodeEnabled(),
      qrCodeSize: getQRCodeSize(),
      logoEnabled: getLogoEnabled(),
      logoSize: getLogoSize(),
      cutterEnabled: getCutterEnabled(),
    });
  });

  // PUT /settings — partial update. Only documented keys are honored; unknown
  // keys are ignored. Each setter validates internally; bad values fall back
  // to current value rather than throwing.
  app.put('/settings', async (c) => {
    try {
      const body = await c.req.json();
      const updaters = {
        defaultTemplate: setDefaultTemplate,
        paperWidth: setPaperWidth,
        qrCodeEnabled: setQRCodeEnabled,
        qrCodeSize: setQRCodeSize,
        logoEnabled: setLogoEnabled,
        logoSize: setLogoSize,
        cutterEnabled: setCutterEnabled,
      };
      for (const [key, setter] of Object.entries(updaters)) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          setter(body[key]);
        }
      }
      return c.json({
        success: true,
        settings: {
          selectedPrinter: getSelectedPrinter(),
          defaultTemplate: getDefaultTemplate(),
          paperWidth: getPaperWidth(),
          qrCodeEnabled: getQRCodeEnabled(),
          qrCodeSize: getQRCodeSize(),
          logoEnabled: getLogoEnabled(),
          logoSize: getLogoSize(),
          cutterEnabled: getCutterEnabled(),
        },
      });
    } catch (error) {
      return c.json({ error: 'Failed to update settings', details: error.message }, 500);
    }
  });

  app.post('/select-printer', async (c) => {
    try {
      const { printerName } = await c.req.json();
      if (!printerName) {
        return c.json({ error: 'Printer name is required' }, 400);
      }
      const systemPrinters = await getSystemPrinters();
      const printer = systemPrinters.find(p => p.name === printerName);
      if (!printer) {
        return c.json({
          error: 'Printer not found',
          availablePrinters: systemPrinters.map(p => p.name)
        }, 404);
      }
      // Operator opt-in: persist the printer AND mark the explicit-selection flag
      // so the web client (via /status) knows this terminal prints receipts locally.
      selectPrinterByOperator(printerName);
      return c.json({
        success: true,
        message: `Selected printer: ${printerName}`,
        selectedPrinter: printerName,
        printerExplicitlySelected: true
      });
    } catch (error) {
      return c.json({
        error: 'Failed to select printer',
        details: error.message
      }, 500);
    }
  });

  // POST /select-register — persist the register (caja) assigned to this
  // terminal. The agent has no auth of its own: access control lives in the web
  // client (the Settings UI only offers this to manager/owner). The agent only
  // stores what it receives. A null/empty value clears the binding so the
  // client falls back to its manual register selector.
  app.post('/select-register', async (c) => {
    try {
      const { registerId } = await c.req.json().catch(() => ({}));
      setRegisterId(registerId || null);
      return c.json({
        success: true,
        registerId: getRegisterId()
      });
    } catch (error) {
      return c.json({
        error: 'Failed to select register',
        details: error.message
      }, 500);
    }
  });

  // Test endpoint (conditionally enabled)
  app.post('/test', async (c) => {
    if (!isDevelopmentMode) {
      return c.json({ error: 'Test endpoint only available in development mode' }, 404);
    }
    try {
      const requestData = await c.req.json().catch(() => ({}));
      await printTestPage(requestData.restaurant);
      return c.json({ success: true, message: 'Test page sent to printer' });
    } catch (error) {
      return c.json({ error: 'Print test failed', details: error.message }, 500);
    }
  });

  app.post('/print/receipt', async (c) => {
    try {
      const requestData = await c.req.json();
      const { printerName, jobId } = requestData;

      // Idempotency: the SSE fan-out can deliver the same precuenta event to two
      // machines that share a printer name, or replay it on reconnect. Ack with
      // `duplicate: true` instead of double-printing. A reprint uses a fresh jobId.
      if (isDuplicateJob(jobId)) {
        return c.json({
          success: true,
          duplicate: true,
          message: 'Receipt already printed (idempotency cache hit)',
        });
      }

      // Reserve before awaiting; release on failure so a real retry can proceed.
      if (jobId) recordJob(jobId);
      try {
        await printReceipt(requestData, printerName);
      } catch (error) {
        if (jobId) printedJobs.delete(jobId);
        throw error;
      }
      return c.json({ success: true, message: 'Receipt printed successfully' });
    } catch (error) {
      return c.json({ error: 'Print receipt failed', details: error.message }, 500);
    }
  });

  app.post('/print/cash-close', async (c) => {
    try {
      const requestData = await c.req.json();
      const { printerName } = requestData;
      // Do not log requestData: the cash-close payload is financially sensitive.
      await printCashClose(requestData, printerName);
      return c.json({ success: true, message: 'Cash-close printed successfully' });
    } catch (error) {
      // Generic message; never echo summary values back to the caller.
      return c.json({ error: 'Cash-close print failed' }, 500);
    }
  });

  app.post('/print/day-z', async (c) => {
    try {
      const requestData = await c.req.json();
      const { printerName } = requestData;
      // Do not log requestData: the day-Z payload is financially sensitive.
      await printDayZ(requestData, printerName);
      return c.json({ success: true, message: 'Day-Z printed successfully' });
    } catch (error) {
      return c.json({ error: 'Day-Z print failed' }, 500);
    }
  });

  app.post('/print/order', async (c) => {
    try {
      const requestData = await c.req.json();
      const { printerName, kitchenTicketId } = requestData;

      // Idempotency: SSE replay or client retry can deliver the same
      // `created` event twice. If we've already printed this kitchenTicketId
      // recently, ack with `duplicate: true` instead of double-printing.
      if (isDuplicateJob(kitchenTicketId)) {
        return c.json({
          success: true,
          duplicate: true,
          message: 'Order chit already printed (idempotency cache hit)',
        });
      }

      // Reserve the slot synchronously, before awaiting the print, so a
      // concurrent retry can't slip past the check while we're printing.
      // Release on failure so a legitimate retry can proceed.
      if (kitchenTicketId) recordJob(kitchenTicketId);
      try {
        await printOrder(requestData, printerName);
      } catch (error) {
        if (kitchenTicketId) printedJobs.delete(kitchenTicketId);
        throw error;
      }
      return c.json({ success: true, message: 'Order printed successfully' });
    } catch (error) {
      return c.json({ error: 'Print order failed', details: error.message }, 500);
    }
  });

  app.post('/print/order-update', async (c) => {
    try {
      const requestData = await c.req.json();
      const { printerName, kitchenTicketId } = requestData;

      // Idempotency: if we've already printed this kitchenTicketId recently,
      // ack with `duplicate: true` instead of double-printing. The client
      // treats this as success.
      if (isDuplicateJob(kitchenTicketId)) {
        return c.json({
          success: true,
          duplicate: true,
          message: 'Update chit already printed (idempotency cache hit)',
        });
      }

      // Reserve before awaiting (see /print/order above for rationale).
      if (kitchenTicketId) recordJob(kitchenTicketId);
      try {
        await printOrderUpdate(requestData, printerName);
      } catch (error) {
        if (kitchenTicketId) printedJobs.delete(kitchenTicketId);
        throw error;
      }
      return c.json({ success: true, message: 'Update chit printed successfully' });
    } catch (error) {
      return c.json({ error: 'Print update failed', details: error.message }, 500);
    }
  });

  app.post('/print/invoice', async (c) => {
    try {
      const requestData = await c.req.json();
      const { printerName, jobId } = requestData;

      // Idempotency: same rationale as /print/receipt (shared printer name or
      // SSE replay across machines). A reprint uses a fresh jobId.
      if (isDuplicateJob(jobId)) {
        return c.json({
          success: true,
          duplicate: true,
          message: 'Invoice already printed (idempotency cache hit)',
        });
      }

      if (jobId) recordJob(jobId);
      try {
        await printInvoice(requestData, printerName);
      } catch (error) {
        if (jobId) printedJobs.delete(jobId);
        throw error;
      }
      return c.json({ success: true, message: 'Invoice printed successfully' });
    } catch (error) {
      return c.json({ error: 'Print invoice failed', details: error.message }, 500);
    }
  });

  // Root endpoint (mode-dependent)
  if (isDevelopmentMode) {
    app.get('/', (c) => {
      const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <title>Print Agent Test Interface</title>
          <style>
              body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
              .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
              button { padding: 10px 15px; margin: 5px; cursor: pointer; }
              .success { color: green; }
              .error { color: red; }
              #results { margin-top: 20px; }
          </style>
      </head>
      <body>
          <h1>Print Agent Test Interface</h1>
          <div class="section">
              <h3>Status</h3>
              <button onclick="checkStatus()">Check Status</button>
              <button onclick="getPrinters()">Get Printers</button>
          </div>
          <div class="section">
              <h3>Printer Selection</h3>
              <select id="printerSelect" style="margin: 5px; padding: 5px; width: 300px;">
                  <option value="">Select a printer...</option>
              </select>
              <button onclick="selectPrinter()">Select Printer</button>
          </div>
          <div class="section">
              <h3>Print Tests</h3>
              <button onclick="printTest()">Print Test Page</button>
              <button onclick="printSampleReceipt()">Print Sample Receipt</button>
          </div>
          <div id="results"></div>
          <script>
              async function checkStatus() {
                  try {
                      const response = await fetch('/status');
                      const data = await response.json();
                      showResult('Status: ' + JSON.stringify(data, null, 2), 'success');
                  } catch (error) {
                      showResult('Error: ' + error.message, 'error');
                  }
              }
              async function getPrinters() {
                  try {
                      const response = await fetch('/printers');
                      const data = await response.json();
                      const select = document.getElementById('printerSelect');
                      select.innerHTML = '<option value="">Select a printer...</option>';
                      if (data.printers && data.printers.length > 0) {
                          data.printers.forEach(printer => {
                              const option = document.createElement('option');
                              option.value = printer.name;
                              option.textContent = printer.displayName + (printer.isDefault ? ' (Default)' : '') + ' - ' + printer.status;
                              if (printer.name === data.selectedPrinter) {
                                  option.selected = true;
                              }
                              select.appendChild(option);
                          });
                      }
                      showResult('Printers: ' + JSON.stringify(data, null, 2), 'success');
                  } catch (error) {
                      showResult('Error: ' + error.message, 'error');
                  }
              }
              async function selectPrinter() {
                  try {
                      const select = document.getElementById('printerSelect');
                      const printerName = select.value;
                      if (!printerName) {
                          showResult('Please select a printer first', 'error');
                          return;
                      }
                      const response = await fetch('/select-printer', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ printerName })
                      });
                      const data = await response.json();
                      if (data.success) {
                          showResult('Selected printer: ' + printerName, 'success');
                      } else {
                          showResult('Error: ' + (data.error || 'Failed to select printer'), 'error');
                      }
                  } catch (error) {
                      showResult('Error: ' + error.message, 'error');
                  }
              }
              async function printTest() {
                  try {
                      const response = await fetch('/test', { method: 'POST' });
                      const data = await response.json();
                      showResult('Test print result: ' + JSON.stringify(data), 'success');
                  } catch (error) {
                      showResult('Error: ' + error.message, 'error');
                  }
              }
              async function printSampleReceipt() {
                  try {
                      const sampleOrder = {
                          table: 5,
                          waiter: { name: 'Test Waiter' },
                          items: [
                              { menuItem: { name: 'Burger', price: 12.50 }, quantity: 2 },
                              { menuItem: { name: 'Fries', price: 4.00 }, quantity: 1 }
                          ],
                          orderTotal: 29.00
                      };
                      const response = await fetch('/print/receipt', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(sampleOrder)
                      });
                      const data = await response.json();
                      showResult('Receipt print result: ' + JSON.stringify(data), 'success');
                  } catch (error) {
                      showResult('Error: ' + error.message, 'error');
                  }
              }
              function showResult(message, type) {
                  const results = document.getElementById('results');
                  results.innerHTML = '<div class="' + type + '"><pre>' + message + '</pre></div>';
              }
          </script>
      </body>
      </html>
      `;
      return c.html(html);
    });
  }

  return app;
}