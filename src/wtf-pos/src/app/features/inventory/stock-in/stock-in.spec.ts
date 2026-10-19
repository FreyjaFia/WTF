import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AlertService, InventoryService } from '@core/services';
import { ItemDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StockInComponent } from './stock-in';

const milk = { id: 'item-1', name: 'Milk', unitName: 'ml', currentQuantity: 500 } as ItemDto;

interface StockInVm {
  form: { patchValue: (value: object) => void };
  save: () => void;
}

describe('StockInComponent', () => {
  function setup(options: { itemId?: string; addStock?: unknown } = {}) {
    const inventory = {
      getInventoryItems: vi.fn().mockReturnValue(of([milk])),
      addStock: vi.fn().mockReturnValue(options.addStock ?? of({ ...milk, currentQuantity: 1500 })),
    };
    const alerts = { success: vi.fn(), error: vi.fn() };
    const router = { navigateByUrl: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(options.itemId ? { itemId: options.itemId } : {}),
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(StockInComponent);
    fixture.detectChanges();
    return { fixture, inventory, alerts, router, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the form with the active items', () => {
    const { el } = setup();
    expect(el.querySelector('h1')?.textContent).toContain('Stock In');
    expect(el.querySelectorAll('option').length).toBe(2);
  });

  it('preselects the item from the query string', () => {
    const { el } = setup({ itemId: 'item-1' });
    expect((el.querySelector('#stock-in-item') as HTMLSelectElement).value).toBe('item-1');
    expect(el.textContent).toContain('In stock now: 500');
  });

  it('does not save without an item and a quantity', () => {
    const { fixture, inventory, el } = setup();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(inventory.addStock).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Choose the item that arrived.');
  });

  it('adds the stock and opens the item', () => {
    const { fixture, inventory, alerts, router } = setup({ itemId: 'item-1' });
    const component = fixture.componentInstance as unknown as StockInVm;
    component.form.patchValue({ quantity: 1000, unitCost: 0.15, notes: ' delivery ' });
    component.save();

    expect(inventory.addStock).toHaveBeenCalledWith({
      itemId: 'item-1',
      quantity: 1000,
      unitCost: 0.15,
      notes: 'delivery',
    });
    expect(alerts.success).toHaveBeenCalledWith('Stock added.');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/inventory/items/details/item-1');
  });

  it('shows the error and stays when saving fails', () => {
    const { fixture, alerts, router } = setup({
      itemId: 'item-1',
      addStock: throwError(() => new Error('Nope')),
    });
    const component = fixture.componentInstance as unknown as StockInVm;
    component.form.patchValue({ quantity: 5 });
    component.save();

    expect(alerts.error).toHaveBeenCalledWith('Nope');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
