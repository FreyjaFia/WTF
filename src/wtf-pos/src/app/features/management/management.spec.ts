import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '@core/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagementComponent } from './management';

@Component({ selector: 'app-stub-x', template: 'stub page' })
class Stub {}

const ALL = [
  'canReadProducts',
  'canReadCustomers',
  'canReadUsers',
  'canReadPromotions',
  'canAccessReports',
  'canAccessAuditLogs',
  'canAccessSchemaScriptHistory',
] as const;

describe('ManagementComponent', () => {
  let perms: Record<(typeof ALL)[number], boolean>;

  async function setup(url: string) {
    const auth = Object.fromEntries(ALL.map((k) => [k, () => perms[k]]));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'management',
            component: ManagementComponent,
            children: [
              { path: 'products', component: Stub },
              { path: 'customers', component: Stub },
              { path: 'users', component: Stub },
              { path: 'promotions', component: Stub },
              { path: 'reports', component: Stub },
              { path: 'audit-logs', component: Stub },
              { path: 'schema-scripts', component: Stub },
            ],
          },
        ]),
        { provide: AuthService, useValue: auth },
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    return { harness, el: harness.routeNativeElement as HTMLElement };
  }

  const tabs = (el: HTMLElement): HTMLAnchorElement[] =>
    Array.from(el.querySelectorAll<HTMLAnchorElement>('a[role="tab"]'));
  const routes = (el: HTMLElement): (string | null)[] =>
    tabs(el).map((t) => t.getAttribute('data-management-tab'));

  beforeEach(() => {
    perms = Object.fromEntries(ALL.map((k) => [k, true])) as typeof perms;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows all seven tabs in order for a fully privileged user', async () => {
    const { el } = await setup('/management/products');
    expect(routes(el)).toEqual([
      'products',
      'customers',
      'users',
      'promotions',
      'reports',
      'audit-logs',
      'schema-scripts',
    ]);
    expect(tabs(el)[0].getAttribute('href')).toBe('/management/products');
    expect(tabs(el)[6].getAttribute('href')).toBe('/management/schema-scripts');
  });

  it('hides audit and schema tabs for non-super admins', async () => {
    perms.canAccessAuditLogs = false;
    perms.canAccessSchemaScriptHistory = false;
    const { el } = await setup('/management/products');
    expect(routes(el)).toEqual(['products', 'customers', 'users', 'promotions', 'reports']);
  });

  it('hides each tab independently according to its permission', async () => {
    perms.canReadCustomers = false;
    perms.canReadPromotions = false;
    const { el } = await setup('/management/products');
    expect(routes(el)).toEqual(['products', 'users', 'reports', 'audit-logs', 'schema-scripts']);
  });

  it('renders nothing but the outlet without permissions', async () => {
    for (const key of ALL) {
      perms[key] = false;
    }
    const { el } = await setup('/management/products');
    expect(tabs(el)).toHaveLength(0);
    expect(el.textContent).toContain('stub page');
  });

  it('marks the active tab and follows navigation', async () => {
    const { harness, el } = await setup('/management/reports');
    const selected = (): (string | null)[] =>
      tabs(el)
        .filter((t) => t.getAttribute('aria-selected') === 'true')
        .map((t) => t.getAttribute('data-management-tab'));
    expect(selected()).toEqual(['reports']);
    await harness.navigateByUrl('/management/users');
    harness.detectChanges();
    expect(selected()).toEqual(['users']);
  });

  it('uses descriptive aria labels', async () => {
    const { el } = await setup('/management/products');
    expect(tabs(el).map((t) => t.getAttribute('aria-label'))).toEqual([
      'Products',
      'Customers',
      'Users',
      'Promotions',
      'Reports',
      'Audit Logs',
      'Schema Scripts',
    ]);
  });

  it('scrolls the active tab into view after routing', async () => {
    const { el } = await setup('/management/users');
    const scroll = vi.fn();
    tabs(el)[2].scrollIntoView = scroll;
    vi.runAllTimers();
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });
});
