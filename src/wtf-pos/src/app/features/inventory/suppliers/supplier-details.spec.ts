import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AlertService, AuthService, InventoryService, SupplierService } from '@core/services';
import { ItemDto, SupplierDto } from '@shared/models';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SupplierDetailsComponent } from './supplier-details';

const supplier = (): SupplierDto => ({
  summary: {
    id: 's1',
    name: 'Metro Dairy',
    contactName: null,
    phone: null,
    email: null,
    address: null,
    leadTimeDays: 2,
    paymentTerms: null,
    notes: null,
    isActive: true,
    itemCount: 1,
  },
  items: [
    {
      linkId: 'l1',
      itemId: 'i1',
      itemName: 'Oat Milk',
      unitName: 'bottle',
      supplierItemCode: null,
      packName: 'carton',
      unitsPerPack: 12,
      packPrice: 840,
      unitCost: 70,
      isPreferred: true,
    },
  ],
});

interface Vm {
  linkForm: { patchValue: (value: object) => void };
  linkableItems: () => ItemDto[];
  saveLink: () => void;
  removeLink: (link: SupplierDto['items'][number]) => void;
}

describe('SupplierDetailsComponent', () => {
  function setup(options: { canWrite?: boolean; canSeeCosts?: boolean } = {}) {
    const service = {
      getSupplier: vi.fn().mockReturnValue(of(supplier())),
      saveItemSupplier: vi.fn().mockReturnValue(of([])),
      removeItemSupplier: vi.fn().mockReturnValue(of([])),
    };
    const inventory = {
      getInventoryItems: vi.fn().mockReturnValue(of([{ id: 'i1', name: 'Oat Milk' }, { id: 'i2', name: 'Syrup' }])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SupplierService, useValue: service },
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: { error: vi.fn(), success: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 's1' } } } },
        {
          provide: AuthService,
          useValue: {
            canWriteStockMovements: () => options.canWrite ?? true,
            canWriteSuppliers: () => options.canWrite ?? true,
            canReadInventoryCosts: () => options.canSeeCosts ?? true,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(SupplierDetailsComponent);
    fixture.detectChanges();
    return { fixture, service, el: fixture.nativeElement as HTMLElement, vm: fixture.componentInstance as unknown as Vm };
  }

  it('shows the supplier and the pack price of each linked item', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="supplier-title"]')?.textContent).toContain('Metro Dairy');
    const row = el.querySelector('[data-testid="supplier-item-row"]')?.textContent ?? '';
    expect(row).toContain('Oat Milk');
    expect(row).toContain('Preferred');
    expect(row).toContain('840.00 per pack');
    expect(row).toContain('70.00');
  });

  it('hides prices from roles that cannot read costs', () => {
    const { el } = setup({ canSeeCosts: false });

    const row = el.querySelector('[data-testid="supplier-item-row"]')?.textContent ?? '';
    expect(row).not.toContain('840');
    expect(el.querySelector('#lf-price')).toBeNull();
  });

  it('only offers items that are not linked yet', () => {
    const { vm } = setup();

    expect(vm.linkableItems().map((item) => item.id)).toEqual(['i2']);
  });

  it('links an item with its pack details', () => {
    const { service, vm } = setup();

    vm.linkForm.patchValue({ itemId: 'i2', packName: 'bottle', unitsPerPack: 1, packPrice: 250 });
    vm.saveLink();

    expect(service.saveItemSupplier).toHaveBeenCalledWith('i2', 's1', {
      supplierItemCode: null,
      packName: 'bottle',
      unitsPerPack: 1,
      packPrice: 250,
      isPreferred: false,
    });
  });

  it('removes a link', () => {
    const { service, vm } = setup();

    vm.removeLink(supplier().items[0]);

    expect(service.removeItemSupplier).toHaveBeenCalledWith('i1', 's1');
  });

  it('hides the editing controls without write access', () => {
    const { el } = setup({ canWrite: false });

    expect(el.querySelector('[data-testid="save-supplier"]')).toBeNull();
    expect(el.querySelector('[data-testid="link-form"]')).toBeNull();
  });
});
