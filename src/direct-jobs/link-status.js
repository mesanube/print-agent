import { clearLink, isLinked, onLinked } from './link-store.js';

// 'linked' (receiving jobs), 'unlinked' (no valid link), 'offline' (linked but
// the server is not reachable). Shown in the tray (R8).
export const LINK_STATE_TRANSLATION_KEYS = {
  linked: 'tray.linkStatus.linked',
  unlinked: 'tray.linkStatus.unlinked',
  offline: 'tray.linkStatus.offline',
};

// Consecutive network errors before the agent reports itself offline. A single
// failed poll is normal on a flaky connection and must not flash the tray.
export const OFFLINE_AFTER_NETWORK_ERRORS = 3;

const listeners = new Set();
let consecutiveNetworkErrors = 0;

// A stored link starts as 'linked': the 401 or the network errors of the first
// polls correct it within seconds if it is wrong. Resolved eagerly, before the
// onLinked subscription below, so a later save is seen as a change.
let state = isLinked() ? 'linked' : 'unlinked';

function setState(next) {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener(next);
}

export function getLinkState() {
  return state;
}

export function onLinkStatusChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A poll that reached the server and was authorized.
export function markPollSuccess() {
  if (state === 'unlinked') return;
  consecutiveNetworkErrors = 0;
  setState('linked');
}

// A poll that failed without an answer from the server (network error, timeout,
// 5xx is the caller's call).
export function markNetworkError() {
  if (state === 'unlinked') return;
  consecutiveNetworkErrors += 1;
  if (consecutiveNetworkErrors >= OFFLINE_AFTER_NETWORK_ERRORS) setState('offline');
}

// The server answered 401: the credential was revoked or is invalid. Forget it
// so the agent stops polling and the browser links it again (KTD12, KTD14).
export function markUnauthorized() {
  clearLink();
  consecutiveNetworkErrors = 0;
  setState('unlinked');
}

// A new link was just stored (POST /link).
onLinked(() => {
  consecutiveNetworkErrors = 0;
  setState('linked');
});
