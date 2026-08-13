// Tiny .env loader so debug flags (e.g. PRINT_AGENT_DRY_RUN) can live in a
// file alongside the agent. Intentionally minimal: no quoting, no escapes,
// no variable expansion. Lines starting with `#` and blank lines are ignored.
// `KEY=VALUE` pairs are applied to process.env, but ONLY if the key isn't
// already set (so an inline `KEY=… yarn dev` always wins).
//
// MUST be imported as the very first import in main.js so subsequent modules
// see the loaded values when their top-level code runs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '..', '..', '.env');

try {
  const raw = fs.readFileSync(envPath, 'utf8');
  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
      count += 1;
    }
  }
  if (count > 0) console.log(`[load-env] Loaded ${count} var(s) from ${envPath}`);
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.warn('[load-env] Failed to read .env:', error.message);
  }
}
