import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, ConnectivityService, StockWasteService } from '@core/services';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordWasteComponent } from './record-waste';

function wasteItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-1',
    name: 'Oat Milk',
    baseUnit: 'Milliliter',
    currentQuantity: 500,
    allowNegativeStock: false,
    wasteApprovalLimit: 100,
    ...overrides,
  };
}

describe('RecordWasteComponent (item picker)', () => {
  let fixture: ComponentFixture<RecordWasteComponent>;
  let stockWaste: { getWasteItems: ReturnType<typeof vi.fn> };
  let isOnline: ReturnType<typeof signal<boolean>>;

  function create(): RecordWasteComponent {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StockWasteService, useValue: stockWaste },
        { provide: ConnectivityService, useValue: { isOnline } },
        { provide: AuthService, useValue: { canReadStockMovements: () => true } },
      ],
    });
    fixture = TestBed.createComponent(RecordWasteComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const tiles = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="record-waste-item"]'));

  beforeEach(() => {
    isOnline = signal(true);
    stockWaste = {
      getWasteItems: vi.fn(() =>
        of([
          wasteItem(),
          wasteItem({ id: 'item-3', name: 'Cups', currentQuantity: 40, baseUnit: 'Piece' }),
          wasteItem({ id: 'item-2', name: 'Empty Box', currentQuantity: 0 }),
        ]),
      ),
    };
  });

  it('lists only items with stock, sorted by name, each linking to its own page', () => {
    create();

    expect(tiles()).toHaveLength(2);
    expect(tiles()[0].textContent).toContain('Cups');
    expect(tiles()[1].textContent).toContain('Oat Milk');
    expect(tiles()[1].getAttribute('href')).toBe('/inventory/waste/record/item-1');
  });

  it('filters by name', () => {
    const component = create();

    (component as unknown as { searchTerm: { set: (v: string) => void } }).searchTerm.set('oat');
    fixture.detectChanges();

    expect(tiles()).toHaveLength(1);
  });

  it('says when nothing has stock', () => {
    stockWaste.getWasteItems.mockReturnValue(of([wasteItem({ currentQuantity: 0 })]));
    create();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="record-waste-empty"]')).not.toBeNull();
  });

  it('shows the error and retries', () => {
    stockWaste.getWasteItems.mockReturnValueOnce(throwError(() => new Error('Items failed.')));
    create();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Items failed.');

    const retry = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Try Again',
    ) as HTMLButtonElement;
    retry.click();
    fixture.detectChanges();

    expect(stockWaste.getWasteItems).toHaveBeenCalledTimes(2);
    expect(tiles()).toHaveLength(2);
  });
});
