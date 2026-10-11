import { TestBed } from '@angular/core/testing';
import { appVersion } from '@environments/version';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateService } from './update.service';

const DISMISS_KEY = 'wtf-update-dismissed-version';

function bump(version: string, part: 0 | 1 | 2, delta: number): string {
  const nums = version.split('.').map(Number);
  nums[part] += delta;
  return nums.join('.');
}

describe('UpdateService (web)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const release = (body: Record<string, unknown>, ok = true) =>
    fetchMock.mockResolvedValue({ ok, json: () => Promise.resolve(body) });

  async function create(): Promise<UpdateService> {
    const service = TestBed.inject(UpdateService);
    await vi.advanceTimersByTimeAsync(0);
    return service;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    release({ tag_name: `v${appVersion}` });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks GitHub for the latest release on startup', async () => {
    await create();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/FreyjaFia/WTF/releases/latest');
    expect(init.headers.Accept).toBe('application/vnd.github+json');
  });

  it('reports no update when the latest release is the current version', async () => {
    const service = await create();

    expect(service.updateAvailable()).toBe(false);
    expect(service.latest()).toBeNull();
    expect(service.shouldRefresh()).toBe(false);
  });

  it.each([
    ['patch', 2],
    ['minor', 1],
    ['major', 0],
  ] as const)('offers a refresh for a newer %s release', async (_label, part) => {
    release({ tag_name: `v${bump(appVersion, part, 1)}`, body: '  Notes here  ' });
    const service = await create();

    expect(service.updateAvailable()).toBe(true);
    expect(service.latest()).toEqual({
      version: bump(appVersion, part, 1),
      downloadUrl: null,
      releaseNotes: 'Notes here',
      action: 'refresh',
    });
    expect(service.shouldRefresh()).toBe(true);
  });

  it('accepts tags with or without the v prefix', async () => {
    release({ tag_name: `V${bump(appVersion, 2, 1)}` });
    const service = await create();

    expect(service.latest()?.version).toBe(bump(appVersion, 2, 1));
  });

  it.each([
    ['an older release', () => bump(appVersion, 2, -1)],
    ['a non-semver tag', () => 'nightly'],
    ['an empty tag', () => ''],
  ])('ignores %s', async (_label, tag) => {
    release({ tag_name: tag() });
    const service = await create();

    expect(service.updateAvailable()).toBe(false);
  });

  it('ignores failed requests and network errors', async () => {
    release({}, false);
    const service = await create();
    expect(service.updateAvailable()).toBe(false);

    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(service.checkForUpdates()).resolves.toBeUndefined();
    expect(service.updateAvailable()).toBe(false);
  });

  it('skips the check while the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await create();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-checks every 30 minutes and when the browser comes back online', async () => {
    await create();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('re-checks when the tab becomes visible but not when hidden', async () => {
    await create();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not overlap checks', async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const service = await create();

    await service.checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve({ ok: true, json: () => Promise.resolve({ tag_name: `v${appVersion}` }) });
    await vi.advanceTimersByTimeAsync(0);
  });

  it('aborts a request that takes longer than 8 seconds', async () => {
    let signal!: AbortSignal;
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal;
      return new Promise(() => undefined);
    });
    await create();

    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(8000);

    expect(signal.aborted).toBe(true);
  });

  describe('dismiss', () => {
    const newer = () => bump(appVersion, 2, 1);

    it('hides the update and remembers the dismissed version', async () => {
      release({ tag_name: `v${newer()}` });
      const service = await create();

      service.dismiss();

      expect(service.updateAvailable()).toBe(false);
      expect(localStorage.getItem(DISMISS_KEY)).toBe(newer());
    });

    it('does not offer a version that was dismissed earlier, but offers a newer one', async () => {
      localStorage.setItem(DISMISS_KEY, newer());
      release({ tag_name: `v${newer()}` });
      const service = await create();
      expect(service.updateAvailable()).toBe(false);

      release({ tag_name: `v${bump(appVersion, 2, 2)}` });
      await service.checkForUpdates();
      expect(service.updateAvailable()).toBe(true);
    });

    it('dismiss without a known update just hides', async () => {
      const service = await create();

      service.dismiss();

      expect(localStorage.getItem(DISMISS_KEY)).toBeNull();
    });

    it('hideForNow hides without remembering', async () => {
      release({ tag_name: `v${newer()}` });
      const service = await create();

      service.hideForNow();

      expect(service.updateAvailable()).toBe(false);
      expect(localStorage.getItem(DISMISS_KEY)).toBeNull();
    });
  });

  describe('applyUpdate', () => {
    it('does nothing when there is no update', async () => {
      const service = await create();

      await expect(service.applyUpdate()).resolves.toBeUndefined();
    });

    it('unregisters service workers, clears caches and reloads with a cache-busting param', async () => {
      release({ tag_name: `v${bump(appVersion, 2, 1)}` });
      const service = await create();
      const unregister = vi.fn().mockResolvedValue(true);
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { getRegistrations: () => Promise.resolve([{ unregister }, { unregister }]) },
      });
      const deleteCache = vi.fn().mockResolvedValue(true);
      vi.stubGlobal('caches', { keys: () => Promise.resolve(['a', 'b']), delete: deleteCache });
      const replace = vi.fn();
      const original = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { href: 'http://localhost/orders?x=1', replace },
      });

      try {
        await service.applyUpdate();
      } finally {
        Object.defineProperty(window, 'location', { configurable: true, value: original });
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
      }

      expect(service.updateAvailable()).toBe(false);
      expect(unregister).toHaveBeenCalledTimes(2);
      expect(deleteCache).toHaveBeenCalledWith('a');
      expect(deleteCache).toHaveBeenCalledWith('b');
      const target = new URL(replace.mock.calls[0][0] as string);
      expect(target.pathname).toBe('/orders');
      expect(target.searchParams.get('x')).toBe('1');
      expect(target.searchParams.get('wtf-refresh')).toBe(String(Date.now()));
    });

    it('still reloads when service worker and cache cleanup throw', async () => {
      release({ tag_name: `v${bump(appVersion, 2, 1)}` });
      const service = await create();
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { getRegistrations: () => Promise.reject(new Error('no')) },
      });
      vi.stubGlobal('caches', { keys: () => Promise.reject(new Error('no')) });
      const replace = vi.fn();
      const original = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { href: 'http://localhost/', replace },
      });

      try {
        await service.applyUpdate();
      } finally {
        Object.defineProperty(window, 'location', { configurable: true, value: original });
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
      }

      expect(replace).toHaveBeenCalledTimes(1);
    });
  });

  it('removes its listeners and timer on destroy', async () => {
    await create();
    TestBed.resetTestingModule();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
