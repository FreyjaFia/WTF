import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
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

function render(tenants: PlatformTenantDto[], queryParams: Record<string, string> = {}) {
  const platform = {
    getTenants: vi.fn().mockReturnValue(of(tenants)),
    createTenant: vi.fn().mockReturnValue(
      of({ tenant: shop({}), ownerUsername: 'moon.owner', temporaryPassword: 'Abc123xyz' }),
    ),
  };
  TestBed.configureTestingModule({
    imports: [PlatformTenantsComponent],
    providers: [
      provideRouter([]),
      { provide: PlatformService, useValue: platform },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { has: (k: string) => k in queryParams } } } },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PlatformTenantsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const buttonWith = (text: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(text));

  return { fixture, el, platform, buttonWith };
}

describe('PlatformTenantsComponent', () => {
  it('lists the shops with their status', () => {
    const { el } = render([shop({}), shop({ id: 't2', slug: 'sun', name: 'Sun', status: 3, statusName: 'Suspended' })]);

    expect(el.querySelector('[data-testid="shop-moonbrew"]')?.textContent).toContain('Active');
    expect(el.querySelector('[data-testid="shop-sun"]')?.textContent).toContain('Suspended');
  });

  it('filters the list by status and by the search box', () => {
    const { fixture, el, buttonWith } = render([
      shop({}),
      shop({ id: 't2', slug: 'sun', name: 'Sun', status: 3, statusName: 'Suspended' }),
    ]);

    buttonWith('Suspended')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="shop-moonbrew"]')).toBeNull();
    expect(el.querySelector('[data-testid="shop-sun"]')).not.toBeNull();

    buttonWith('All')!.click();
    const search = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'moon';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="shop-moonbrew"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="shop-sun"]')).toBeNull();
  });

  it('shows each status count on its filter', () => {
    const { buttonWith } = render([shop({}), shop({ id: 't2', slug: 'a' }), shop({ id: 't3', slug: 'b', status: 1 })]);

    expect(buttonWith('Active')!.textContent).toContain('2');
    expect(buttonWith('Trial')!.textContent).toContain('1');
  });

  it('opens the new shop form straight away when sent here from the overview', () => {
    const { el } = render([], { new: '1' });

    expect(el.querySelector('[aria-label="New shop"]')).not.toBeNull();
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
    el.querySelector('.modal-box form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(platform.createTenant).toHaveBeenCalledWith(expect.objectContaining({ slug: 'moonbrew', ownerUsername: 'moon.owner' }));
    expect(el.querySelector('[data-testid="secret-password"]')?.textContent).toBe('Abc123xyz');
  });
});
