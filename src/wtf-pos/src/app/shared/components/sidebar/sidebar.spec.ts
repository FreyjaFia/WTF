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
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShellFakes, flushAsync } from '../../../testing/shell-components-testing';
import { SidebarComponent } from './sidebar';

describe('SidebarComponent', () => {
  const CACHE_KEY = 'wtf_me_cache';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  async function setup(
    me?: Observable<{ firstName: string; lastName: string; imageUrl?: string | null }>,
    denied: string[] = [],
  ) {
    const fakes = createShellFakes(me);
    denied.forEach((name) => (fakes.permissions[name] = false));
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
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges(false);
    await flushAsync();
    await fixture.whenStable();
    // Profile fields are plain properties set after an await, so mark the view dirty explicitly.
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);
    const el = fixture.nativeElement as HTMLElement;
    const byText = (selector: string, label: string) =>
      [...el.querySelectorAll(selector)].find((n) => n.textContent!.includes(label)) as
        | HTMLElement
        | undefined;
    const linkLabels = () =>
      [...el.querySelectorAll('nav a')].map((a) => a.textContent!.replace(/\s+/g, ' ').trim());
    return { fixture, el, fakes, router, navigate, loading, byText, linkLabels };
  }

  describe('which order link is lit', () => {
    const lit = (el: HTMLElement) =>
      [...el.querySelectorAll('nav a.sidebar-active')].map((a) =>
        a.textContent!.replace(/\s+/g, ' ').trim(),
      );

    it.each([
      ['/orders/list', ['Orders']],
      ['/orders/details/abc', ['Orders']],
      ['/orders/editor/abc', ['New Order']],
      ['/orders/editor?offline=OFF-1', ['New Order']],
      ['/orders/editor', ['New Order']],
    ])('at %s', async (url, expected) => {
      const { fixture, el, router } = await setup();
      router.resetConfig([{ path: '**', children: [] }]);
      (router.navigateByUrl as unknown as { mockRestore?: () => void }).mockRestore?.();
      await router.navigateByUrl(url);
      await fixture.whenStable();
      fixture.detectChanges(false);
      expect(lit(el)).toEqual(expected);
    });
  });

  describe('the envelope', () => {
    it('sits in the top row beside the logo, above the user block', async () => {
      const { el, fakes } = await setup();

      const top = el.querySelector('aside > div')!;
      expect(top.querySelector('app-staff-envelope [data-envelope]')).not.toBeNull();
      expect(top.textContent).toContain('WTF');
      expect(fakes.inbox.start).toHaveBeenCalledTimes(1);
    });

    it('stacks under the logo when the sidebar is collapsed', async () => {
      const { el, fixture } = await setup();
      const aside = el.querySelector('aside') as HTMLElement;
      const row = aside.querySelector('aside > div > div') as HTMLElement;
      expect(row.className).toContain('justify-between');

      (fixture.componentInstance as unknown as { isCollapsed: { set: (v: boolean) => void } }).isCollapsed.set(true);
      fixture.detectChanges();

      expect(row.className).toContain('flex-col');
      expect(row.className).not.toContain('justify-between');
    });
  });

  it('loads the profile and shows name and role', async () => {
    const { el, loading, fakes } = await setup();
    expect(fakes.auth.getMe).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('Jane Doe');
    expect(el.textContent).toContain('Admin');
    expect(loading.loadingProfile()).toBe(false);
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).firstName).toBe('Jane');
  });

  it('shows the resolved avatar image when the profile has one', async () => {
    const { el, fakes } = await setup(
      of({ firstName: 'A', lastName: 'B', imageUrl: 'http://x/a.png' }),
    );
    expect(fakes.imageCache.cacheUrl).toHaveBeenCalledWith('http://x/a.png');
    expect(el.querySelector('img')!.getAttribute('src')).toBe('resolved:http://x/a.png');
  });

  it('falls back to the cached profile on error', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ firstName: 'Old', lastName: 'Me' }));
    const { el, loading } = await setup(throwError(() => new Error('x')));
    expect(el.textContent).toContain('Old Me');
    expect(loading.loadingProfile()).toBe(false);
  });

  it('uses defaults when the cache is corrupted', async () => {
    localStorage.setItem(CACHE_KEY, 'nope');
    const { el } = await setup(throwError(() => new Error('x')));
    expect(el.textContent).toContain('User');
  });

  it('reloads on meRefresh$', async () => {
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

  it('shows permitted navigation entries', async () => {
    const { linkLabels } = await setup();
    const labels = linkLabels().join('|');
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('New Order');
    expect(labels).toContain('Orders');
    expect(labels).toContain('Items');
    expect(labels).toContain('Products');
  });

  it('hides sections the user cannot access', async () => {
    const { linkLabels, el } = await setup(undefined, [
      'canWriteOrders',
      'canReadInventory',
      'canReadManagement',
    ]);
    const labels = linkLabels().join('|');
    expect(labels).not.toContain('New Order');
    expect(labels).not.toContain('Items');
    expect(labels).not.toContain('Products');
    expect(el.textContent).not.toContain('Inventory');
    expect(el.textContent).not.toContain('Management');
  });

  it('hides individual items without permission', async () => {
    const { linkLabels } = await setup(undefined, ['canReadProducts']);
    expect(linkLabels().join('|')).not.toContain('Products');
  });

  it('toggles the inventory and management groups', async () => {
    const { fixture, byText, el } = await setup();
    const inventoryBtn = byText('button', 'Inventory')!;
    const group = () => el.querySelector('.max-h-40, .max-h-0') as HTMLElement;
    expect(group().classList).toContain('max-h-40');
    inventoryBtn.click();
    fixture.detectChanges();
    expect(group().classList).toContain('max-h-0');
    inventoryBtn.click();
    fixture.detectChanges();
    expect(group().classList).toContain('max-h-40');

    const mgmtBtn = byText('button', 'Management')!;
    const mgmt = () => el.querySelector('.max-h-96, .max-h-0.opacity-0:not(.max-h-40)') as HTMLElement;
    expect(el.querySelector('.max-h-96')).toBeTruthy();
    mgmtBtn.click();
    fixture.detectChanges();
    expect(el.querySelector('.max-h-96')).toBeNull();
    expect(mgmt()).toBeTruthy();
  });

  it('collapses and expands the sidebar', async () => {
    const { fixture, el } = await setup();
    const aside = el.querySelector('aside')!;
    const toggle = () => el.querySelector('[aria-label$="sidebar"]') as HTMLButtonElement;

    expect(aside.classList).toContain('w-60');
    expect(toggle().getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(el.textContent).toContain('POS');

    toggle().click();
    fixture.detectChanges();
    expect(aside.classList).toContain('w-21');
    expect(aside.classList).toContain('sidebar-collapsed');
    expect(toggle().getAttribute('aria-label')).toBe('Expand sidebar');
    expect(el.textContent).not.toContain('POS');

    toggle().click();
    fixture.detectChanges();
    expect(aside.classList).toContain('w-60');
  });

  it('navigates to my profile', async () => {
    const { byText, navigate } = await setup();
    byText('a[role="button"]', 'My Profile')!.click();
    expect(navigate).toHaveBeenCalledWith(AppRoutes.MyProfile);
  });

  it('asks for confirmation before logging out', async () => {
    const { fixture, byText, el, fakes, navigate } = await setup();
    expect(el.querySelector('app-confirm-dialog')).toBeNull();

    byText('a[role="button"]', 'Logout')!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-confirm-dialog')).toBeTruthy();
    expect(fakes.auth.logout).not.toHaveBeenCalled();

    byText('app-confirm-dialog button', 'Log out')!.click();
    fixture.detectChanges();
    expect(fakes.auth.logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(AppRoutes.Login, { replaceUrl: true });
    expect(el.querySelector('app-confirm-dialog')).toBeNull();
  });

  it('closes the logout dialog on cancel without logging out', async () => {
    const { fixture, byText, el, fakes } = await setup();
    byText('a[role="button"]', 'Logout')!.click();
    fixture.detectChanges();

    byText('app-confirm-dialog button', 'Cancel')!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-confirm-dialog')).toBeNull();
    expect(fakes.auth.logout).not.toHaveBeenCalled();
  });

  it('blurs the focused element after navigation ends', async () => {
    const { router } = await setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    (router.events as unknown as { next: (e: unknown) => void }).next(
      new NavigationEnd(1, '/a', '/a'),
    );
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it('ticks the clock and stops on destroy', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-01-01T10:00:00'));
    const { fixture, el } = await setup();
    expect(el.textContent).toContain('10:00 AM');

    vi.advanceTimersByTime(120000);
    fixture.detectChanges();
    expect(el.textContent).toContain('10:02 AM');

    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
