import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PlatformService } from '@core/services';
import { PlatformTenantDto } from '@shared/models/platform.models';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PlatformTenantsComponent } from './platform-tenants';

const shop = (over: Partial<PlatformTenantDto>): PlatformTenantDto => ({
  id: 't1',
  name: 'Moon Brew',
  slug: 'moonbrew',
  status: 2,
  statusName: 'Active',
  createdAt: '2026-11-01T00:00:00Z',
  userCount: 3,
  orderCount: 10,
  lastOrderAt: null,
  ...over,
});

function render(tenants: PlatformTenantDto[]) {
  const platform = {
    getTenants: vi.fn().mockReturnValue(of(tenants)),
    createTenant: vi.fn().mockReturnValue(
      of({ tenant: shop({}), ownerUsername: 'moon.owner', temporaryPassword: 'Abc123xyz' }),
    ),
    changeStatus: vi.fn().mockReturnValue(of(shop({}))),
    getDeletionPreview: vi.fn().mockReturnValue(of({ tenantId: 't1', slug: 'moonbrew', status: 3, rowCounts: { Users: 2 } })),
    deleteTenant: vi.fn().mockReturnValue(of({})),
    getUsers: vi.fn().mockReturnValue(of([])),
    logout: vi.fn(),
  };
  const router = { navigateByUrl: vi.fn() };
  TestBed.configureTestingModule({
    imports: [PlatformTenantsComponent],
    providers: [
      { provide: PlatformService, useValue: platform },
      { provide: Router, useValue: router },
    ],
  });
  const fixture = TestBed.createComponent(PlatformTenantsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const buttonWith = (text: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

  return { fixture, el, platform, router, buttonWith };
}

describe('PlatformTenantsComponent', () => {
  it('lists the shops with their status', () => {
    const { el } = render([shop({}), shop({ id: 't2', slug: 'sun', name: 'Sun', status: 3, statusName: 'Suspended' })]);

    expect(el.querySelector('[data-testid="shop-moonbrew"]')?.textContent).toContain('Active');
    expect(el.querySelector('[data-testid="shop-sun"]')?.textContent).toContain('Suspended');
  });

  it('offers Delete permanently only for a suspended or cancelled shop', () => {
    const live = render([shop({})]);
    expect(live.buttonWith('Delete permanently')).toBeUndefined();
    expect(live.buttonWith('Suspend')).toBeDefined();
    TestBed.resetTestingModule();

    const suspended = render([shop({ status: 3, statusName: 'Suspended' })]);
    expect(suspended.buttonWith('Delete permanently')).toBeDefined();
    expect(suspended.buttonWith('Resume')).toBeDefined();
    expect(suspended.buttonWith('Suspend')).toBeUndefined();
  });

  it('shows the one-time password after a shop is created', () => {
    const { fixture, el, platform, buttonWith } = render([]);

    buttonWith('New shop')!.click();
    fixture.detectChanges();
    const values: Record<string, string> = {
      name: 'Moon Brew',
      slug: 'moonbrew',
      ownerFirstName: 'Mo',
      ownerLastName: 'On',
      ownerUsername: 'moon.owner',
    };
    for (const [name, value] of Object.entries(values)) {
      const input = el.querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(platform.createTenant).toHaveBeenCalledWith(expect.objectContaining({ slug: 'moonbrew', ownerUsername: 'moon.owner' }));
    expect(el.querySelector('[data-testid="secret-password"]')?.textContent).toBe('Abc123xyz');
  });

  it('needs the typed address and a password before the delete button works, and shows the row counts', () => {
    const { fixture, el, platform, buttonWith } = render([shop({ status: 3, statusName: 'Suspended' })]);

    buttonWith('Delete permanently')!.click();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="delete-counts"]')?.textContent).toContain('Users: 2');
    const submit = el.querySelector<HTMLButtonElement>('.modal-box button[type="submit"]')!;
    expect(submit.disabled).toBe(true);

    const type = (name: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('slug', 'moonbrew');
    type('password', 'pw');
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);

    el.querySelector('.modal-box form')!.dispatchEvent(new Event('submit'));
    expect(platform.deleteTenant).toHaveBeenCalledWith('t1', 'moonbrew', 'pw');
  });

  it('signs out back to the platform login', () => {
    const { buttonWith, platform, router } = render([]);

    buttonWith('Sign out')!.click();

    expect(platform.logout).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/platform/login', { replaceUrl: true });
  });
});
