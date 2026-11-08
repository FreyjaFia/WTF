import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService, BrandService } from '@core/services';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BrandPageComponent } from './brand-page';

describe('BrandPageComponent', () => {
  const brand = {
    shopName: 'Moon Brew',
    shortName: null,
    tagline: null,
    logoUrl: null as string | null,
    address: null,
    phone: null,
    email: null,
    receiptHeader: null,
    receiptFooter: null,
    registrationText: null,
    primaryColor: '#112233',
  };

  function setup() {
    const service = {
      getForEdit: vi.fn(() => of(brand)),
      save: vi.fn((b: unknown) => of(b)),
      uploadLogo: vi.fn(() => of({ ...brand, logoUrl: 'https://x/logo.png' })),
      removeLogo: vi.fn(() => of(brand)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: BrandService, useValue: service },
        { provide: AlertService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(BrandPageComponent);
    fixture.detectChanges();
    return { fixture, service, el: fixture.nativeElement as HTMLElement };
  }

  it('loads the shop details and has no time zone or currency fields', () => {
    const { el } = setup();
    expect((el.querySelector('[data-testid="brand-shopName"]') as HTMLInputElement).value).toBe('Moon Brew');
    expect(el.textContent).not.toContain('Time zone');
    expect(el.textContent).not.toContain('Currency');
  });

  it('uploads a logo and shows it, then removes it', () => {
    const { fixture, service, el } = setup();
    const input = el.querySelector('[data-testid="brand-logo-input"]') as HTMLInputElement;
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(service.uploadLogo).toHaveBeenCalledWith(file);
    expect(el.querySelector('img')?.getAttribute('src')).toBe('https://x/logo.png');

    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Remove')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(service.removeLogo).toHaveBeenCalled();
    expect(el.querySelector('img')).toBeNull();
  });
});
