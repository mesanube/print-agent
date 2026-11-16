import { describe, it, expect, afterEach } from 'vitest';
import { normalizeAllowedApiUrl } from './api-url-allowlist.js';

afterEach(() => {
  delete process.env.PRINT_AGENT_ALLOWED_API_URLS;
});

describe('normalizeAllowedApiUrl (KTD3)', () => {
  it('accepts the production API and returns its origin', () => {
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar')).toBe('https://api.mesanube.ar');
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar/')).toBe('https://api.mesanube.ar');
  });

  it('rejects any other host, scheme or port', () => {
    expect(normalizeAllowedApiUrl('https://evil.example.com')).toBeNull();
    expect(normalizeAllowedApiUrl('http://api.mesanube.ar')).toBeNull();
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar:8443')).toBeNull();
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar.evil.com')).toBeNull();
    expect(normalizeAllowedApiUrl('https://evil.com/https://api.mesanube.ar')).toBeNull();
  });

  it('rejects urls with credentials, a path, a query or a fragment', () => {
    expect(normalizeAllowedApiUrl('https://user:pass@api.mesanube.ar')).toBeNull();
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar/v1')).toBeNull();
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar?x=1')).toBeNull();
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar#x')).toBeNull();
  });

  it('rejects non strings and garbage', () => {
    expect(normalizeAllowedApiUrl(undefined)).toBeNull();
    expect(normalizeAllowedApiUrl(null)).toBeNull();
    expect(normalizeAllowedApiUrl(42)).toBeNull();
    expect(normalizeAllowedApiUrl('not a url')).toBeNull();
    expect(normalizeAllowedApiUrl('')).toBeNull();
  });

  it('accepts extra origins from PRINT_AGENT_ALLOWED_API_URLS (comma separated) and keeps the default', () => {
    process.env.PRINT_AGENT_ALLOWED_API_URLS = 'http://localhost:3000, https://staging.example.com/';
    expect(normalizeAllowedApiUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeAllowedApiUrl('https://staging.example.com')).toBe('https://staging.example.com');
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar')).toBe('https://api.mesanube.ar');
    expect(normalizeAllowedApiUrl('http://localhost:3001')).toBeNull();
  });

  it('ignores malformed entries in the env var', () => {
    process.env.PRINT_AGENT_ALLOWED_API_URLS = 'garbage,,  ';
    expect(normalizeAllowedApiUrl('https://api.mesanube.ar')).toBe('https://api.mesanube.ar');
    expect(normalizeAllowedApiUrl('garbage')).toBeNull();
  });
});
