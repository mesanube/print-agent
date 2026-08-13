# Print Agent — CLAUDE.md

Electron desktop service that exposes a local HTTP API for the Mesanube POS client/server to print receipts, orders (comandas), and invoices to thermal/native printers. Runs in the system tray on the cashier's machine; the web client posts to it on `localhost:8847`–`8857`.

**This repo is standalone** (split out from the main `mesanube` monorepo to publish releases via GitHub Releases / electron-updater). It has no access to the main repo's `CLAUDE.md`, `docs/plans/`, or `docs/solutions/` — this file is self-contained. If you need the client or server source to understand a contract described below, they live in the separate `mesanube` repo (`client/` = Ionic React, `server/` = Express + MongoDB).

> **Stack note**: no Ionic, no MongoDB, no Express. **Electron 28** + **Hono** + **electron-store** + **node-thermal-printer**. JavaScript only, ES modules.

## Project-Wide Conventions (carried over from the Mesanube monorepo)

- **Language**: JavaScript (`.js`) only. Never TypeScript, never `.d.ts`.
- **Code is in English**: identifiers, files, comments in English. Spanish is only for user-facing UI copy and strings (this app's UI is Spanish-first via i18next).
- **Package manager**: `yarn` only. Never `npm`, never commit `package-lock.json`.
- **HTTP**: native `fetch()`. No axios/superagent/got.
- **DRY**: reuse and adapt existing modules before creating new ones.
- **Commits**: Conventional Commits format (`feat(scope): ...`, `fix(scope): ...`, `chore: ...`). Scope is usually a domain word (`print-agent`, `caja`, `cocina`), the description is written in **Spanish** to match this repo's commit history — see `git log` for examples like `feat(cocina): la nota del pedido dispara actualización en KDS y comanda`.
- **Writing rules** (code comments, commit messages, docs, UI copy): never use em dashes (`—`) or en dashes (`–`) — use a comma, period, colon, parentheses, or a new sentence instead. Never use emojis in UI text, titles, buttons, or commit messages/docs. Plain ASCII + standard punctuation; accented Spanish vowels and currency symbols are fine, decorative Unicode (checkmarks, sparkles, arrows) is not.

## Commands

- `yarn dev` — Nodemon + Electron, watches `src/**/*.js`. Tray icon should appear.
- `yarn lint` / `yarn lint:fix` — ESLint over `src`.
- `yarn build` / `yarn build:win` / `yarn build:mac` / `yarn build:linux` — `electron-builder` packaging (publishes if a `publish` config is set — see Release/Auto-update below).
- `yarn dist` / `yarn dist:mac` / `yarn dist:linux` — Build distributables without publishing (`--publish=never`).

No test framework. Manual verification via the dev `/test` endpoint and the in-app settings UI.

## Architecture

```
src/
  main.js                       # Electron main; single-instance lock; spawns server + tray
  server/
    index.js                    # Hono server lifecycle (start/stop)
    routes.js                   # HTTP API surface
  printing/
    index.js                    # Platform-agnostic print dispatcher (Windows vs Unix)
    printer-manager.js          # Enumerate system printers (Windows native; lpstat on Unix)
    template-manager.js         # Load + interpolate {{mustache}} HTML receipt templates
    qrcode-generator.js         # QR rendering via the qrcode package
    windows-printer.js          # HTML -> offscreen BrowserWindow -> PNG -> native print
    unix-printer.js             # node-thermal-printer + lpstat
    native/
      windows-native-printer.js # Bridge to cairo_printer.node (Windows-only native module)
    templates/                  # HTML receipt templates (modern/classic/branded variants)
  settings/
    index.js                    # Settings BrowserWindow + IPC handlers
    preload.js                  # Context-isolated preload bridge
    settings.html               # Printer/template/logo/QR config UI
  core/
    app-events.js               # quit / language-change / status events
    i18n.js                     # i18next (Spanish default, English fallback)
    store.js                    # electron-store: printer, template, logo, QR, cutter, autostart
    tray.js                     # System tray icon + context menu
    print-host.html             # HTML host page used by the offscreen print window
  shared/
    network-helpers.js          # findAvailablePort() across 8847-8857
    file-helpers.js              # Logo path resolution, base64 encoding
  locales/
    en/translation.json
    es/translation.json
```

## Key Files

| Concern | File |
|---|---|
| Electron entry point | `src/main.js` |
| HTTP route definitions | `src/server/routes.js` |
| Port discovery (8847-8857) | `src/shared/network-helpers.js` |
| Platform print dispatcher | `src/printing/index.js` |
| Windows native print binding | `src/printing/native/windows-native-printer.js` |
| Unix/macOS print path | `src/printing/unix-printer.js` |
| Template loader / interpolator | `src/printing/template-manager.js` |
| Persistent settings | `src/core/store.js` |
| Tray menu | `src/core/tray.js` |
| Settings UI bridge | `src/settings/preload.js` |

## HTTP API (consumed by the client)

CORS is locked to `https://app.mesanube.ar`, `https://api.mesanube.ar`, and localhost. Endpoints (see `src/server/routes.js` for the source of truth):

- `GET /status` — service health, currently selected printer, and terminal `registerId`.
- `GET /printers` — list discovered printers.
- `POST /select-printer` — persist a printer choice.
- `POST /select-register` — persist which terminal (`registerId`) this agent instance belongs to.
- `POST /print/receipt`, `POST /print/order`, `POST /print/invoice` — print jobs.
- `POST /test` — dev-only sample print.

## Integration Contract with the Mesanube Client/Server

This service is one leg of a larger print pipeline. Understanding the contract matters even though the other legs live in a different repo:

- **Detection**: the web client scans localhost ports 8847-8857 to find the agent (background retry, not a single pass — a stale one-shot scan is a known past bug: it looked identical to "agent not running" when it was really just slow to bind).
- **No websockets, no polling from the agent side, no IPC across the network.** HTTP-only. The server also fans print jobs out over SSE to any connected browser; the print-agent itself is never a stream consumer directly, the *client* is, and the client calls this agent's HTTP API to actually print.
- **Idempotency**: print requests carry a generic `jobId` used for dedup on this side (see `feat(print-agent): generaliza la idempotencia a un jobId generico` in git history). The server-side spooler (in the main repo) persists jobs before emitting and expects the machine that printed to confirm; duplicate prints happen if a confirmation is lost, so idempotent handling here is the second line of defense, not a formality.
- **No silent reroute.** When a terminal has explicitly opted into local printing (an explicit printer selection, tracked via `printerExplicitlySelected` in the store) and this agent is unreachable or the selected printer is gone, the client must surface a visible, actionable error ("Agente de impresión no conectado" / "tu impresora ya no existe, volvé a elegirla"). It must never silently fall back to printing on some other machine via SSE. If you're touching printer-selection or offline-handling logic, preserve this: a fallback that moves output to a surface the user can't see is worse than a clear error.
- **Per-terminal, per-sector printer selection is local-only.** Printer choices (receipt printer, and per-kitchen-sector comanda printer) are selected per terminal from the web UI but persisted here in `electron-store`, not in the database. The server/client never assume a printer name is globally unique or resolvable outside the terminal that chose it. New "select a printer for X" features should follow this same shape: read `/printers` from this agent, write the choice back to this agent's store, don't write it to the DB.
- **CORS origins are a deploy-time contract.** If `app.mesanube.ar` / `api.mesanube.ar` ever change, `src/server/index.js` (or wherever CORS is configured) and the main repo both need updating together.

## Key Patterns

- **Print pipeline**: HTML template -> offscreen `BrowserWindow` -> PNG (rendered at 2x zoom) -> native print API. The print `BrowserWindow` is **shared** across jobs — do not create a new one per print, and do not destroy it except on quit.
- **Persistent state** lives in `electron-store` (printer, template, logo, QR config, cutter flag, autostart, registerId). Never hardcode user preferences.
- **Platform abstraction**: `src/printing/index.js` dispatches to `windows-printer.js` or `unix-printer.js`. New features must land in **both** implementations or be explicitly guarded by `process.platform`.
- **Single-instance lock**: `app.requestSingleInstanceLock()` in `main.js` makes a second launch silently no-op. Use the tray icon to confirm the agent is running.
- **Cleanup on quit**: temp receipt files in the OS tmpdir are deleted explicitly. Preserve this behavior on any quit-handler change.
- **ES modules only** (`"type": "module"`). Use `import`/`export`, not `require`.
- **Logging convention**: `console.log("[Component] ...")` prefixes (`[Print]`, `[i18n]`, `[Cleanup]`, `[Server]`). Match existing prefixes when adding logs.

## Gotchas

- The native `cairo_printer.node` module is **Windows-only** and must be rebuilt against the current Electron version (`electron-rebuild`) when Electron is upgraded. It is excluded from the packaged build via `!src/printing/native/cairo_printer.node` in `package.json`'s `files`, and re-included specifically under `build.win.files`.
- Two READMEs exist (`README.md` API-focused, `README2.md` UX-focused) and have diverged. Treat **`README.md` as the API contract source of truth** until they're reconciled.
- No test framework, ESLint only — be deliberate about what you commit; there is no automated regression safety net.

## Thermal Printing Knowledge (paper width + QR reliability)

Learned the hard way; don't rediscover these:

- **QR codes must use `margin: 4` and `errorCorrectionLevel: 'H'`** in `qrcode-generator.js` (default was `margin: 1` / unspecified level, which broke AFIP invoice QR scanning on 58mm paper). The ISO/IEC 18004 spec requires a 4-module quiet zone; anything less is the single most common cause of a phone camera failing to find the code. `'H'` (30% recovery) tolerates thermal-printer ink bleed far better than the default `'M'` (15%).
- **The QR's `width` option is inert.** Output is SVG wrapped in a percentage-sized container; the real lever for printed QR size is `sizePercent` combined with the physical paper width, not the generator's `width`. Don't "fix" QR size by bumping `width`.
- **58mm vs 80mm paper scaling uses CSS `zoom`, injected once in `template-manager.js`** (`body { zoom: 1.23; }` on 58mm), not per-template font-size edits. `zoom` is non-standard but fully supported by Chromium (which Electron uses for print rendering), and unlike `transform: scale` it reflows layout, and unlike blanket `font-size !important` it proportionally scales nested overrides too. On 58mm the QR's `sizePercent` is also floored (`Math.max(configured, 80)`) so the physical code stays scannable.
- General rule: when a UI needs to scale across two discrete form factors (here, 80mm vs 58mm), reach for CSS `zoom` before editing every template.

## Verifying Changes

1. `yarn dev` — tray icon appears; clicking it opens the settings window.
2. `curl http://localhost:8847/status` — should return JSON including the selected printer (try the next ports up to 8857 if 8847 is taken).
3. Select a printer in the settings UI, then `curl -X POST http://localhost:8847/test` to print a sample receipt.
4. Against a running `mesanube` client/server, exercise a real print flow (close-table receipt, kitchen order, invoice) end-to-end.

## Release / Auto-update (GitHub Releases)

This repo was split out specifically to publish through GitHub Releases so installed agents can auto-update instead of requiring manual reinstalls at each restaurant. When wiring that up:

- `electron-builder` supports a `publish` block (`provider: "github"`, owner/repo) in `package.json`'s `build` config, and `electron-updater` for the runtime update check. Neither is configured yet as of the split — `yarn dist*` scripts currently pass `--publish=never`.
- Code signing matters more once this auto-updates: unsigned Windows/macOS builds trigger scarier OS warnings than a one-time manual install, and macOS auto-update requires a signed + notarized build regardless.
- Versioning in `package.json` must stay in lockstep with what's tagged/released on GitHub, since `electron-updater` compares against it.
- Keep the "no silent reroute" and per-terminal-local-state principles above in mind even here: an auto-update should never silently change which printer a terminal is bound to, or wipe `electron-store` state (printer selections, `registerId`) that only lives on that machine.
