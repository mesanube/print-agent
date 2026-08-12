# Mesanube Print Agent

A standalone Electron application that runs as a background service to provide receipt, order (comanda), and invoice printing for the Mesanube POS system via a local HTTP API. Built with Electron, Hono, and node-thermal-printer, with a native settings UI for per-terminal configuration.

## Features

- **Background service**: runs quietly in the system tray on the cashier's machine.
- **HTTP API**: a simple RESTful API for status, printer selection, and print jobs, served on `localhost` ports 8847-8857.
- **Graphical settings UI**: select printers, manage receipt templates, customize the logo, and configure QR codes.
- **Custom HTML templates**: receipts, comandas, and invoices are rendered from HTML/CSS templates in `src/printing/templates/`.
- **Native printing**: uses `node-thermal-printer` (Unix) or a native Windows print bridge, without dialogs.
- **Persistent, per-terminal configuration**: printer selection, template, logo, QR, and register (`registerId`) are stored locally via `electron-store` and are never assumed to be globally unique across terminals.
- **Auto port discovery**: automatically finds an open port between 8847 and 8857.
- **Auto-update**: the installed agent checks for and applies new versions on its own (see Downloads and updates below).

## Quick Start

### Installation

```bash
yarn install
```

### Run in development

```bash
yarn dev
```

The application starts and an icon appears in the system tray. Clicking it opens the settings window.

### Configuration

1. Click the tray icon (or right-click for the context menu) and open the settings window.
2. Choose the thermal printer from the dropdown and save.
3. Use the test print option to confirm connectivity (`POST /test`).

## API Endpoints

The agent exposes the following endpoints on `localhost` at the automatically selected port (default `8847`, tries up to `8857`). CORS is restricted to `https://app.mesanube.ar`, `https://api.mesanube.ar`, and localhost.

### Status and information

#### `GET /status`

Returns the current status of the agent, the selected printer, and the terminal's `registerId`.

```json
{
  "status": "running",
  "port": 8847,
  "uptime": 123.45,
  "selectedPrinter": "XP-80C",
  "printerExplicitlySelected": true,
  "registerId": "caja-1"
}
```

#### `GET /printers`

Lists all printers detected on the system.

```json
{
  "printers": [
    { "name": "XP-80C", "displayName": "XP-80C", "isDefault": true }
  ],
  "total": 1,
  "selectedPrinter": "XP-80C"
}
```

#### `GET /settings`

Returns the full settings snapshot (printer, template, paper width, QR/logo config), mirroring the settings window's IPC surface.

### Printer and register selection

#### `POST /select-printer`

Persists a printer choice for this terminal only.

```json
{ "printerName": "XP-80C" }
```

#### `POST /select-register`

Persists which terminal (`registerId`) this agent instance belongs to.

```json
{ "registerId": "caja-1" }
```

### Print operations

- `POST /test` - dev-only sample print, used to confirm printer connectivity.
- `POST /print/receipt` - prints a customer receipt from restaurant and order data.
- `POST /print/order` and `POST /print/order-update` - prints and updates kitchen orders (comandas).
- `POST /print/invoice` - prints an AFIP-style invoice, including its QR code.
- `POST /print/cash-close` and `POST /print/day-z` - prints cash register close and end-of-day (Z) reports.

Example receipt payload:

```json
{
  "restaurant": {
    "name": "The Burger Joint",
    "address": "123 Main Street"
  },
  "order": {
    "table": 5,
    "waiter": { "name": "Jane D." },
    "items": [
      { "menuItem": { "name": "Classic Burger", "price": 12.50 }, "quantity": 2 },
      { "menuItem": { "name": "Soda", "price": 2.00 }, "quantity": 1 }
    ],
    "orderTotal": 27.00,
    "notes": "No onions on one burger."
  }
}
```

```json
{ "success": true, "message": "Receipt printed successfully" }
```

## Customization

### Editing templates

1. Go to `src/printing/templates/`.
2. Modify an existing `.html` template or create a new one, using standard HTML and CSS.
3. Available placeholders include `{{restaurant.name}}`, `{{restaurant.address}}`, `{{restaurant.logo}}`, `{{order.table}}`, `{{order.waiter}}`, `{{order.items}}`, `{{order.total}}`, `{{order.grandTotal}}`, `{{order.notes}}`, and `{{order.qrCode}}`.
4. Select the new template from the settings window to make it active.

### Logo and QR code

The logo and QR code are configured from the settings window: enable/disable, upload a logo image, and resize both via sliders. QR codes use `margin: 4` and `errorCorrectionLevel: 'H'` for reliable scanning on thermal paper.

## Integration Example

```javascript
async function printReceiptFromPOS(orderPayload) {
  const printAgentURL = 'http://localhost:8847/print/receipt';

  try {
    const response = await fetch(printAgentURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    const result = await response.json();
    if (result.success) {
      console.log('Successfully sent receipt to printer.');
    } else {
      console.error('Printing failed:', result.details);
    }
  } catch (error) {
    console.error('Could not connect to the Print Agent. Is it running?', error);
  }
}
```

## Downloads and Updates

Windows installers are published as GitHub Releases on this repository. Download the latest `.exe` from the repository's Releases page and run it to install the agent.

Once installed, the agent checks for new releases in the background and updates itself silently: a new version downloads without interrupting any active print job, and installs automatically the next time the app restarts naturally. No manual reinstall is required. Per-terminal settings (selected printer, register, template, logo, QR configuration) are preserved across updates.

## Project Structure

```
/
├── src/
│   ├── core/           # Core app services (events, tray, i18n, store, auto-update)
│   ├── locales/        # Language files for i18n
│   ├── printing/       # Printing logic, templates, and printer discovery
│   ├── server/         # Hono API server and route definitions
│   ├── settings/       # Logic and UI for the settings window
│   ├── shared/         # Shared utility helpers
│   └── main.js         # The main application entry point
│
├── dist/                # Build output (not committed)
├── icon.png
└── package.json
```

## Troubleshooting

- **Print Agent not responding**: check the tray icon is present, and restart the server via the tray context menu.
- **No printers found**: verify printer drivers are installed and the printer is powered on and connected.
- **Port already in use**: the app automatically tries ports 8847-8857; check the tray or `GET /status` for the assigned port.

## Development

- `yarn dev` - Nodemon + Electron, watches `src/**/*.js`.
- `yarn lint` / `yarn lint:fix` - ESLint over `src`.
- `yarn build:win` / `yarn build:mac` / `yarn build:linux` - `electron-builder` packaging.
- `yarn dist` / `yarn dist:mac` / `yarn dist:linux` - build distributables without publishing.

No test framework. Manual verification via the dev `/test` endpoint and the in-app settings UI.

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make your changes and test thoroughly.
4. Submit a pull request.

## License

This project is licensed under the MIT License.
