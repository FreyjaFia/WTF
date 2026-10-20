import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  AlertService,
  InventoryService,
  ModalStackService,
  ProductService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { ItemDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { internals } from '../../../../testing/feature-spec-helpers';
import { ItemEditorComponent } from './item-editor';

function makeItem(overrides: Partial<ItemDto> = {}): ItemDto {
  return {
    id: 'i1',
    name: 'Coffee Beans',
    sku: 'CB-1',
    barcode: '123456',
    unitName: 'gram',
    stockUnitName: 'kilogram',
    unitsPerStockUnit: 1000,
    currentQuantity: 100,
    costPrice: 5,
    warningQuantity: 50,
    criticalQuantity: 10,
    isActive: true,
    allowNegativeStock: true,
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'u',
    updatedAt: '2026-02-01T00:00:00Z',
    priceHistory: [{ id: 'h' } as never],
    productLinks: [
      { id: 'l1', productId: 'p1', productName: 'Latte', isActive: true } as never,
      { id: 'l2', productId: 'p2', productName: 'Old', isActive: false } as never,
    ],
    recentMovements: [],
    ...overrides,
  };
}

function recipients(selected: string[] = []) {
  return {
    selectedUserIds: selected,
    candidates: [
      { userId: 'u1', name: 'Ana Admin', role: 'Admin' },
      { userId: 'u2', name: 'Ben Stock', role: 'StockManager' },
    ],
    defaultDescription: 'Super Admins, Admins and Stock Managers',
  };
}

describe('ItemEditorComponent', () => {
  let inventory: {
    getInventoryItem: ReturnType<typeof vi.fn>;
    createInventoryItem: ReturnType<typeof vi.fn>;
    updateInventoryItem: ReturnType<typeof vi.fn>;
    getAlertRecipients: ReturnType<typeof vi.fn>;
    setAlertRecipients: ReturnType<typeof vi.fn>;
  };
  let alerts: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.fn>;

  function create(id: string | null = null) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: ProductService, useValue: { getProducts: vi.fn(() => of([])) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(id ? { id } : {}) } },
        },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(ItemEditorComponent);
    fixture.detectChanges();
    const vm = internals(fixture.componentInstance);
    return { fixture, vm, form: vm['inventoryForm'] };
  }

  beforeEach(() => {
    inventory = {
      getInventoryItem: vi.fn(() => of(makeItem())),
      createInventoryItem: vi.fn((p: { name: string }) => of(makeItem({ id: 'new', name: p.name }))),
      updateInventoryItem: vi.fn(() => of(makeItem())),
      getAlertRecipients: vi.fn(() => of(recipients())),
      setAlertRecipients: vi.fn((_id: string, ids: string[]) => of(recipients(ids))),
    };
    alerts = { error: vi.fn(), success: vi.fn() };
  });

  describe('create mode', () => {
    it('starts with sensible defaults', () => {
      const { vm, form } = create();
      expect(vm['isEditMode']()).toBe(false);
      expect(form.getRawValue()).toMatchObject({
        name: '',
        unitName: 'piece',
        stockUnitName: '',
        unitsPerStockUnit: null,
        startingQuantity: 0,
        isActive: true,
      });
      expect(inventory.getInventoryItem).not.toHaveBeenCalled();
    });

    it('disables units-per-stock-unit while no distinct stock unit is chosen', () => {
      const { form } = create();
      expect(form.controls.unitsPerStockUnit.disabled).toBe(true);
    });

    it('enables units-per-stock-unit once a different stock unit is chosen', () => {
      const { form } = create();
      form.controls.stockUnitName.setValue('kilogram');
      expect(form.controls.unitsPerStockUnit.enabled).toBe(true);
    });

    it('clears the stock unit and disables the factor when it equals the base unit', () => {
      const { form } = create();
      form.controls.stockUnitName.setValue('kilogram');
      form.controls.unitsPerStockUnit.setValue(1000);
      form.controls.stockUnitName.setValue('piece');
      expect(form.controls.stockUnitName.value).toBe('');
      expect(form.controls.unitsPerStockUnit.disabled).toBe(true);
      expect(form.controls.unitsPerStockUnit.value).toBeNull();
    });

    it('re-evaluates the factor when the base unit changes', () => {
      const { form } = create();
      form.controls.stockUnitName.setValue('kilogram');
      form.controls.unitName.setValue('kilogram');
      expect(form.controls.stockUnitName.value).toBe('');
      expect(form.controls.unitsPerStockUnit.disabled).toBe(true);
    });

    it('creates an item with normalised payload and navigates to its details', () => {
      const { vm, form } = create();
      form.patchValue({ name: 'Milk', unitName: 'liter', startingQuantity: 3, costPrice: 2.5 });
      vm['saveInventoryItem']();
      expect(inventory.createInventoryItem).toHaveBeenCalledWith({
        name: 'Milk',
        sku: null,
        barcode: null,
        unitName: 'liter',
        stockUnitName: null,
        unitsPerStockUnit: null,
        startingQuantity: 3,
        costPrice: 2.5,
        warningQuantity: null,
        criticalQuantity: null,
        allowNegativeStock: true,
        isActive: true,
      });
      expect(alerts.success).toHaveBeenCalledWith('Item created.');
      expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryItemDetailsById('new'));
      expect(vm['isSaving']()).toBe(false);
    });

    it('sends sku, barcode and stock unit conversion when provided', () => {
      const { vm, form } = create();
      form.patchValue({
        name: 'Beans',
        sku: 'S',
        barcode: 'B',
        unitName: 'gram',
        stockUnitName: 'kilogram',
        unitsPerStockUnit: 1000,
        warningQuantity: 5,
        criticalQuantity: 1,
      });
      vm['saveInventoryItem']();
      expect(inventory.createInventoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: 'S',
          barcode: 'B',
          stockUnitName: 'kilogram',
          unitsPerStockUnit: 1000,
          warningQuantity: 5,
          criticalQuantity: 1,
        }),
      );
    });

    it('does not submit an invalid form and marks fields as touched', () => {
      const { vm, form } = create();
      vm['saveInventoryItem']();
      expect(inventory.createInventoryItem).not.toHaveBeenCalled();
      expect(form.controls.name.touched).toBe(true);
      expect(vm['hasError']('name')).toBe(true);
      expect(vm['getErrorMessage']('name')).toBe('Name is required');
    });

    it('ignores a second submit while saving', () => {
      const pending = new Subject<ItemDto>();
      inventory.createInventoryItem.mockReturnValue(pending);
      const { vm, form } = create();
      form.patchValue({ name: 'Milk' });
      vm['saveInventoryItem']();
      vm['saveInventoryItem']();
      expect(inventory.createInventoryItem).toHaveBeenCalledTimes(1);
      expect(vm['isSaving']()).toBe(true);
    });

    it('alerts and re-enables saving when creation fails', () => {
      inventory.createInventoryItem.mockReturnValue(throwError(() => new Error('duplicate sku')));
      const { vm, form } = create();
      form.patchValue({ name: 'Milk' });
      vm['saveInventoryItem']();
      expect(alerts.error).toHaveBeenCalledWith('duplicate sku');
      expect(vm['isSaving']()).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('submits through the form element', () => {
      const { fixture, form } = create();
      form.patchValue({ name: 'Milk' });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      expect(inventory.createInventoryItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation messages', () => {
    function touched(form: ReturnType<typeof create>['form'], name: string, value: unknown) {
      const control = form.get(name);
      control.setValue(value);
      control.markAsTouched();
    }

    it('reports nothing for untouched or valid controls', () => {
      const { vm, form } = create();
      form.controls.name.setValue('');
      expect(vm['getErrorMessage']('name')).toBeNull();
      expect(vm['hasError']('name')).toBe(false);
      touched(form, 'name', 'ok');
      expect(vm['getErrorMessage']('name')).toBeNull();
    });

    it('reports unknown controls as no error', () => {
      const { vm } = create();
      expect(vm['hasError']('nope')).toBe(false);
      expect(vm['getErrorMessage']('nope')).toBeNull();
    });

    it.each([
      ['name', 101, 'Name cannot exceed 100 characters'],
      ['sku', 51, 'SKU cannot exceed 50 characters'],
      ['barcode', 101, 'Barcode cannot exceed 100 characters'],
      ['unitName', 31, 'Unit cannot exceed 30 characters'],
    ])('flags %s longer than its limit', (field, length, message) => {
      const { vm, form } = create();
      touched(form, field, 'x'.repeat(length));
      expect(vm['getErrorMessage'](field)).toBe(message);
    });

    it('flags stock unit longer than 30 characters', () => {
      const { vm, form } = create();
      touched(form, 'stockUnitName', 'x'.repeat(31));
      expect(vm['getErrorMessage']('stockUnitName')).toBe('Stock unit cannot exceed 30 characters');
    });

    it('requires a base unit', () => {
      const { vm, form } = create();
      touched(form, 'unitName', '');
      expect(vm['getErrorMessage']('unitName')).toBe('Unit is required');
    });

    it.each([
      ['startingQuantity', -1, 'Starting stock must be at least 0'],
      ['costPrice', -0.5, 'Cost price must be at least 0'],
      ['warningQuantity', -1, 'Warning level must be at least 0'],
      ['criticalQuantity', -1, 'Critical level must be at least 0'],
    ])('rejects negative %s', (field, value, message) => {
      const { vm, form } = create();
      touched(form, field, value);
      expect(vm['getErrorMessage'](field)).toBe(message);
    });

    it('requires units per stock unit to be at least 0.001', () => {
      const { vm, form } = create();
      form.controls.stockUnitName.setValue('kilogram');
      touched(form, 'unitsPerStockUnit', 0);
      expect(vm['getErrorMessage']('unitsPerStockUnit')).toBe(
        'Units per stock unit must be at least 0.001',
      );
      form.controls.unitsPerStockUnit.setValue(0.001);
      expect(form.controls.unitsPerStockUnit.valid).toBe(true);
    });

    it('blocks saving when any validator fails', () => {
      const { vm, form } = create();
      form.patchValue({ name: 'ok', costPrice: -1 });
      vm['saveInventoryItem']();
      expect(inventory.createInventoryItem).not.toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    it('loads the item, patches the form and resets dirtiness', () => {
      const { vm, form } = create('i1');
      expect(inventory.getInventoryItem).toHaveBeenCalledWith('i1');
      expect(vm['isEditMode']()).toBe(true);
      expect(form.getRawValue()).toMatchObject({
        name: 'Coffee Beans',
        sku: 'CB-1',
        barcode: '123456',
        unitName: 'gram',
        stockUnitName: 'kilogram',
        unitsPerStockUnit: 1000,
        startingQuantity: 0,
        costPrice: 5,
        warningQuantity: 50,
        criticalQuantity: 10,
        allowNegativeStock: true,
        isActive: true,
      });
      expect(form.dirty).toBe(false);
      expect(vm['itemName']()).toBe('Coffee Beans');
      expect(vm['lastUpdatedAt']()).toBe('2026-02-01T00:00:00Z');
      expect(vm['savedUnitName']()).toBe('gram');
      expect(vm['savedUnitAbbreviation']()).toBe('g');
      expect(vm['priceHistory']()).toHaveLength(1);
      expect(vm['isLoading']()).toBe(false);
    });

    it('disables the starting quantity and keeps the factor enabled for a real stock unit', () => {
      const { form } = create('i1');
      expect(form.controls.startingQuantity.disabled).toBe(true);
      expect(form.controls.unitsPerStockUnit.enabled).toBe(true);
    });

    it('falls back to createdAt when the item was never updated', () => {
      inventory.getInventoryItem.mockReturnValue(of(makeItem({ updatedAt: null })));
      const { vm } = create('i1');
      expect(vm['lastUpdatedAt']()).toBe('2026-01-01T00:00:00Z');
    });

    it('maps missing optional fields to empty values', () => {
      inventory.getInventoryItem.mockReturnValue(
        of(
          makeItem({
            sku: null,
            barcode: undefined,
            stockUnitName: null,
            unitsPerStockUnit: null,
            costPrice: null,
            warningQuantity: undefined,
            criticalQuantity: null,
          }),
        ),
      );
      const { form } = create('i1');
      expect(form.getRawValue()).toMatchObject({
        sku: '',
        barcode: '',
        stockUnitName: '',
        unitsPerStockUnit: null,
        costPrice: null,
        warningQuantity: null,
        criticalQuantity: null,
      });
      expect(form.controls.unitsPerStockUnit.disabled).toBe(true);
    });

    it('only exposes active product links as linked products', () => {
      const { vm } = create('i1');
      expect(vm['productLinks']()).toHaveLength(2);
      expect(vm['linkedProducts']().map((l: { productName: string }) => l.productName)).toEqual(['Latte']);
    });

    it('shows a loading state until the item arrives', () => {
      const pending = new Subject<ItemDto>();
      inventory.getInventoryItem.mockReturnValue(pending);
      const { vm } = create('i1');
      expect(vm['isLoading']()).toBe(true);
      pending.next(makeItem());
      expect(vm['isLoading']()).toBe(false);
    });

    it('alerts when loading fails', () => {
      inventory.getInventoryItem.mockReturnValue(throwError(() => new Error('gone')));
      const { vm } = create('i1');
      expect(alerts.error).toHaveBeenCalledWith('gone');
      expect(vm['isLoading']()).toBe(false);
    });

    it('updates the item without a starting quantity and navigates to details', () => {
      const { vm, form } = create('i1');
      form.controls.name.setValue('Renamed');
      vm['saveInventoryItem']();
      expect(inventory.updateInventoryItem).toHaveBeenCalledWith({
        id: 'i1',
        name: 'Renamed',
        sku: 'CB-1',
        barcode: '123456',
        unitName: 'gram',
        stockUnitName: 'kilogram',
        unitsPerStockUnit: 1000,
        costPrice: 5,
        warningQuantity: 50,
        criticalQuantity: 10,
        allowNegativeStock: true,
        isActive: true,
      });
      expect(inventory.createInventoryItem).not.toHaveBeenCalled();
      expect(alerts.success).toHaveBeenCalledWith('Item updated.');
      expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryItemDetailsById('i1'));
    });

    it('alerts when the update fails', () => {
      inventory.updateInventoryItem.mockReturnValue(throwError(() => new Error('conflict')));
      const { vm } = create('i1');
      vm['saveInventoryItem']();
      expect(alerts.error).toHaveBeenCalledWith('conflict');
      expect(vm['isSaving']()).toBe(false);
    });

    it('goBack returns to the item details', () => {
      const { vm } = create('i1');
      vm['goBack']();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryItemDetailsById('i1'));
    });
  });

  describe('navigation guard', () => {
    it('goBack from create mode returns to the item list', () => {
      const { vm } = create();
      vm['goBack']();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryItems);
    });

    it('allows leaving a pristine form', () => {
      const { fixture } = create();
      expect(fixture.componentInstance.canDeactivate()).toBe(true);
    });

    it('asks for confirmation when the form is dirty', () => {
      const { fixture, vm, form } = create();
      form.controls.name.markAsDirty();
      const result = fixture.componentInstance.canDeactivate();
      fixture.detectChanges();
      expect(result).toBeInstanceOf(Promise);
      expect(vm['showDiscardModal']()).toBe(true);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).querySelector('app-confirm-dialog')).not.toBeNull();
    });

    it('resolves true when the discard is confirmed', async () => {
      const { fixture, vm, form } = create();
      form.controls.name.markAsDirty();
      const result = fixture.componentInstance.canDeactivate() as Promise<boolean>;
      vm['confirmDiscard']();
      await expect(result).resolves.toBe(true);
      expect(vm['showDiscardModal']()).toBe(false);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('resolves false when the discard is cancelled', async () => {
      const { fixture, vm, form } = create();
      form.controls.name.markAsDirty();
      const result = fixture.componentInstance.canDeactivate() as Promise<boolean>;
      vm['cancelDiscard']();
      await expect(result).resolves.toBe(false);
      expect(vm['showDiscardModal']()).toBe(false);
    });

    it('the hardware back button cancels the discard dialog', async () => {
      const { fixture, form } = create();
      form.controls.name.markAsDirty();
      const result = fixture.componentInstance.canDeactivate() as Promise<boolean>;
      TestBed.inject(ModalStackService).pop();
      await expect(result).resolves.toBe(false);
    });

    it('confirm/cancel without a pending guard are harmless', () => {
      const { vm } = create();
      expect(() => {
        vm['confirmDiscard']();
        vm['cancelDiscard']();
      }).not.toThrow();
    });

    it('does not block navigation after a successful save', () => {
      const { fixture, vm, form } = create();
      form.patchValue({ name: 'Milk' });
      form.controls.name.markAsDirty();
      vm['saveInventoryItem']();
      expect(fixture.componentInstance.canDeactivate()).toBe(true);
    });
  });

  describe('price history and product links', () => {
    it('opens and closes the price history drawer', () => {
      const { vm } = create('i1');
      vm['openPriceHistory']();
      expect(vm['isHistoryOpen']()).toBe(true);
      vm['closePriceHistory']();
      expect(vm['isHistoryOpen']()).toBe(false);
    });

    it('asks to save the item first before managing links', () => {
      const { vm } = create();
      vm['openProductLinksManager']();
      expect(alerts.error).toHaveBeenCalledWith(
        'Please save the item first before managing product links.',
      );
    });

    it('updates the linked products when the selector saves', () => {
      const { vm } = create('i1');
      vm['onProductLinksSaved'](makeItem({ productLinks: [] }));
      expect(vm['productLinks']()).toEqual([]);
      expect(vm['linkedProducts']()).toEqual([]);
    });

    it('treats a saved item without links as empty', () => {
      const { vm } = create('i1');
      vm['onProductLinksSaved']({ ...makeItem(), productLinks: undefined } as unknown as ItemDto);
      expect(vm['productLinks']()).toEqual([]);
    });
  });

  describe('stock alert recipients', () => {
    const card = (fixture: { detectChanges: () => void; nativeElement: HTMLElement }) => {
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('[data-testid="alert-recipients"]');
    };

    it('is not shown while creating an item', () => {
      const { fixture } = create();
      expect(card(fixture)).toBeNull();
      expect(inventory.getAlertRecipients).not.toHaveBeenCalled();
    });

    it('starts on the default and says who that is', () => {
      const { fixture } = create('i1');
      expect(inventory.getAlertRecipients).toHaveBeenCalledWith('i1');
      expect(card(fixture)?.textContent).toContain('Default: Super Admins, Admins and Stock Managers');
      expect(card(fixture)?.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    });

    it('shows the named people already chosen', () => {
      inventory.getAlertRecipients.mockReturnValue(of(recipients(['u2'])));
      const { fixture, vm } = create('i1');
      const people = (vm as unknown as { recipientForm: { getRawValue: () => { mode: string; people: boolean[] } } })
        .recipientForm.getRawValue();

      expect(people.mode).toBe('chosen');
      expect(people.people).toEqual([false, true]);
      expect(card(fixture)?.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    });

    it('saves the chosen people', () => {
      const { vm } = create('i1');
      const form = (vm as unknown as { recipientForm: { patchValue: (v: object) => void } }).recipientForm;
      form.patchValue({ mode: 'chosen', people: [false, true] });
      (vm as unknown as { saveAlertRecipients: () => void }).saveAlertRecipients();

      expect(inventory.setAlertRecipients).toHaveBeenCalledWith('i1', ['u2']);
      expect(alerts.success).toHaveBeenCalledWith('Alert recipients saved.');
    });

    it('sends an empty list to go back to the default', () => {
      inventory.getAlertRecipients.mockReturnValue(of(recipients(['u1'])));
      const { vm } = create('i1');
      const form = (vm as unknown as { recipientForm: { patchValue: (v: object) => void } }).recipientForm;
      form.patchValue({ mode: 'default' });
      (vm as unknown as { saveAlertRecipients: () => void }).saveAlertRecipients();

      expect(inventory.setAlertRecipients).toHaveBeenCalledWith('i1', []);
    });

    it('will not save "only these people" with nobody chosen', () => {
      const { vm } = create('i1');
      const form = (vm as unknown as { recipientForm: { patchValue: (v: object) => void } }).recipientForm;
      form.patchValue({ mode: 'chosen', people: [false, false] });
      (vm as unknown as { saveAlertRecipients: () => void }).saveAlertRecipients();

      expect(inventory.setAlertRecipients).not.toHaveBeenCalled();
      expect(alerts.error).toHaveBeenCalledWith(expect.stringContaining('Choose at least one person'));
    });

    it('shows the server message when saving fails', () => {
      inventory.setAlertRecipients.mockReturnValue(throwError(() => new Error('Nope')));
      const { vm } = create('i1');
      (vm as unknown as { saveAlertRecipients: () => void }).saveAlertRecipients();

      expect(alerts.error).toHaveBeenCalledWith('Nope');
    });
  });
});
