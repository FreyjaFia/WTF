import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterOutlet } from '@angular/router';
import { AppWeb } from '@capacitor/app/dist/esm/web';
import { Capacitor, WebPlugin } from '@capacitor/core';
import { ModalStackService, OfflineOrderService, PushNotificationService } from '@core/services';
import { ExitConfirmComponent } from '@shared/components';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { internals } from './testing/feature-spec-helpers';

type BackHandler = (e: { canGoBack: boolean }) => void;

describe('App', () => {
  let push: { init: ReturnType<typeof vi.fn> };
  let location: { back: ReturnType<typeof vi.fn> };
  let handler: BackHandler | null;
  let remove: ReturnType<typeof vi.fn>;
  let exitApp: { mock: { calls: unknown[] } };

  function create() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PushNotificationService, useValue: push },
        { provide: OfflineOrderService, useValue: {} },
        { provide: Location, useValue: location },
      ],
    });
    TestBed.overrideComponent(App, {
      set: {
        imports: [RouterOutlet, ExitConfirmComponent],
        template: '<app-exit-confirm (confirmed)="onExitConfirmed()" /><router-outlet />',
      },
    });
    return TestBed.createComponent(App);
  }

  beforeEach(() => {
    push = { init: vi.fn() };
    location = { back: vi.fn() };
    handler = null;
    remove = vi.fn(() => Promise.resolve());
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.spyOn(WebPlugin.prototype, 'addListener').mockImplementation(((_: string, cb: BackHandler) => {
      handler = cb;
      return Promise.resolve({ remove });
    }) as unknown as WebPlugin['addListener']);
    exitApp = vi.spyOn(AppWeb.prototype, 'exitApp').mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initialises push notifications and, on the web, skips native setup', async () => {
    const fixture = create();
    await fixture.componentInstance.ngOnInit();
    expect(push.init).toHaveBeenCalledTimes(1);
    expect(WebPlugin.prototype.addListener).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('registers the back button on native platforms even if the status bar plugin fails', async () => {
    // StatusBar has no web implementation, so the real call rejects and must be swallowed.
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const fixture = create();
    await fixture.componentInstance.ngOnInit();
    expect(console.error).toHaveBeenCalledWith('StatusBar plugin error', expect.anything());
    expect(WebPlugin.prototype.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    expect(handler).not.toBeNull();
  });

  describe('back button', () => {
    async function nativeApp() {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      const fixture = create();
      fixture.detectChanges();
      await fixture.componentInstance.ngOnInit();
      return fixture;
    }

    it('closes the top modal first', async () => {
      await nativeApp();
      const close = vi.fn();
      TestBed.inject(ModalStackService).push(close);
      handler!({ canGoBack: true });
      expect(close).toHaveBeenCalledTimes(1);
      expect(location.back).not.toHaveBeenCalled();
    });

    it('navigates back when history exists and no modal is open', async () => {
      await nativeApp();
      handler!({ canGoBack: true });
      expect(location.back).toHaveBeenCalledTimes(1);
    });

    it('opens the exit confirmation at the root', async () => {
      const fixture = await nativeApp();
      handler!({ canGoBack: false });
      fixture.detectChanges();
      expect(location.back).not.toHaveBeenCalled();
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(true);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('app-confirm-dialog'),
      ).not.toBeNull();
    });
  });

  it('exits the app when the exit confirmation is confirmed', async () => {
    const fixture = create();
    internals(fixture.componentInstance)['onExitConfirmed']();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('removes the back button listener on destroy', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const fixture = create();
    await fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.ngOnDestroy();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('destroys cleanly when no listener was registered', async () => {
    const fixture = create();
    await expect(fixture.componentInstance.ngOnDestroy()).resolves.toBeUndefined();
  });
});
