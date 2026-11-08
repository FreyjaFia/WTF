import { TestBed } from '@angular/core/testing';
import { SubscriptionService } from '@core/services';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionPageComponent } from './subscription-page';

describe('SubscriptionPageComponent', () => {
  const lease = { periodEnd: '2027-01-31T00:00:00Z', graceDays: 5 };
  const invoice = {
    id: 'i1',
    planName: 'Standard',
    months: 3,
    periodStart: '2026-11-01T00:00:00Z',
    periodEnd: '2027-01-31T00:00:00Z',
    reference: 'INV-1',
    amount: 4500,
    statusName: 'Paid',
  };

  function setup(options: { warning?: string; hasLease?: boolean; invoices?: unknown[]; fails?: boolean } = {}) {
    const service = {
      leasePayload: () => (options.hasLease === false ? null : lease),
      warning: () => options.warning ?? 'none',
      daysLeft: () => 20,
      accessUntil: () => '2027-02-05T00:00:00Z',
      refresh: vi.fn(),
      getInvoices: vi.fn(() => (options.fails ? throwError(() => new Error('x')) : of(options.invoices ?? [invoice]))),
    };
    TestBed.configureTestingModule({ providers: [{ provide: SubscriptionService, useValue: service }] });
    const fixture = TestBed.createComponent(SubscriptionPageComponent);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement };
  }

  it('shows the plan status and one row per invoice', () => {
    const { el } = setup();
    const summary = el.querySelector('[data-testid="subscription-summary"]') as HTMLElement;
    expect(summary.textContent).toContain('Active');
    expect(summary.textContent).toContain('20 day(s) left');
    expect(el.querySelectorAll('[data-testid="invoice-row"]').length).toBe(1);
    expect(el.textContent).toContain('Standard, 3 month(s)');
    expect(el.textContent).toContain('INV-1');
  });

  it('colours the badge by how close the plan is to locking', () => {
    expect(setup({ warning: 'grace' }).el.querySelector('[data-testid="subscription-summary"] app-badge span')?.className).toContain('orange');
  });

  it('says so when there is no subscription limit, no invoices, or they fail to load', () => {
    expect(setup({ hasLease: false }).el.textContent).toContain('This shop has no subscription limit.');
    TestBed.resetTestingModule();
    expect(setup({ invoices: [] }).el.textContent).toContain('No invoices yet.');
    TestBed.resetTestingModule();
    expect(setup({ fails: true }).el.textContent).toContain('The invoices could not be loaded.');
  });
});
