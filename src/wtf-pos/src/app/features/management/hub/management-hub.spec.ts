import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@core/services';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManagementHubComponent } from './management-hub';

const ALL = [
  'canReadProducts',
  'canReadCustomers',
  'canReadUsers',
  'canManageRoles',
  'canReadPromotions',
  'canAccessReports',
  'canAccessAuditLogs',
  'canAccessSchemaScriptHistory',
  'canReadExpenses',
  'canManageSubscription',
  'canManageBrand',
  'canOpenSetup',
] as const;

describe('ManagementHubComponent', () => {
  let perms: Record<(typeof ALL)[number], boolean>;

  function render(): HTMLElement {
    const auth = Object.fromEntries(ALL.map((k) => [k, () => perms[k]]));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
    const fixture = TestBed.createComponent(ManagementHubComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const ids = (el: HTMLElement): (string | null)[] =>
    Array.from(el.querySelectorAll('[data-testid^="management-card-"]')).map(
      (a) => a.getAttribute('data-testid')?.replace('management-card-', '') ?? null,
    );
  const headings = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('h2')).map((h) => h.textContent?.trim() ?? '');

  beforeEach(() => {
    perms = Object.fromEntries(ALL.map((k) => [k, true])) as typeof perms;
  });

  it('shows every card in five groups for a fully privileged user', () => {
    const el = render();
    expect(headings(el)).toEqual(['Sell', 'Money', 'People', 'Settings', 'System']);
    expect(ids(el)).toEqual([
      'products',
      'promotions',
      'customers',
      'reports',
      'expenses',
      'users',
      'roles',
      'setup',
      'shop',
      'audit-logs',
      'schema-scripts',
    ]);
    expect(el.querySelector('[data-testid="management-card-roles"]')?.getAttribute('href')).toBe(
      '/management/roles',
    );
  });

  it('hides a card without its permission and drops a group that ends up empty', () => {
    perms.canReadExpenses = false;
    perms.canAccessReports = false;
    perms.canAccessAuditLogs = false;
    perms.canAccessSchemaScriptHistory = false;
    const el = render();
    expect(headings(el)).toEqual(['Sell', 'People', 'Settings']);
    expect(ids(el)).not.toContain('expenses');
  });

  it('shows only Setup for a stock manager', () => {
    for (const key of ALL) {
      perms[key] = key === 'canOpenSetup';
    }
    const el = render();
    expect(ids(el)).toEqual(['setup']);
    expect(headings(el)).toEqual(['Settings']);
  });

  it('shows no cards when nothing is allowed', () => {
    for (const key of ALL) {
      perms[key] = false;
    }
    expect(ids(render())).toEqual([]);
  });

  it('shows an icon on every card, taken from the card list', () => {
    const el = render();
    const cards = Array.from(el.querySelectorAll('[data-testid^="management-card-"]'));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const href = card.querySelector('app-icon use')?.getAttribute('xlink:href');
      expect(href).toMatch(/^#icon-/);
    }
  });
});
