import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService, ConnectivityService, ImageCacheService } from '@core/services';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShellFakes } from '../../../testing/shell-components-testing';
import { LayoutComponent } from './layout';

@Component({ template: '<p class="routed">Routed page</p>' })
class RoutedPageComponent {}

describe('LayoutComponent', () => {
  let listeners: Map<string, () => void>;
  let matches: boolean;
  let observed: Element[];
  let disconnected: boolean;
  let resizeCallback: (() => void) | null;

  beforeEach(() => {
    listeners = new Map();
    matches = true;
    observed = [];
    disconnected = false;
    resizeCallback = null;

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return matches;
        },
        addEventListener: (type: string, cb: () => void) => listeners.set(type, cb),
        removeEventListener: (type: string) => listeners.delete(type),
      })),
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public constructor(cb: () => void) {
          resizeCallback = cb;
        }
        public observe(el: Element): void {
          observed.push(el);
        }
        public disconnect(): void {
          disconnected = true;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--sidebar-width');
  });

  function setup() {
    const fakes = createShellFakes();
    const auth = { ...fakes.auth, isLoggedIn$: new BehaviorSubject(true) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: RoutedPageComponent }]),
        { provide: AuthService, useValue: auth },
        { provide: ConnectivityService, useValue: fakes.connectivity },
        { provide: ImageCacheService, useValue: fakes.imageCache },
      ],
    });
    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('composes banner, sidebar, header, outlet and dock', () => {
    const { el } = setup();
    expect(el.querySelector('app-offline-banner')).toBeTruthy();
    expect(el.querySelector('app-sidebar')).toBeTruthy();
    expect(el.querySelector('app-header')).toBeTruthy();
    expect(el.querySelector('router-outlet')).toBeTruthy();
    expect(el.querySelector('app-dock')).toBeTruthy();
  });

  it('renders routed content in the outlet', async () => {
    const { fixture, el } = setup();
    await TestBed.inject(Router).navigateByUrl('/');
    fixture.detectChanges();
    expect(el.querySelector('.routed')?.textContent).toBe('Routed page');
  });

  it('observes the sidebar host and sets the sidebar width variable', () => {
    const { el } = setup();
    expect(observed.length).toBe(1);
    expect(observed[0].querySelector('app-sidebar')).toBeTruthy();
    expect(el.style.getPropertyValue('--sidebar-width')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('0px');
  });

  it('measures the sidebar width on resize when the media query matches', () => {
    const { el } = setup();
    vi.spyOn(observed[0], 'getBoundingClientRect').mockReturnValue({ width: 240.4 } as DOMRect);
    resizeCallback!();
    expect(el.style.getPropertyValue('--sidebar-width')).toBe('240px');
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('240px');
  });

  it('resets the width to 0 when the media query stops matching', () => {
    const { el } = setup();
    vi.spyOn(observed[0], 'getBoundingClientRect').mockReturnValue({ width: 240 } as DOMRect);
    resizeCallback!();
    matches = false;
    listeners.get('change')!();
    expect(el.style.getPropertyValue('--sidebar-width')).toBe('0px');
  });

  it('disconnects the observer and removes the listener on destroy', () => {
    const { fixture } = setup();
    expect(listeners.has('change')).toBe(true);
    fixture.destroy();
    expect(disconnected).toBe(true);
    expect(listeners.has('change')).toBe(false);
  });
});
