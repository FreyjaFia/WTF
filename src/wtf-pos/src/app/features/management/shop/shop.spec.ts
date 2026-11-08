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

  it('shows the page header and both tabs to someone who can manage both', () => {
    const el = setup(true, true);
    expect(el.querySelector('h1')?.textContent).toContain('Shop');
    expect(el.querySelector('[data-testid="shop-tab-branding"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="shop-tab-plan"]')).not.toBeNull();
  });

  it('only shows the tabs the person may use', () => {
    const el = setup(true, false);
    expect(el.querySelector('[data-testid="shop-tab-branding"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="shop-tab-plan"]')).toBeNull();
  });
});
