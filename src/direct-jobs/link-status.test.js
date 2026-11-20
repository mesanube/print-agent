import { describe, it, expect, vi, beforeEach } from 'vitest';

const memory = new Map();
vi.mock('electron-store', () => ({
  default: class {
    get(key, fallback) {
      return memory.has(key) ? memory.get(key) : fallback;
    }
    set(key, value) {
      memory.set(key, value);
    }
    delete(key) {
      memory.delete(key);
    }
  },
}));

const sampleLink = {
  token: 'secret-token-value',
  apiBaseUrl: 'https://api.mesanube.ar',
  agentId: 'agent-1',
  organizationId: 'org-1',
  locationId: 'loc-1',
  registerId: null,
};

const load = async () => {
  vi.resetModules();
  const linkStore = await import('./link-store.js');
  const linkStatus = await import('./link-status.js');
  return { linkStore, linkStatus };
};

beforeEach(() => {
  memory.clear();
});

describe('initial state', () => {
  it('is unlinked when no link is stored', async () => {
    const { linkStatus } = await load();
    expect(linkStatus.getLinkState()).toBe('unlinked');
  });

  it('is linked when a link is already stored (restart of a linked agent)', async () => {
    vi.resetModules();
    const linkStore = await import('./link-store.js');
    linkStore.saveLink(sampleLink);
    const linkStatus = await import('./link-status.js');
    expect(linkStatus.getLinkState()).toBe('linked');
  });
});

describe('transitions', () => {
  it('goes to linked when a link is saved', async () => {
    const { linkStore, linkStatus } = await load();
    linkStatus.getLinkState();
    linkStore.saveLink(sampleLink);
    expect(linkStatus.getLinkState()).toBe('linked');
  });

  it('stays linked on a successful poll', async () => {
    const { linkStore, linkStatus } = await load();
    linkStore.saveLink(sampleLink);
    linkStatus.markPollSuccess();
    expect(linkStatus.getLinkState()).toBe('linked');
  });

  it('goes offline only after the threshold of consecutive network errors', async () => {
    const { linkStore, linkStatus } = await load();
    linkStore.saveLink(sampleLink);
    for (let i = 0; i < linkStatus.OFFLINE_AFTER_NETWORK_ERRORS - 1; i += 1) {
      linkStatus.markNetworkError();
    }
    expect(linkStatus.getLinkState()).toBe('linked');
    linkStatus.markNetworkError();
    expect(linkStatus.getLinkState()).toBe('offline');
  });

  it('the offline threshold is 3 consecutive errors', async () => {
    const { linkStatus } = await load();
    expect(linkStatus.OFFLINE_AFTER_NETWORK_ERRORS).toBe(3);
  });

  it('a success between errors resets the count', async () => {
    const { linkStore, linkStatus } = await load();
    linkStore.saveLink(sampleLink);
    linkStatus.markNetworkError();
    linkStatus.markNetworkError();
    linkStatus.markPollSuccess();
    linkStatus.markNetworkError();
    linkStatus.markNetworkError();
    expect(linkStatus.getLinkState()).toBe('linked');
  });

  it('comes back from offline to linked on the next successful poll', async () => {
    const { linkStore, linkStatus } = await load();
    linkStore.saveLink(sampleLink);
    for (let i = 0; i < linkStatus.OFFLINE_AFTER_NETWORK_ERRORS; i += 1) linkStatus.markNetworkError();
    expect(linkStatus.getLinkState()).toBe('offline');
    linkStatus.markPollSuccess();
    expect(linkStatus.getLinkState()).toBe('linked');
  });

  it('a 401 goes to unlinked and clears the stored token', async () => {
    const { linkStore, linkStatus } = await load();
    linkStore.saveLink(sampleLink);
    linkStatus.markUnauthorized();
    expect(linkStatus.getLinkState()).toBe('unlinked');
    expect(linkStore.getLink()).toBeNull();
    expect(JSON.stringify([...memory.values()])).not.toContain('secret-token-value');
  });

  it('a 401 keeps the installationId', async () => {
    const { linkStore, linkStatus } = await load();
    const installationId = linkStore.getOrCreateInstallationId();
    linkStore.saveLink(sampleLink);
    linkStatus.markUnauthorized();
    expect(linkStore.getOrCreateInstallationId()).toBe(installationId);
  });

  it('a late network error or success does not resurrect an unlinked agent', async () => {
    const { linkStatus } = await load();
    for (let i = 0; i < 5; i += 1) linkStatus.markNetworkError();
    expect(linkStatus.getLinkState()).toBe('unlinked');
    linkStatus.markPollSuccess();
    expect(linkStatus.getLinkState()).toBe('unlinked');
  });

  it('after a 401 a new link starts linked with a fresh error count', async () => {
    const { linkStore, linkStatus } = await load();
    linkStore.saveLink(sampleLink);
    linkStatus.markNetworkError();
    linkStatus.markNetworkError();
    linkStatus.markUnauthorized();
    linkStore.saveLink(sampleLink);
    linkStatus.markNetworkError();
    expect(linkStatus.getLinkState()).toBe('linked');
  });
});

describe('listeners', () => {
  it('notify only on a real change of state, with the new state', async () => {
    const { linkStore, linkStatus } = await load();
    const listener = vi.fn();
    linkStatus.onLinkStatusChange(listener);

    linkStore.saveLink(sampleLink);
    linkStatus.markPollSuccess();
    expect(listener.mock.calls).toEqual([['linked']]);

    for (let i = 0; i < linkStatus.OFFLINE_AFTER_NETWORK_ERRORS + 2; i += 1) linkStatus.markNetworkError();
    linkStatus.markUnauthorized();
    expect(listener.mock.calls).toEqual([['linked'], ['offline'], ['unlinked']]);
  });

  it('the unsubscribe function stops notifications', async () => {
    const { linkStore, linkStatus } = await load();
    const listener = vi.fn();
    const unsubscribe = linkStatus.onLinkStatusChange(listener);
    unsubscribe();
    linkStore.saveLink(sampleLink);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('tray texts', () => {
  it('every state has a translation key present in both locales without dashes', async () => {
    const { linkStatus } = await load();
    const es = (await import('../locales/es/translation.json', { with: { type: 'json' } })).default;
    const en = (await import('../locales/en/translation.json', { with: { type: 'json' } })).default;
    const lookup = (bundle, key) => key.split('.').reduce((node, part) => node?.[part], bundle);

    for (const state of ['linked', 'unlinked', 'offline']) {
      const key = linkStatus.LINK_STATE_TRANSLATION_KEYS[state];
      expect(key).toBeTruthy();
      for (const bundle of [es, en]) {
        const text = lookup(bundle, key);
        expect(typeof text).toBe('string');
        expect(text).not.toMatch(/[\u2013\u2014]/);
      }
    }
    expect(lookup(es, linkStatus.LINK_STATE_TRANSLATION_KEYS.linked)).toBe('Vinculado: recibiendo trabajos');
    expect(lookup(es, linkStatus.LINK_STATE_TRANSLATION_KEYS.unlinked)).toBe('Sin vincular');
    expect(lookup(es, linkStatus.LINK_STATE_TRANSLATION_KEYS.offline)).toBe('Sin conexión con el servidor');
  });
});
