import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AlertService, AuthService, PurchaseOrderService, ReorderService } from '@core/services';
import { ParLevelRowDto, ReorderListDto } from '@shared/models';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ReorderComponent } from './reorder';

const list: ReorderListDto = {
  belowParCount: 1,
  itemsWithoutPar: 2,
  groups: [
    {
      supplierId: 's1',
      supplierName: 'Metro Dairy',
      leadTimeDays: 2,
      estimatedCost: 3360,
      lines: [
        {
          itemId: 'i1',
          itemName: 'Oat Milk',
          unitName: 'bottle',
          onHand: 10,
          parLevel: 48,
          onOrder: 0,
          daysOfCover: 5,
          suggestedUnits: 48,
          suggestedPacks: 4,
          packName: 'carton',
          unitsPerPack: 12,
          packPrice: 840,
          estimatedCost: 3360,
        },
      ],
    },
  ],
};

const row: ParLevelRowDto = { itemId: 'i1', itemName: 'Oat Milk', unitName: 'bottle', onHand: 10, parLevel: 48 };

interface Vm {
  togglePar: () => void;
  savePar: (row: ParLevelRowDto, input: HTMLInputElement) => void;
  createOrder: (group: ReorderListDto['groups'][number]) => void;
}

describe('ReorderComponent', () => {
  function setup(options: { list?: ReorderListDto; canSeeCosts?: boolean } = {}) {
    const service = {
      getReorderList: vi.fn().mockReturnValue(of(options.list ?? list)),
      getParLevels: vi.fn().mockReturnValue(of([row])),
      setParLevel: vi.fn().mockReturnValue(of({ ...row, parLevel: 60 })),
    };
    const orders = { createFromReorder: vi.fn().mockReturnValue(of({ summary: { id: 'p1', poNumber: 7 } })) };
    const router = { navigateByUrl: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ReorderService, useValue: service },
        { provide: PurchaseOrderService, useValue: orders },
        { provide: Router, useValue: router },
        { provide: AlertService, useValue: { error: vi.fn(), success: vi.fn() } },
        { provide: AuthService, useValue: { canWriteStockMovements: () => true, canReadInventoryCosts: () => options.canSeeCosts ?? true } },
      ],
    });
    const fixture = TestBed.createComponent(ReorderComponent);
    fixture.detectChanges();
    return { fixture, service, orders, router, el: fixture.nativeElement as HTMLElement, vm: fixture.componentInstance as unknown as Vm };
  }

  it('groups items by supplier and suggests whole packs', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="reorder-group"]')?.textContent).toContain('Metro Dairy');
    const line = el.querySelector('[data-testid="reorder-line"]')?.textContent ?? '';
    expect(line).toContain('Oat Milk');
    expect(line).toContain('4 carton');
    expect(line).toContain('5 days left');
  });

  it('shows the estimated cost only to roles that can read costs', () => {
    expect(setup().el.textContent).toContain('3,360.00');
    TestBed.resetTestingModule();
    expect(setup({ canSeeCosts: false }).el.textContent).not.toContain('3,360.00');
  });

  it('says so when nothing is below par', () => {
    const { el } = setup({ list: { groups: [], belowParCount: 0, itemsWithoutPar: 2 } });

    expect(el.querySelector('[data-testid="reorder-empty"]')?.textContent).toContain('2 items have no par level');
  });

  it('saves a changed par level and reloads the list', () => {
    const { service, vm } = setup();
    vm.togglePar();
    const input = document.createElement('input');
    input.value = '60';

    vm.savePar(row, input);

    expect(service.setParLevel).toHaveBeenCalledWith('i1', 60);
    expect(service.getReorderList).toHaveBeenCalledTimes(2);
  });

  it('does not call the API when the par level did not change', () => {
    const { service, vm } = setup();
    const input = document.createElement('input');
    input.value = '48';

    vm.savePar(row, input);

    expect(service.setParLevel).not.toHaveBeenCalled();
  });

  it('refuses a negative par level', () => {
    const { service, vm } = setup();
    const input = document.createElement('input');
    input.value = '-3';

    vm.savePar(row, input);

    expect(service.setParLevel).not.toHaveBeenCalled();
  });

  it('drafts an order for a supplier group and opens the orders screen', () => {
    const { vm, orders, router } = setup();

    vm.createOrder(list.groups[0]);

    expect(orders.createFromReorder).toHaveBeenCalledWith('s1');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/inventory/purchase-orders');
  });

  it('offers no create button for items without a supplier', () => {
    const noSupplier = { ...list, groups: [{ ...list.groups[0], supplierId: null, supplierName: 'No supplier' }] };
    const { el } = setup({ list: noSupplier });

    expect(el.querySelector('[data-testid="create-order"]')).toBeNull();
  });
});
