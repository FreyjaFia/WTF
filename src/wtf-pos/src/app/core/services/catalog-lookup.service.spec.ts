import { environment } from '@environments/environment.development';
import { describe, expect, it } from 'vitest';
import { SEEDED_LOOKUPS } from '../../testing/catalog-ids';
import { failNetwork, setupHttpService } from '../../testing/service-testing';
import { CatalogLookupService } from './catalog-lookup.service';

describe('CatalogLookupService', () => {
  it('starts empty and not loaded', () => {
    const { service } = setupHttpService(CatalogLookupService);
    expect(service.categories()).toEqual([]);
    expect(service.loaded()).toBe(false);
    expect(service.categoryName(1)).toBe('');
    expect(service.addOnRule(1)).toBeNull();
  });

  it('keeps the lists sorted by sort order and ignores a missing payload', () => {
    const { service } = setupHttpService(CatalogLookupService);
    service.set(undefined);
    expect(service.loaded()).toBe(false);

    service.set({
      categories: [
        { id: 2, name: 'Food', sortOrder: 2, isActive: true },
        { id: 1, name: 'Drink', sortOrder: 1, isActive: true },
        { id: 3, name: 'Old', sortOrder: 3, isActive: false },
      ],
      subCategories: [],
      addOnTypes: [],
    });

    expect(service.categories().map((c) => c.name)).toEqual(['Drink', 'Food', 'Old']);
    expect(service.activeCategories().map((c) => c.name)).toEqual(['Drink', 'Food']);
    expect(service.loaded()).toBe(true);
  });

  it('looks up names and add-on rules by id', () => {
    const { service } = setupHttpService(CatalogLookupService);
    service.set(SEEDED_LOOKUPS);

    expect(service.categoryName(2)).toBe('Food');
    expect(service.categoryName(null)).toBe('');
    expect(service.subCategoryName(2)).toBe('Non-Coffee');
    expect(service.addOnTypeName(5)).toBe('Sauce');
    expect(service.addOnRule(1)).toEqual({
      name: 'Size',
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
    });
    expect(service.addOnRule(99)).toBeNull();
  });

  it('loads once from the API and shares the load between callers', async () => {
    const { service, http } = setupHttpService(CatalogLookupService);
    const first = service.ensureLoaded();
    const second = service.ensureLoaded();
    const req = http.expectOne(`${environment.apiUrl}/catalog`);
    req.flush({
      categories: [
        {
          id: 1,
          name: 'Drink',
          sortOrder: 1,
          isActive: true,
          productCount: 0,
          subCategories: [],
        },
      ],
      unassignedSubCategories: [],
      addOnTypes: [],
    });
    await Promise.all([first, second]);

    expect(service.categories()).toHaveLength(1);
    await service.ensureLoaded();
    http.verify();
  });

  it('keeps the lists it has when the API cannot be reached', async () => {
    const { service, http } = setupHttpService(CatalogLookupService);
    service.set(SEEDED_LOOKUPS);
    const refreshing = service.refresh();
    failNetwork(http.expectOne(`${environment.apiUrl}/catalog`));
    await refreshing;

    expect(service.categories()).toHaveLength(4);
  });
});
