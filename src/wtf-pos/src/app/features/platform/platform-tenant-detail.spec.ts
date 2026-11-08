import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AlertService, PlatformService } from '@core/services';
import { PlatformTenantDto } from '@shared/models/platform.models';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PlatformTenantDetailComponent } from './platform-tenant-detail';

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

function render(tenant: PlatformTenantDto, id = 't1') {
  const platform = {
    getTenants: vi.fn().mockReturnValue(of([tenant])),
    changeStatus: vi.fn().mockReturnValue(of(tenant)),
    getUsers: vi.fn().mockReturnValue(
      of([
        { id: 'u1', username: 'moon.owner', firstName: 'Mo', lastName: 'On', role: 'Admin', isActive: true },
        { id: 'u2', username: 'off.user', firstName: 'Of', lastName: 'F', role: 'Cashier', isActive: false },
      ]),
    ),
    resetPassword: vi.fn().mockReturnValue(of({ username: 'moon.owner', temporaryPassword: 'Tmp12345' })),
    getDeletionPreview: vi.fn().mockReturnValue(of({ tenantId: 't1', slug: 'moonbrew', status: 3, rowCounts: { Users: 2 } })),
    deleteTenant: vi.fn().mockReturnValue(of({})),
    getBrand: vi.fn().mockReturnValue(
      of({ shopName: 'Moon Brew', shortName: null, tagline: null, logoUrl: null, address: null, phone: null, email: null, receiptHeader: null, receiptFooter: null, registrationText: null, primaryColor: '#112233' }),
    ),
    setBrand: vi.fn().mockImplementation((_id: string, brand: unknown) => of(brand)),
  };
  TestBed.configureTestingModule({
    imports: [PlatformTenantDetailComponent],
    providers: [
      provideRouter([]),
      { provide: PlatformService, useValue: platform },
      { provide: AlertService, useValue: { success: vi.fn(), error: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => id } } } },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PlatformTenantDetailComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const buttonWith = (text: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  const tab = (name: string) => {
    el.querySelector<HTMLButtonElement>(`[data-testid="tab-${name}"]`)!.click();
    fixture.detectChanges();
  };

  return { fixture, el, platform, buttonWith, tab };
}

describe('PlatformTenantDetailComponent', () => {
  it('shows the shop name and says so when the shop does not exist', () => {
    expect(render(shop({})).el.querySelector('[data-testid="shop-title"]')?.textContent).toContain('Moon Brew');
    TestBed.resetTestingModule();

    expect(render(shop({}), 'other').el.textContent).toContain('That shop was not found');
  });

  it('offers Delete permanently only for a suspended or cancelled shop', () => {
    const live = render(shop({}));
    expect(live.buttonWith('Delete permanently')).toBeUndefined();
    expect(live.buttonWith('Suspend')).toBeDefined();
    TestBed.resetTestingModule();

    const suspended = render(shop({ status: 3, statusName: 'Suspended' }));
    expect(suspended.buttonWith('Delete permanently')).toBeDefined();
    expect(suspended.buttonWith('Resume')).toBeDefined();
    expect(suspended.buttonWith('Suspend')).toBeUndefined();
  });

  it('needs a reason of 5 characters before a suspension is confirmed', () => {
    const { fixture, el, platform, buttonWith } = render(shop({}));

    buttonWith('Suspend')!.click();
    fixture.detectChanges();
    const submit = el.querySelector<HTMLButtonElement>('.modal-box button[type="submit"]')!;
    expect(submit.disabled).toBe(true);

    const input = el.querySelector<HTMLInputElement>('[formControlName="reason"]')!;
    input.value = 'late payment';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('.modal-box form')!.dispatchEvent(new Event('submit'));

    expect(platform.changeStatus).toHaveBeenCalledWith('t1', 'suspend', 'late payment');
  });

  it('lists the people and shows the one-time password after a reset', () => {
    const { fixture, el, platform, buttonWith, tab } = render(shop({}));

    tab('people');
    expect(platform.getUsers).toHaveBeenCalledWith('t1');
    expect(el.querySelector('[data-testid="people-list"]')?.textContent).toContain('moon.owner');
    expect(el.querySelectorAll('[data-testid="people-list"] button').length).toBe(3);

    buttonWith('Reset password')!.click();
    fixture.detectChanges();
    expect(platform.resetPassword).toHaveBeenCalledWith('t1', 'u1');
    expect(el.querySelector('[data-testid="secret-password"]')?.textContent).toBe('Tmp12345');
  });

  it('needs the typed address and a password before the delete button works, and shows the row counts', () => {
    const { fixture, el, platform, buttonWith } = render(shop({ status: 3, statusName: 'Suspended' }));

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

  it('loads the shop brand and saves an edit', () => {
    const { fixture, el, platform, tab } = render(shop({}));

    tab('brand');
    expect(platform.getBrand).toHaveBeenCalledWith('t1');
    const name = el.querySelector<HTMLInputElement>('[data-testid="brand-form"] [formControlName="shopName"]')!;
    expect(name.value).toBe('Moon Brew');

    name.value = 'Moon Brew Two';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('[data-testid="brand-form"]')!.dispatchEvent(new Event('submit'));

    expect(platform.setBrand).toHaveBeenCalledWith('t1', expect.objectContaining({ shopName: 'Moon Brew Two', primaryColor: '#112233' }));
  });
});
