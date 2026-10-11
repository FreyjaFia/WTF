/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  AlertService,
  AuthService,
  ModalStackService,
  PromotionService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { PromotionListItemDto, PromotionTypeEnum } from '@shared/models';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionListComponent } from './promotion-list';

const STATE_KEY = 'management:promotion-list';

function promo(over: Partial<PromotionListItemDto>): PromotionListItemDto {
  return {
    id: 'x',
    name: 'Promo',
    typeId: PromotionTypeEnum.FixedBundle,
    isActive: true,
    startDate: null,
    endDate: null,
    ...over,
  };
}

const BUNDLES = [
  promo({ id: 'b1', name: 'Breakfast Bundle', typeId: PromotionTypeEnum.FixedBundle }),
  promo({ id: 'b2', name: 'Old Bundle', typeId: PromotionTypeEnum.FixedBundle, isActive: false }),
];
const MIXES = [promo({ id: 'm1', name: 'Mix Two', typeId: PromotionTypeEnum.MixMatch })];
const DISCOUNTS = [
  promo({ id: 'd1', name: 'Happy Hour', typeId: PromotionTypeEnum.DiscountedProduct }),
];

describe('PromotionListComponent', () => {
  let fixture: ComponentFixture<PromotionListComponent>;
  let c: any;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let alerts: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(canWrite = true, bare = false): void {
    service = {
      getFixedBundles: vi.fn(() => of(BUNDLES)),
      getMixMatchPromotions: vi.fn(() => of(MIXES)),
      getDiscountedProductPromotions: vi.fn(() => of(DISCOUNTS)),
      deleteFixedBundle: vi.fn(() => of(undefined)),
      deleteMixMatch: vi.fn(() => of(undefined)),
      deleteDiscountedProduct: vi.fn(() => of(undefined)),
      restorePromotion: vi.fn(() => of(undefined)),
    };
    alerts = {
      error: vi.fn(),
      errorUnauthorized: vi.fn(),
      successDeleted: vi.fn(),
      successRestored: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PromotionService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canWritePromotions: vi.fn(() => canWrite) } },
      ],
    });
    if (bare) {
      TestBed.overrideComponent(PromotionListComponent, {
        set: { template: '', templateUrl: undefined, imports: [] },
      });
    }
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(PromotionListComponent);
    c = fixture.componentInstance;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  const names = (): string[] => c.sortedPromotions().map((p: PromotionListItemDto) => p.name);

  it('loads all three promotion kinds and defaults to active, name-sorted', () => {
    setup();
    fixture.detectChanges();
    expect(names()).toEqual(['Breakfast Bundle', 'Happy Hour', 'Mix Two']);
    expect(c.isLoading()).toBe(false);
  });

  it('renders names in the template', () => {
    setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Happy Hour');
  });

  it('alerts on load error and resets flags', () => {
    setup();
    service['getMixMatchPromotions'].mockReturnValue(throwError(() => new Error('bad')));
    c.isRefreshing.set(true);
    fixture.detectChanges();
    expect(alerts['error']).toHaveBeenCalledWith('bad');
    expect(c.isLoading()).toBe(false);
    expect(c.isRefreshing()).toBe(false);
  });

  it('refresh reloads', () => {
    setup();
    fixture.detectChanges();
    c.refresh();
    expect(service['getFixedBundles']).toHaveBeenCalledTimes(2);
    expect(c.isRefreshing()).toBe(false);
  });

  it('computes type/status counts and options', () => {
    setup();
    fixture.detectChanges();
    expect(c.typeCounts()).toEqual({ fixedBundle: 2, mixMatch: 1, discountedProduct: 1 });
    expect(c.statusCounts()).toEqual({ active: 3, inactive: 1 });
    expect(c.typeOptions().map((o: any) => o.id)).toEqual([
      'fixed-bundle',
      'mix-match',
      'discounted-product',
    ]);
    expect(c.statusOptions().map((o: any) => o.count)).toEqual([3, 1]);
  });

  describe('filtering and sorting', () => {
    beforeEach(() => {
      setup(true, true);
      fixture.detectChanges();
    });

    it('filters by search after the debounce and persists', async () => {
      c.filterForm.controls.searchTerm.setValue('HAPPY');
      expect(names()).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(300);
      expect(names()).toEqual(['Happy Hour']);
      expect(JSON.parse(localStorage.getItem(STATE_KEY) as string).searchTerm).toBe('HAPPY');
    });

    it('filters by each type', () => {
      c.toggleTypeSelection('mix-match');
      expect(names()).toEqual(['Mix Two']);
      c.toggleTypeSelection('discounted-product');
      expect(names()).toEqual(['Happy Hour', 'Mix Two']);
      c.toggleTypeSelection('mix-match');
      c.toggleTypeSelection('discounted-product');
      c.toggleTypeSelection('fixed-bundle');
      expect(names()).toEqual(['Breakfast Bundle']);
      expect(c.isTypeSelected('fixed-bundle')).toBe(true);
      c.clearTypeSelections();
      expect(names()).toHaveLength(3);
    });

    it('type filter change/reset handlers', () => {
      c.onTypeFilterChange(['mix-match']);
      expect(names()).toEqual(['Mix Two']);
      c.onTypeFilterReset();
      expect(c.selectedTypes()).toEqual([]);
    });

    it('filters by status', () => {
      c.toggleStatusSelection('active');
      c.toggleStatusSelection('inactive');
      expect(names()).toEqual(['Old Bundle']);
      expect(c.isStatusSelected('inactive')).toBe(true);
      c.toggleStatusSelection('active');
      expect(names()).toHaveLength(4);
      c.onStatusFilterChange(['active']);
      expect(names()).toHaveLength(3);
      c.onStatusFilterReset();
      expect(names()).toHaveLength(4);
      c.onStatusFilterChange(['inactive']);
      c.clearStatusSelections();
      expect(c.selectedStatuses()).toEqual([]);
    });

    it('sorts by name desc and by type label', () => {
      c.toggleSort('name');
      expect(names()).toEqual(['Mix Two', 'Happy Hour', 'Breakfast Bundle']);
      c.toggleSort('type');
      expect(c.sortColumn()).toBe('type');
      expect(names()[0]).toBe('Happy Hour'); // "Discounted Product" < "Fixed Bundle" < "Mix & Match"
      expect(names()[2]).toBe('Mix Two');
      c.toggleSort('type');
      expect(names()[0]).toBe('Mix Two');
    });

    it('does not sort when no column is selected', () => {
      c.sortColumn.set(null);
      expect(names()).toEqual(['Breakfast Bundle', 'Mix Two', 'Happy Hour']);
    });

    it('toggles filter drawer', () => {
      c.openFilters();
      expect(c.isFiltersOpen()).toBe(true);
      c.closeFilters();
      expect(c.isFiltersOpen()).toBe(false);
    });
  });

  describe('state persistence', () => {
    it('restores saved state', () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          searchTerm: 'old',
          selectedTypes: ['fixed-bundle'],
          selectedStatuses: ['inactive'],
          sortColumn: 'type',
          sortDirection: 'desc',
        }),
      );
      setup();
      fixture.detectChanges();
      expect(c.filterForm.controls.searchTerm.value).toBe('old');
      expect(c.sortColumn()).toBe('type');
      expect(names()).toEqual(['Old Bundle']);
    });

    it('saves on sort toggles', () => {
      setup();
      fixture.detectChanges();
      c.toggleSort('type');
      expect(JSON.parse(localStorage.getItem(STATE_KEY) as string)).toMatchObject({
        sortColumn: 'type',
        sortDirection: 'asc',
      });
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('add goes to new promotion', () => {
      c.addPromotion();
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementPromotionsNew);
    });

    it('edit routes by promotion type', () => {
      c.editPromotion(MIXES[0]);
      expect(router.navigateByUrl).toHaveBeenLastCalledWith(
        AppRoutes.ManagementPromotionMixMatchEditById('m1'),
      );
      c.editPromotion(DISCOUNTS[0]);
      expect(router.navigateByUrl).toHaveBeenLastCalledWith(
        AppRoutes.ManagementPromotionDiscountedProductEditById('d1'),
      );
      c.editPromotion(BUNDLES[0]);
      expect(router.navigateByUrl).toHaveBeenLastCalledWith(
        AppRoutes.ManagementPromotionFixedBundleEditById('b1'),
      );
    });

    it('returns type labels', () => {
      expect(c.getTypeLabel(PromotionTypeEnum.FixedBundle)).toBe('Fixed Bundle');
      expect(c.getTypeLabel(PromotionTypeEnum.MixMatch)).toBe('Mix & Match');
      expect(c.getTypeLabel(PromotionTypeEnum.DiscountedProduct)).toBe('Discounted Product');
    });
  });

  it('blocks all write actions without permission', () => {
    setup(false);
    fixture.detectChanges();
    c.addPromotion();
    c.editPromotion(BUNDLES[0]);
    c.deletePromotion(BUNDLES[0]);
    c.restorePromotion(BUNDLES[1]);
    c.promotionToDelete.set(BUNDLES[0]);
    c.confirmDelete();
    c.promotionToRestore.set(BUNDLES[1]);
    c.confirmRestore();
    expect(alerts['errorUnauthorized']).toHaveBeenCalledTimes(6);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(c.showDeleteModal()).toBe(false);
    expect(service['restorePromotion']).not.toHaveBeenCalled();
  });

  describe('delete flow', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('opens, registers on the modal stack and cancels', () => {
      const stack = TestBed.inject(ModalStackService);
      c.deletePromotion(BUNDLES[0]);
      expect(c.showDeleteModal()).toBe(true);
      expect(stack.hasOpen()).toBe(true);
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(c.promotionToDelete()).toBeNull();
      expect(stack.hasOpen()).toBe(false);
    });

    it('cancel is ignored while deleting', () => {
      c.deletePromotion(BUNDLES[0]);
      c.isDeleting.set(true);
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(true);
      c.confirmDelete();
      expect(service['deleteFixedBundle']).not.toHaveBeenCalled();
    });

    it('confirm without a target is a no-op', () => {
      c.confirmDelete();
      expect(service['deleteFixedBundle']).not.toHaveBeenCalled();
    });

    it.each([
      ['b1', 'deleteFixedBundle', 0],
      ['m1', 'deleteMixMatch', 0],
      ['d1', 'deleteDiscountedProduct', 0],
    ])('deletes %s via %s, alerts and reloads', (id, method) => {
      const target = [...BUNDLES, ...MIXES, ...DISCOUNTS].find((p) => p.id === id);
      c.deletePromotion(target);
      c.confirmDelete();
      expect(service[method]).toHaveBeenCalledWith(id);
      expect(alerts['successDeleted']).toHaveBeenCalledWith('Promotion');
      expect(c.showDeleteModal()).toBe(false);
      expect(service['getFixedBundles']).toHaveBeenCalledTimes(2);
    });

    it('keeps the modal open and alerts on failure', () => {
      service['deleteFixedBundle'].mockReturnValue(throwError(() => new Error('no')));
      c.deletePromotion(BUNDLES[0]);
      c.confirmDelete();
      expect(alerts['error']).toHaveBeenCalledWith('no');
      expect(c.isDeleting()).toBe(false);
      expect(c.showDeleteModal()).toBe(true);
    });
  });

  describe('restore flow', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('opens, cancels, confirms', () => {
      c.restorePromotion(BUNDLES[1]);
      expect(c.showRestoreModal()).toBe(true);
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(false);
      c.restorePromotion(BUNDLES[1]);
      c.confirmRestore();
      expect(service['restorePromotion']).toHaveBeenCalledWith('b2');
      expect(alerts['successRestored']).toHaveBeenCalledWith('Promotion');
      expect(c.showRestoreModal()).toBe(false);
      expect(service['getFixedBundles']).toHaveBeenCalledTimes(2);
    });

    it('guards re-entry and missing target', () => {
      c.confirmRestore();
      expect(service['restorePromotion']).not.toHaveBeenCalled();
      c.restorePromotion(BUNDLES[1]);
      c.isRestoring.set(true);
      c.cancelRestore();
      c.confirmRestore();
      expect(c.showRestoreModal()).toBe(true);
      expect(service['restorePromotion']).not.toHaveBeenCalled();
    });

    it('alerts on failure', () => {
      service['restorePromotion'].mockReturnValue(throwError(() => new Error('fail')));
      c.restorePromotion(BUNDLES[1]);
      c.confirmRestore();
      expect(alerts['error']).toHaveBeenCalledWith('fail');
      expect(c.isRestoring()).toBe(false);
    });
  });
  describe('filter count on the Filters button', () => {
    it('adds the chosen types to the chosen statuses', () => {
      setup(true);
      expect(c.activeFilterCount()).toBe(1);
      c.selectedTypes.set([c.typeOptions()[0].id]);
      expect(c.activeFilterCount()).toBe(2);
      c.selectedStatuses.set([]);
      expect(c.activeFilterCount()).toBe(1);
    });
  });
});
