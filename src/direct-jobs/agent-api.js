import { getLink } from './link-store.js';

const REQUEST_TIMEOUT_MS = 15000;

// A failed call to the Mesanube server. `status` is the HTTP status, or null
// when the server could not be reached (network error, timeout). `token` is the
// credential the request was sent with, so the caller can tell a 401 for the
// current link from a 401 for a link that was replaced while the request flew.
export class AgentApiError extends Error {
  constructor(message, { status = null, token = null } = {}) {
    super(message);
    this.name = 'AgentApiError';
    this.status = status;
    this.token = token;
  }
}

/**
 * Calls of the agent to `<apiBaseUrl>/v1/print-agents/*`, authenticated with the
 * link's token (KTD1, KTD12). Reads the link on every call, so a link saved while
 * the loop runs is used from the next request on.
 * @param {{fetchImpl?: typeof fetch, readLink?: typeof getLink, timeoutMs?: number}} [deps]
 */
export function createAgentApi({ fetchImpl = (...args) => fetch(...args), readLink = getLink, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  async function post(path, body) {
    const link = readLink();
    if (!link) throw new AgentApiError('The agent is not linked', { status: null });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${link.apiBaseUrl}/v1/print-agents/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${link.token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AgentApiError(`Request to ${path} failed: ${error.message}`, { token: link.token });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new AgentApiError(`Request to ${path} answered ${response.status}`, { status: response.status, token: link.token });
    }
    return response.json().catch(() => ({}));
  }

  return {
    // -> { jobs: [{ jobId, kind, endpoint, body }] }
    poll: ({ printers, version, hostname }) => post('poll', { printers, version, hostname }),
    ack: (jobId) => post('jobs/ack', { jobId }),
    fail: ({ jobId, code, error }) => post('jobs/fail', { jobId, code, error }),
  };
}
