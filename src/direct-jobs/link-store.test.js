import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same in-memory electron-store stand-in as core/store.test.js. The map lives
// outside the module registry, so a vi.resetModules() + re-import models an
// agent restart that reads the same file from disk.
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

const loadLinkStore = async () => {
  vi.resetModules();
  return import('./link-store.js');
};

const sampleLink = {
  token: 'secret-token-value',
  apiBaseUrl: 'https://api.mesanube.ar',
  agentId: 'agent-1',
  organizationId: 'org-1',
  locationId: 'loc-1',
  registerId: 'reg-1',
};

beforeEach(() => {
  memory.clear();
});

describe('installationId', () => {
  it('first start creates a uuid and the second start returns the same one', async () => {
    const first = await loadLinkStore();
    const created = first.getOrCreateInstallationId();
    expect(created).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const second = await loadLinkStore();
    expect(second.getOrCreateInstallationId()).toBe(created);
  });

  it('is not cleared when the link is cleared (unlink keeps the installation identity)', async () => {
    const linkStore = await loadLinkStore();
    const installationId = linkStore.getOrCreateInstallationId();
    linkStore.saveLink(sampleLink);

    linkStore.clearLink();

    expect(linkStore.getOrCreateInstallationId()).toBe(installationId);
    const afterRestart = await loadLinkStore();
    expect(afterRestart.getOrCreateInstallationId()).toBe(installationId);
  });
});

describe('link persistence', () => {
  it('has no link before anything is saved', async () => {
    const linkStore = await loadLinkStore();
    expect(linkStore.getLink()).toBeNull();
    expect(linkStore.getPublicLink()).toBeNull();
    expect(linkStore.isLinked()).toBe(false);
  });

  it('saves the link and it survives a restart', async () => {
    const linkStore = await loadLinkStore();
    linkStore.saveLink(sampleLink);

    const afterRestart = await loadLinkStore();
    expect(afterRestart.getLink()).toEqual(sampleLink);
    expect(afterRestart.isLinked()).toBe(true);
  });

  it('the public link carries ids and no token', async () => {
    const linkStore = await loadLinkStore();
    linkStore.saveLink(sampleLink);

    const publicLink = linkStore.getPublicLink();
    expect(publicLink).toEqual({
      agentId: 'agent-1',
      organizationId: 'org-1',
      locationId: 'loc-1',
      registerId: 'reg-1',
    });
    expect(JSON.stringify(publicLink)).not.toContain('secret-token-value');
    expect(publicLink).not.toHaveProperty('token');
  });

  it('a link without a register stores registerId as null', async () => {
    const linkStore = await loadLinkStore();
    linkStore.saveLink({ ...sampleLink, registerId: undefined });
    expect(linkStore.getPublicLink().registerId).toBeNull();
  });

  it('clearLink removes the token and every other link field', async () => {
    const linkStore = await loadLinkStore();
    linkStore.saveLink(sampleLink);
    linkStore.clearLink();
    expect(linkStore.getLink()).toBeNull();
    expect(linkStore.isLinked()).toBe(false);
    expect(JSON.stringify([...memory.values()])).not.toContain('secret-token-value');
  });

  it('a second link replaces the first one', async () => {
    const linkStore = await loadLinkStore();
    linkStore.saveLink(sampleLink);
    linkStore.saveLink({ ...sampleLink, token: 'other', agentId: 'agent-2' });
    expect(linkStore.getLink().agentId).toBe('agent-2');
    expect(linkStore.getLink().token).toBe('other');
  });
});

describe('onLinked', () => {
  it('notifies listeners with the stored link when a link is saved', async () => {
    const linkStore = await loadLinkStore();
    const listener = vi.fn();
    linkStore.onLinked(listener);

    linkStore.saveLink(sampleLink);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(sampleLink);
  });

  it('does not notify on clear, and the unsubscribe function stops notifications', async () => {
    const linkStore = await loadLinkStore();
    const listener = vi.fn();
    const unsubscribe = linkStore.onLinked(listener);

    linkStore.clearLink();
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    linkStore.saveLink(sampleLink);
    expect(listener).not.toHaveBeenCalled();
  });
});
