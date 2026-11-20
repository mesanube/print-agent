// The agent only links to a known Mesanube API (KTD3). Without this, any page
// that passes the CORS check could point the agent at another server and have
// it poll that server with a valid token.

const DEFAULT_ALLOWED_API_ORIGINS = ['https://api.mesanube.ar'];
const ALLOWED_API_URLS_ENV = 'PRINT_AGENT_ALLOWED_API_URLS';

// Returns the origin of a bare base URL (no credentials, path, query or
// fragment), or null when the value is not one.
function toBaseOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/') return null;
  return url.origin;
}

function getAllowedOrigins() {
  const extra = (process.env[ALLOWED_API_URLS_ENV] || '')
    .split(',')
    .map(toBaseOrigin)
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_API_ORIGINS, ...extra]);
}

// The normalized origin to store when `value` is an allowed API URL, else null.
export function normalizeAllowedApiUrl(value) {
  const origin = toBaseOrigin(value);
  if (!origin) return null;
  return getAllowedOrigins().has(origin) ? origin : null;
}
