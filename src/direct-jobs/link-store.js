import { randomUUID } from 'crypto';
import {
  getInstallationId, setInstallationId,
  getPrintAgentLink, setPrintAgentLink,
} from '../core/store.js';

const linkedListeners = new Set();

// Created on the first call and returned unchanged afterwards. Unlinking never
// clears it: it identifies this install, not a credential.
export function getOrCreateInstallationId() {
  const existing = getInstallationId();
  if (existing) return existing;
  const created = randomUUID();
  setInstallationId(created);
  return created;
}

// The full link including the token, for the poller only. Never send this to
// an HTTP response.
export function getLink() {
  const link = getPrintAgentLink();
  return link && link.token ? link : null;
}

export function isLinked() {
  return getLink() !== null;
}

// The link as the browser may see it: ids only, never the token.
export function getPublicLink() {
  const link = getLink();
  if (!link) return null;
  return {
    agentId: link.agentId,
    organizationId: link.organizationId,
    locationId: link.locationId,
    registerId: link.registerId ?? null,
  };
}

// Persists a new link (replacing any previous one) and tells the listeners so
// the poller can start without waiting for its next tick.
export function saveLink({ token, apiBaseUrl, agentId, organizationId, locationId, registerId }) {
  const link = {
    token,
    apiBaseUrl,
    agentId,
    organizationId,
    locationId,
    registerId: registerId ?? null,
  };
  setPrintAgentLink(link);
  for (const listener of linkedListeners) listener(link);
}

// Drops the token and the rest of the link. The installationId stays.
export function clearLink() {
  setPrintAgentLink(null);
}

export function onLinked(listener) {
  linkedListeners.add(listener);
  return () => linkedListeners.delete(listener);
}
