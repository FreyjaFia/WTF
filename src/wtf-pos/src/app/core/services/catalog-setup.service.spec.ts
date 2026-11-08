import { environment } from '@environments/environment.development';
import { CatalogSetupDto } from '@shared/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpErrorMessages } from '@core/messages';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { CatalogLookupService } from './catalog-lookup.service';
import { CatalogSetupService } from './catalog-setup.service';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CatalogSetupService', () => {
  const url = `${environment.apiUrl}/catalog`;
  const setup: CatalogSetupDto = {
    categories: [
      {
        id: 1,
        name: 'Drink',
        sortOrder: 1,
        isActive: true,
        productCount: 3,
        subCategories: [
          {
            id: 10,
            name: 'Coffee',
            categoryId: 1,
            sortOrder: 1,
            isActive: true,
            productCount: 3,
          },
        ],
      },
    ],
    unassignedSubCategories: [
      { id: 11, name: 'Loose', categoryId: null, sortOrder: 2, isActive: true, productCount: 0 },
    ],
    addOnTypes: [
      {
        id: 1,
        name: 'Size',
        isRequired: true,
        minSelect: 1,
        maxSelect: 1,
        sortOrder: 1,
        isActive: true,
        productCount: 2,
      },
    ],
  };

  it('loads the setup and shares the lists with the lookup service', () => {
    const { service, http } = setupHttpService(CatalogSetupService);
    const lookups = (service as unknown as { lookups: CatalogLookupService }).lookups;
    const result = capture(service.getSetup());
    const req = http.expectOne(url);
    expect(req.request.method).toBe('GET');
    req.flush(setup);

    expect(result.value).toEqual(setup);
    expect(lookups.categories().map((c) => c.name)).toEqual(['Drink']);
    expect(lookups.subCategories().map((s) => s.name)).toEqual(['Coffee', 'Loose']);
    expect(lookups.addOnTypes().map((t) => t.name)).toEqual(['Size']);
    http.verify();
  });

  it('turns a failed load into a readable error', () => {
    const { service, http } = setupHttpService(CatalogSetupService);
    const result = capture(service.getSetup());
    failWith(http.expectOne(url), 500);

    expect(result.error).toBeTruthy();
  });

  it('reports a dropped connection with the shared network message', () => {
    const { service, http } = setupHttpService(CatalogSetupService);
    const result = capture(service.getSetup());
    failNetwork(http.expectOne(url));

    expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
  });

  it('creates with POST and updates with PUT', () => {
    const { service, http } = setupHttpService(CatalogSetupService);
    capture(service.saveCategory(null, { name: 'Bakery', sortOrder: 5 }));
    const create = http.expectOne(`${url}/categories`);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'Bakery', sortOrder: 5 });
    create.flush({ id: 9 });

    capture(service.saveCategory(9, { name: 'Bakery', sortOrder: 6 }));
    const update = http.expectOne(`${url}/categories/9`);
    expect(update.request.method).toBe('PUT');
    update.flush({ id: 9 });

    capture(service.saveSubCategory(null, { name: 'Tea', categoryId: 1, sortOrder: 3 }));
    http.expectOne(`${url}/subcategories`).flush({ id: 12 });
    capture(service.saveSubCategory(12, { name: 'Tea', categoryId: 1, sortOrder: 3 }));
    expect(http.expectOne(`${url}/subcategories/12`).request.method).toBe('PUT');

    const type = {
      name: 'Temperature',
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 6,
    };
    capture(service.saveAddOnType(null, type));
    const typeReq = http.expectOne(`${url}/addon-types`);
    expect(typeReq.request.body).toEqual(type);
    typeReq.flush({ id: 6 });
    capture(service.saveAddOnType(6, type));
    expect(http.expectOne(`${url}/addon-types/6`).request.method).toBe('PUT');
    http.verify();
  });

  it('switches entries on and off with PUT /active', () => {
    const { service, http } = setupHttpService(CatalogSetupService);
    capture(service.setCategoryActive(1, false));
    const cat = http.expectOne(`${url}/categories/1/active`);
    expect(cat.request.method).toBe('PUT');
    expect(cat.request.body).toEqual({ isActive: false });
    cat.flush(null);

    capture(service.setSubCategoryActive(2, true));
    expect(http.expectOne(`${url}/subcategories/2/active`).request.body).toEqual({
      isActive: true,
    });
    capture(service.setAddOnTypeActive(3, false));
    expect(http.expectOne(`${url}/addon-types/3/active`).request.body).toEqual({
      isActive: false,
    });
  });

  it('passes the server message on a refused save', () => {
    const { service, http } = setupHttpService(CatalogSetupService);
    const result = capture(service.saveCategory(null, { name: 'Drink', sortOrder: 1 }));
    failWith(http.expectOne(`${url}/categories`), 400, { message: 'That name is taken.' });

    expect(result.error).toBe('That name is taken.');
  });
});
