import { environment } from '@environments/environment.development';
import { describe, expect, it } from 'vitest';
import { setupHttpService } from '../../testing/service-testing';
import { BrandService } from './brand.service';

describe('BrandService', () => {
  const brand = {
    shopName: 'Moon Brew',
    shortName: 'Moon',
    tagline: null,
    logoUrl: null,
    address: null,
    phone: null,
    primaryColor: '#112233',
  };

  it('uses WTF until a brand is loaded', () => {
    const { service } = setupHttpService(BrandService);
    expect(service.displayName()).toBe('WTF');
  });

  it('shows the short name once the shop brand loads', () => {
    const { service, http } = setupHttpService(BrandService);
    service.load();
    http.expectOne(`${environment.apiUrl}/settings/brand`).flush(brand);
    expect(service.displayName()).toBe('Moon');
    expect(document.title).toBe('Moon Brew POS');
  });

  it('loads the brand of a customer link', () => {
    const { service, http } = setupHttpService(BrandService);
    service.loadPublic('abc');
    http.expectOne(`${environment.apiUrl}/public/order-links/abc/brand`).flush({ ...brand, shortName: null });
    expect(service.displayName()).toBe('Moon Brew');
  });
});
