import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import {
  AuthLoadingService,
  AuthService,
  ConversationInboxService,
  ConnectivityService,
  ImageCacheService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { createShellFakes, flushAsync } from '../../../testing/shell-components-testing';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderComponent } from './header';

describe('HeaderComponent', () => {
  const CACHE_KEY = 'wtf_me_cache';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  async function setup(me?: Observable<{ firstName: string; lastName: string; imageUrl?: string | null }>) {
    const fakes = createShellFakes(me);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: fakes.auth },
        { provide: ConversationInboxService, useValue: fakes.inbox },
        { provide: ConnectivityService, useValue: fakes.connectivity },
        { provide: ImageCacheService, useValue: fakes.imageCache },
      ],
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const loading = TestBed.inject(AuthLoadingService);
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges(false);
    await flushAsync();
    await fixture.whenStable();
    // Profile fields are plain properties set after an await, so mark the view dirty explicitly.
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);
    const el = fixture.nativeElement as HTMLElement;
    const menu = (label: string) =>
      [...el.querySelectorAll('a[role="button"]')].find((a) =>
        a.textContent!.includes(label),
      ) as HTMLElement;
    return { fixture, el, fakes, router, navigate, loading, menu };
  }

  describe('the envelope and the avatar menu', () => {
    it('has the envelope beside the avatar, and starts the shared inbox', async () => {
      const { el, fakes } = await setup();

      expect(el.querySelector('app-staff-envelope [data-envelope]')).not.toBeNull();
      expect(fakes.inbox.start).toHaveBeenCalledTimes(1);
      const bar = el.querySelector('.navbar')!;
      const envelope = bar.querySelector('app-staff-envelope')!;
      const avatar = bar.querySelector('.dropdown:has([data-user-info])')!;
      expect(envelope.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps the name, role, status and clock out of the bar, in the avatar menu', async () => {
      const { el } = await setup();

      const info = el.querySelector('[data-user-info]') as HTMLElement;
      expect(info.closest('.dropdown-content')).not.toBeNull();
      expect(info.textContent).toContain('Jane Doe');
      expect(info.textContent).toContain('Admin');
      expect(info.textContent).toContain('Online');
      expect(el.querySelector('.navbar > .flex.items-center > .text-right')).toBeNull();
    });
  });

  it('loads the profile and shows the full name and role', async () => {
    const { el, loading, fakes } = await setup();
    expect(fakes.auth.getMe).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('Jane Doe');
    expect(el.textContent).toContain('Admin');
    expect(loading.loadingProfile()).toBe(false);
  });

  it('caches the profile in localStorage', async () => {
    await setup();
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
    });
  });

  it('shows the avatar fallback when there is no image', async () => {
    const { el, fakes } = await setup();
    expect(el.querySelector('app-avatar')).toBeTruthy();
    expect(el.querySelector('img[alt="User avatar"]')).toBeNull();
    expect(fakes.imageCache.cacheUrl).not.toHaveBeenCalled();
  });

  it('resolves, caches and shows the profile image', async () => {
    const { el, fakes } = await setup(
      of({ firstName: 'A', lastName: 'B', imageUrl: 'http://x/img.png' }),
    );
    expect(fakes.imageCache.resolveUrl).toHaveBeenCalledWith('http://x/img.png');
    expect(fakes.imageCache.cacheUrl).toHaveBeenCalledWith('http://x/img.png');
    expect(el.querySelector('img[alt="User avatar"]')!.getAttribute('src')).toBe(
      'resolved:http://x/img.png',
    );
    expect(el.querySelector('app-avatar')).toBeNull();
  });

  it('falls back to "User" when names are blank', async () => {
    const { el } = await setup(of({ firstName: '', lastName: '' }));
    expect(el.textContent).toContain('User');
  });

  it('falls back to the cached profile when loading fails', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ firstName: 'Cached', lastName: 'Person' }));
    const { el, loading } = await setup(throwError(() => new Error('offline')));
    expect(el.textContent).toContain('Cached Person');
    expect(loading.loadingProfile()).toBe(false);
  });

  it('uses defaults when load fails and the cache is corrupted', async () => {
    localStorage.setItem(CACHE_KEY, '{not json');
    const { el, loading } = await setup(throwError(() => new Error('offline')));
    expect(el.textContent).toContain('User');
    expect(el.textContent).toContain('Admin');
    expect(loading.loadingProfile()).toBe(false);
  });

  it('uses defaults when load fails and nothing is cached', async () => {
    const { el } = await setup(throwError(() => new Error('offline')));
    expect(el.textContent).toContain('User');
  });

  it('reloads the profile when meRefresh$ emits', async () => {
    const { fakes } = await setup();
    fakes.meRefresh$.next();
    await flushAsync();
    expect(fakes.auth.getMe).toHaveBeenCalledTimes(2);
  });

  it('shows online and offline status', async () => {
    const { fixture, el, fakes } = await setup();
    expect(el.textContent).toContain('Online');
    fakes.connectivity.isOnline.set(false);
    fixture.detectChanges();
    expect(el.textContent).toContain('Offline');
  });

  it('shows the app version', async () => {
    const { el } = await setup();
    expect(el.textContent).toMatch(/v\d+\.\d+\.\d+/);
  });

  it('navigates to the profile page', async () => {
    const { menu, navigate } = await setup();
    menu('My Profile').click();
    expect(navigate).toHaveBeenCalledWith(AppRoutes.MyProfile);
  });

  it('logs out and navigates to login with replaceUrl', async () => {
    const { menu, navigate, fakes } = await setup();
    menu('Logout').click();
    expect(fakes.auth.logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(AppRoutes.Login, { replaceUrl: true });
  });

  it('blurs the focused element after navigation ends', async () => {
    const { router, fixture } = await setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    (router.events as unknown as { next: (e: unknown) => void }).next(
      new NavigationEnd(1, '/a', '/a'),
    );
    expect(document.activeElement).not.toBe(input);
    input.remove();
    fixture.destroy();
  });

  it('ticks the clock every second and stops on destroy', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-01-01T10:00:00'));
    const { fixture, el } = await setup();
    expect(el.textContent).toContain('10:00:00 AM');

    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(el.textContent).toContain('10:00:02 AM');

    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
