import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AlertService, AuthService, InventoryService, ModalStackService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { ItemDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { internals } from '../../../../testing/feature-spec-helpers';
import { ItemDetailsComponent } from './item-details';

function makeItem(overrides: Partial<ItemDto> = {}): ItemDto {
  return {
    id: 'i1',
    name: 'Coffee Beans',
    sku: 'CB-1',
    barcode: '123456',
    unitName: 'gram',
    stockUnitName: null,
    unitsPerStockUnit: null,
    currentQuantity: 100,
    costPrice: 5,
    warningQuantity: 50,
    criticalQuantity: 10,
    isActive: true,
    allowNegativeStock: true,
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'u',
    priceHistory: [],
    productLinks: [],
    recentMovements: [],
    ...overrides,
  };
}

describe('ItemDetailsComponent', () => {
  let inventory: {
    getInventoryItem: ReturnType<typeof vi.fn>;
    deleteInventoryItem: ReturnType<typeof vi.fn>;
    restoreInventoryItem: ReturnType<typeof vi.fn>;
    getItemMovements: ReturnType<typeof vi.fn>;
    adjustStock: ReturnType<typeof vi.fn>;
  };
  let alerts: {
    error: ReturnType<typeof vi.fn>;
    errorUnauthorized: ReturnType<typeof vi.fn>;
    successDeleted: ReturnType<typeof vi.fn>;
    successRestored: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    getDeleteErrorMessage: ReturnType<typeof vi.fn>;
  };
  let auth: {
    canWriteItems: ReturnType<typeof vi.fn>;
    canReadStockMovements: ReturnType<typeof vi.fn>;
    canWriteStockMovements: ReturnType<typeof vi.fn>;
  };
  let navigate: ReturnType<typeof vi.fn>;

  function create(id: string | null = 'i1') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(id ? { id } : {}) } },
        },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(ItemDetailsComponent);
    fixture.detectChanges();
    return { fixture, vm: internals(fixture.componentInstance) };
  }

  beforeEach(() => {
    inventory = {
      getInventoryItem: vi.fn(() => of(makeItem())),
      deleteInventoryItem: vi.fn(() => of(undefined)),
      restoreInventoryItem: vi.fn(() => of(undefined)),
      getItemMovements: vi.fn(() => of({ items: [], totalCount: 0 })),
      adjustStock: vi.fn(() => of(makeItem({ currentQuantity: 7 }))),
    };
    alerts = {
      error: vi.fn(),
      errorUnauthorized: vi.fn(),
      successDeleted: vi.fn(),
      successRestored: vi.fn(),
      success: vi.fn(),
      getDeleteErrorMessage: vi.fn((e: string) => `Failed to delete ${e}`),
    };
    auth = {
      canWriteItems: vi.fn(() => true),
      canReadStockMovements: vi.fn(() => true),
      canWriteStockMovements: vi.fn(() => true),
    };
  });

  describe('title', () => {
    it('shows the item name in the shared expandable title', () => {
      const { fixture } = create();
      const title = (fixture.nativeElement as HTMLElement).querySelector('app-page-title h1');
      expect(title?.textContent?.trim()).toBe('Coffee Beans');
    });
  });

  describe('linked products', () => {
    const link = (id: string, name: string, isActive: boolean, productIsActive?: boolean) =>
      ({ id, productId: id, productName: name, productCode: id.toUpperCase(), itemId: 'i1', quantityPerSale: 1, isActive, productIsActive }) as never;

    it('lists only active links, marking a deleted product', () => {
      inventory.getInventoryItem.mockReturnValue(
        of(
          makeItem({
            productLinks: [
              link('a', 'Latte', true, true),
              link('b', 'Unlinked', false, true),
              link('c', 'Retired', true, false),
            ],
          }),
        ),
      );
      const { fixture, vm } = create();

      expect(vm['activeProductLinks']().map((l: { productName: string }) => l.productName)).toEqual(['Latte', 'Retired']);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Latte');
      expect(text).toContain('Retired');
      expect(text).toContain('(deleted product)');
      expect(text).not.toContain('Unlinked');
    });

    it('says there are none when every link is switched off', () => {
      inventory.getInventoryItem.mockReturnValue(of(makeItem({ productLinks: [link('b', 'Unlinked', false)] })));
      const { fixture } = create();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('No linked products');
    });
  });

  describe('loading', () => {
    it('loads the item from the route id and renders it', () => {
      const { fixture, vm } = create('i1');
      expect(inventory.getInventoryItem).toHaveBeenCalledWith('i1');
      expect(vm['item']()?.name).toBe('Coffee Beans');
      expect(vm['isLoading']()).toBe(false);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Coffee Beans');
    });

    it('does not load when the route has no id', () => {
      const { vm } = create(null);
      expect(inventory.getInventoryItem).not.toHaveBeenCalled();
      expect(vm['item']()).toBeNull();
    });

    it('copies price history from the item', () => {
      const history = [{ id: 'h1', itemId: 'i1', price: 3 }];
      inventory.getInventoryItem.mockReturnValue(of(makeItem({ priceHistory: history as never })));
      const { vm } = create();
      expect(vm['priceHistory']()).toEqual(history);
    });

    it('is loading until the response arrives', () => {
      const pending = new Subject<ItemDto>();
      inventory.getInventoryItem.mockReturnValue(pending);
      const { vm } = create();
      expect(vm['isLoading']()).toBe(true);
      pending.next(makeItem());
      expect(vm['isLoading']()).toBe(false);
    });

    it('alerts and stops loading on error', () => {
      inventory.getInventoryItem.mockReturnValue(throwError(() => new Error('missing')));
      const { vm } = create();
      expect(alerts.error).toHaveBeenCalledWith('missing');
      expect(vm['isLoading']()).toBe(false);
      expect(vm['item']()).toBeNull();
    });
  });

  describe('helpers', () => {
    it.each([
      [100, 'ok'],
      [50, 'warning'],
      [10, 'critical'],
    ])('quantity %i is %s', (qty, status) => {
      const { vm } = create();
      expect(vm['getStockStatus'](makeItem({ currentQuantity: qty }))).toBe(status);
    });

    it('is ok without thresholds', () => {
      const { vm } = create();
      expect(
        vm['getStockStatus'](makeItem({ warningQuantity: undefined, criticalQuantity: null, currentQuantity: 0 })),
      ).toBe('ok');
    });

    it('converts to stock units and shows the base quantity only with a valid factor', () => {
      const { vm } = create();
      const item = makeItem({ currentQuantity: 2500, stockUnitName: 'kilogram', unitsPerStockUnit: 1000 });
      expect(vm['getStockQuantity'](item)).toBe(2.5);
      expect(vm['shouldShowBaseQuantity'](item)).toBe(true);
      const bad = makeItem({ currentQuantity: 3, stockUnitName: 'box', unitsPerStockUnit: -1 });
      expect(vm['getStockQuantity'](bad)).toBe(3);
      expect(vm['shouldShowBaseQuantity'](bad)).toBe(false);
    });

    it('resolves unit abbreviations', () => {
      const { vm } = create();
      expect(vm['getBaseUnitAbbreviation'](makeItem({ unitName: 'gram' }))).toBe('g');
      expect(vm['getStockUnitAbbreviation'](makeItem({ stockUnitName: 'kilogram' }))).toBe('kg');
    });

    it('opens and closes the price history drawer', () => {
      const { vm } = create();
      vm['openPriceHistory']();
      expect(vm['isHistoryOpen']()).toBe(true);
      vm['closePriceHistory']();
      expect(vm['isHistoryOpen']()).toBe(false);
    });
  });

  describe('delete', () => {
    it('opens the confirm dialog and registers on the modal stack', () => {
      const { fixture, vm } = create();
      vm['deleteItem']();
      fixture.detectChanges();
      expect(vm['showDeleteModal']()).toBe(true);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).querySelector('app-confirm-dialog')).not.toBeNull();
    });

    it('is blocked without permission', () => {
      auth.canWriteItems.mockReturnValue(false);
      const { vm } = create();
      vm['deleteItem']();
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(vm['showDeleteModal']()).toBe(false);
    });

    it('does nothing when no item is loaded', () => {
      const { vm } = create(null);
      vm['deleteItem']();
      expect(vm['showDeleteModal']()).toBe(false);
    });

    it('cancel closes the dialog and releases the modal stack', () => {
      const { vm } = create();
      vm['deleteItem']();
      vm['cancelDelete']();
      expect(vm['showDeleteModal']()).toBe(false);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('the hardware back button cancels it', () => {
      const { vm } = create();
      vm['deleteItem']();
      TestBed.inject(ModalStackService).pop();
      expect(vm['showDeleteModal']()).toBe(false);
    });

    it('confirm deletes, announces success and returns to the item list', () => {
      const { vm } = create();
      vm['deleteItem']();
      vm['confirmDelete']();
      expect(inventory.deleteInventoryItem).toHaveBeenCalledWith('i1');
      expect(alerts.successDeleted).toHaveBeenCalledWith('Item');
      expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryItems);
      expect(vm['showDeleteModal']()).toBe(false);
      expect(vm['isDeleting']()).toBe(false);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('confirm without an item or while busy does nothing', () => {
      const pending = new Subject<void>();
      inventory.deleteInventoryItem.mockReturnValue(pending);
      const { vm } = create();
      vm['confirmDelete']();
      vm['deleteItem']();
      vm['confirmDelete']();
      vm['confirmDelete']();
      expect(inventory.deleteInventoryItem).toHaveBeenCalledTimes(1);
      vm['cancelDelete']();
      expect(vm['showDeleteModal']()).toBe(true);
    });

    it('confirm re-checks permission', () => {
      const { vm } = create();
      vm['deleteItem']();
      auth.canWriteItems.mockReturnValue(false);
      vm['confirmDelete']();
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(inventory.deleteInventoryItem).not.toHaveBeenCalled();
    });

    it('shows the server error when deleting fails', () => {
      inventory.deleteInventoryItem.mockReturnValue(throwError(() => new Error('in use')));
      const { vm } = create();
      vm['deleteItem']();
      vm['confirmDelete']();
      expect(alerts.error).toHaveBeenCalledWith('in use');
      expect(vm['isDeleting']()).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('falls back to the generic delete message for an empty error message', () => {
      inventory.deleteInventoryItem.mockReturnValue(throwError(() => new Error('')));
      const { vm } = create();
      vm['deleteItem']();
      vm['confirmDelete']();
      expect(alerts.getDeleteErrorMessage).toHaveBeenCalledWith('item');
      expect(alerts.error).toHaveBeenCalledWith('Failed to delete item');
    });
  });

  describe('restore', () => {
    const inactive = makeItem({ isActive: false });

    it('opens the restore dialog', () => {
      inventory.getInventoryItem.mockReturnValue(of(inactive));
      const { fixture, vm } = create();
      vm['restoreItem']();
      fixture.detectChanges();
      expect(vm['showRestoreModal']()).toBe(true);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(true);
    });

    it('is blocked without permission', () => {
      auth.canWriteItems.mockReturnValue(false);
      const { vm } = create();
      vm['restoreItem']();
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(vm['showRestoreModal']()).toBe(false);
    });

    it('does nothing when no item is loaded', () => {
      const { vm } = create(null);
      vm['restoreItem']();
      expect(vm['showRestoreModal']()).toBe(false);
    });

    it('cancel closes the dialog', () => {
      const { vm } = create();
      vm['restoreItem']();
      vm['cancelRestore']();
      expect(vm['showRestoreModal']()).toBe(false);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('confirm restores, announces success and reloads the item', () => {
      const { vm } = create();
      vm['restoreItem']();
      inventory.getInventoryItem.mockClear();
      vm['confirmRestore']();
      expect(inventory.restoreInventoryItem).toHaveBeenCalledWith('i1');
      expect(alerts.successRestored).toHaveBeenCalledWith('Item');
      expect(inventory.getInventoryItem).toHaveBeenCalledWith('i1');
      expect(vm['showRestoreModal']()).toBe(false);
      expect(vm['isRestoring']()).toBe(false);
    });

    it('confirm is ignored while restoring and cancel is blocked', () => {
      const pending = new Subject<void>();
      inventory.restoreInventoryItem.mockReturnValue(pending);
      const { vm } = create();
      vm['restoreItem']();
      vm['confirmRestore']();
      vm['confirmRestore']();
      expect(inventory.restoreInventoryItem).toHaveBeenCalledTimes(1);
      vm['cancelRestore']();
      expect(vm['showRestoreModal']()).toBe(true);
    });

    it('confirm re-checks permission and does nothing without an item', () => {
      const { vm } = create(null);
      vm['confirmRestore']();
      expect(inventory.restoreInventoryItem).not.toHaveBeenCalled();
      auth.canWriteItems.mockReturnValue(false);
      vm['confirmRestore']();
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
    });

    it('alerts and keeps the dialog on failure', () => {
      inventory.restoreInventoryItem.mockReturnValue(throwError(() => new Error('nope')));
      const { vm } = create();
      vm['restoreItem']();
      vm['confirmRestore']();
      expect(alerts.error).toHaveBeenCalledWith('nope');
      expect(vm['isRestoring']()).toBe(false);
      expect(vm['showRestoreModal']()).toBe(true);
    });
  });

  describe('stock history and adjustment', () => {
    const movement = {
      id: 'm1',
      itemId: 'i1',
      movementType: 'Sale',
      quantityDelta: -600,
      quantityBefore: 10000,
      quantityAfter: 9400,
      createdAt: '2026-10-20T08:00:00Z',
      createdBy: 'u',
      createdByName: 'Una User',
      productName: 'Latte',
      orderNumber: 1042,
      referenceType: 'Order',
      referenceId: 'o1',
    };

    it('lists the movements with the order number as a link on sale rows', () => {
      inventory.getItemMovements.mockReturnValue(of({ items: [movement], totalCount: 1 }));
      const { fixture } = create();
      const el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();

      const row = el.querySelector('[data-testid="movement-row"]') as HTMLElement;
      expect(row.textContent).toContain('Sale');
      expect(row.textContent).toContain('Order #1042');
      expect(row.querySelector('a')?.getAttribute('href')).toBe('/orders/details/o1');
      expect(row.textContent).toContain('-600');
    });

    it('filters by type and asks the server for the first page again', () => {
      const { vm } = create();
      vm['filterMovements']('Waste');
      expect(inventory.getItemMovements).toHaveBeenLastCalledWith('i1', {
        type: 'Waste',
        page: 1,
        pageSize: 25,
      });
    });

    it('loads the next page and appends it', () => {
      const first = Array.from({ length: 25 }, (_, i) => ({ ...movement, id: `m${i}` }));
      inventory.getItemMovements.mockReturnValueOnce(of({ items: first, totalCount: 30 }));
      const { vm } = create();
      inventory.getItemMovements.mockReturnValueOnce(
        of({ items: [{ ...movement, id: 'm25' }], totalCount: 30 }),
      );
      vm['loadMoreMovements']();
      expect(inventory.getItemMovements).toHaveBeenLastCalledWith('i1', {
        type: null,
        page: 2,
        pageSize: 25,
      });
      expect((vm['movements']() as unknown[]).length).toBe(26);
    });

    it('hides the history from roles that cannot read stock movements', () => {
      auth.canReadStockMovements.mockReturnValue(false);
      const { fixture } = create();
      expect(inventory.getItemMovements).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="stock-history"]')).toBeNull();
    });

    it('adjusts the stock, updates the item and reloads the history', () => {
      const { vm } = create();
      vm['adjustStock']();
      expect(vm['showAdjustModal']()).toBe(true);

      vm['confirmAdjust']({ itemId: 'i1', countedQuantity: 7, expectedQuantity: 100, reason: 'Lost' });

      expect(inventory.adjustStock).toHaveBeenCalled();
      expect(vm['showAdjustModal']()).toBe(false);
      expect((vm['item']() as ItemDto).currentQuantity).toBe(7);
      expect(alerts.success).toHaveBeenCalledWith('Stock adjusted.');
    });

    it('keeps the dialog open and shows the server message when adjusting fails', () => {
      inventory.adjustStock.mockReturnValue(throwError(() => new Error('Not allowed')));
      const { vm } = create();
      vm['adjustStock']();
      vm['confirmAdjust']({ itemId: 'i1', quantityChange: -5, reason: 'Lost' });
      expect(alerts.error).toHaveBeenCalledWith('Not allowed');
      expect(vm['showAdjustModal']()).toBe(true);
      expect(vm['isAdjusting']()).toBe(false);
    });

    it('refuses to open the dialog without permission', () => {
      auth.canWriteStockMovements.mockReturnValue(false);
      const { vm } = create();
      vm['adjustStock']();
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(vm['showAdjustModal']()).toBe(false);
    });
  });
});
