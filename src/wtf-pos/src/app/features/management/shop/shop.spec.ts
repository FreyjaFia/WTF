import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@core/services';
import { describe, expect, it } from 'vitest';
import { ShopComponent } from './shop';

describe('ShopComponent', () => {
  function setup(brand: boolean, plan: boolean) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { canManageBrand: () => brand, canManageSubscription: () => plan } },
      ],
    });
    const fixture = TestBed.createComponent(ShopComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const link = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="shop-card-${id}"]`);

  it('lists a card for each section, like the Setup page, linking to its own page', () => {
    const el = setup(true, true);
    expect(el.querySelector('h1')?.textContent).toContain('Shop');
    expect(link(el, 'branding')?.getAttribute('href')).toBe('/management/shop/branding');
    expect(link(el, 'plan')?.getAttribute('href')).toBe('/management/shop/plan');
  });

  it('only lists the sections the person may use', () => {
    const el = setup(true, false);
    expect(link(el, 'branding')).not.toBeNull();
    expect(link(el, 'plan')).toBeNull();
  });
});
