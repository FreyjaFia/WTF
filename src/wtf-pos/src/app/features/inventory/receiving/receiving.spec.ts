import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import {
  AlertService,
  AuthService,
  InventoryService,
  PurchaseOrderService,
  StockReceiptService,
  SupplierService,
} from '@core/services';
import { StockReceiptDto, StockReceiptSummaryDto, SupplierDto } from '@shared/models';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ReceivingComponent } from './receiving';

const summary: StockReceiptSummaryDto = {
  id: 'r1',
  supplierId: 's1',
  supplierName: 'Metro Dairy',
  receivedOn: '2026-11-08',
  invoiceNumber: 'INV-100',
  invoiceTotal: 1700,
  linesTotal: 1680,
  difference: 20,
  note: null,
  createdAt: '2026-11-08T01:00:00Z',
  createdByName: 'admin',
  lineCount: 1,
  purchaseOrderId: null,
  purchaseOrderNumber: null,
};

const supplier = {
  summary: { id: 's1', name: 'Metro Dairy' },
  items: [{ itemId: 'i1', packName: 'carton', unitsPerPack: 12, packPrice: 840 }],
} as unknown as SupplierDto;

interface Vm {
  header: { patchValue: (value: object) => void };
  lines: { at: (i: number) => { patchValue: (value: object) => void; getRawValue: () => Record<string, unknown> } };
  openForm: () => void;
  chooseSupplier: () => void;
  chooseItem: (index: number) => void;
  chooseOrder: (id: string) => void;
  save: () => void;
  linesTotal: () => number | null;
  difference: () => number | null;
  toggleSort: (column: 'receipt' | 'received' | 'items' | 'total') => void;
  sortDirection: () => string;
  goToPage: (page: number) => void;
  changePageSize: (size: number) => void;
  page: () => number;
  searchControl: { setValue: (value: string) => void };
}

const paged = (items: StockReceiptSummaryDto[], totalCount = items.length) => ({
  items,
  page: 1,
  pageSize: 25,
  totalCount,
});

describe('ReceivingComponent', () => {
  describe('searching, sorting and paging on the server', () => {
    const lastQuery = (service: { getReceiptsPaged: ReturnType<typeof vi.fn> }): Record<string, unknown> =>
      service.getReceiptsPaged.mock.calls.at(-1)![0];

    it('asks for the first page of 25 in the server order until a column is picked', () => {
      const { receipts } = setup();
      expect(lastQuery(receipts)).toEqual({ search: null, sortBy: null, sortDirection: null, page: 1, pageSize: 25 });
    });

    it('asks the server to sort, reverses on a second pick and returns to page 1', () => {
      const { vm, receipts } = setup();
      vm.goToPage(3);

      vm.toggleSort('receipt');
      expect(lastQuery(receipts)).toMatchObject({ sortBy: 'receipt', sortDirection: 'asc', page: 1 });

      vm.toggleSort('receipt');
      expect(vm.sortDirection()).toBe('desc');
      expect(lastQuery(receipts)).toMatchObject({ sortBy: 'receipt', sortDirection: 'desc' });
    });

    it('sorts by received date, item count and total on the server', () => {
      const { vm, receipts } = setup();
      for (const column of ['received', 'items', 'total'] as const) {
        vm.toggleSort(column);
        expect(lastQuery(receipts)).toMatchObject({ sortBy: column, sortDirection: 'asc' });
      }
    });

    it('searches on the server after a short pause and returns to page 1', () => {
      vi.useFakeTimers();
      try {
        const { vm, receipts } = setup();
        vm.goToPage(4);

        vm.searchControl.setValue(' metro ');
        vi.advanceTimersByTime(300);

        expect(lastQuery(receipts)).toMatchObject({ search: 'metro', page: 1 });
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes back to page 1 when the rows per page change', () => {
      const { vm, receipts } = setup();
      vm.goToPage(2);

      vm.changePageSize(50);

      expect(lastQuery(receipts)).toMatchObject({ page: 1, pageSize: 50 });
    });

    it('shows the pagination bar and follows the page the server returns', () => {
      const { vm, receipts, el, fixture } = setup();
      expect(el.querySelector('app-pagination')).not.toBeNull();
      receipts.getReceiptsPaged.mockReturnValue(of({ ...paged([summary], 30), page: 2 }));

      vm.goToPage(9);
      fixture.detectChanges();

      expect(vm.page()).toBe(2);
    });
  });

  function setup(options: { canWrite?: boolean; canSeeCosts?: boolean; receipts?: StockReceiptSummaryDto[] } = {}) {
    const receipts = {
      getReceiptsPaged: vi.fn().mockReturnValue(of(paged(options.receipts ?? [summary]))),
      getReceipt: vi.fn().mockReturnValue(of({ summary, lines: [] } as StockReceiptDto)),
      recordReceipt: vi.fn().mockReturnValue(of({ summary, lines: [] } as StockReceiptDto)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StockReceiptService, useValue: receipts },
        {
          provide: PurchaseOrderService,
          useValue: {
            getOrders: vi.fn().mockReturnValue(of([{ id: 'p1', poNumber: 7, lineCount: 2 }])),
            getOrder: vi.fn().mockReturnValue(
              of({
                summary: { id: 'p1' },
                lines: [
                  { itemId: 'i1', packName: 'carton', unitsPerPack: 12, packPrice: 840, packsOrdered: 4, packsReceived: 1 },
                  { itemId: 'i2', packName: null, unitsPerPack: 1, packPrice: null, packsOrdered: 2, packsReceived: 2 },
                ],
              }),
            ),
          },
        },
        { provide: SupplierService, useValue: { getSuppliers: vi.fn().mockReturnValue(of([supplier.summary])), getSupplier: vi.fn().mockReturnValue(of(supplier)) } },
        { provide: InventoryService, useValue: { getInventoryItems: vi.fn().mockReturnValue(of([{ id: 'i1', name: 'Oat Milk', unitName: 'bottle' }])) } },
        { provide: AlertService, useValue: { error: vi.fn(), success: vi.fn() } },
        {
          provide: AuthService,
          useValue: {
            canWritePurchasing: () => options.canWrite ?? true,
            canReadInventoryCosts: () => options.canSeeCosts ?? true,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ReceivingComponent);
    fixture.detectChanges();
    return { fixture, receipts, el: fixture.nativeElement as HTMLElement, vm: fixture.componentInstance as unknown as Vm };
  }

  it('lists receipts with the supplier, invoice and total', () => {
    const { el } = setup();

    const text = el.querySelector('[data-testid="receipt-row"]')?.textContent ?? '';
    expect(text).toContain('Metro Dairy');
    expect(text).toContain('INV-100');
    expect(text).toContain('1,680.00');
  });

  it('hides the receive button without write access', () => {
    const { el } = setup({ canWrite: false });

    expect(el.querySelector('[data-testid="open-receipt"]')).toBeNull();
  });

  it('prefills the pack from the supplier when an item is chosen', () => {
    const { vm } = setup();
    vm.openForm();
    vm.header.patchValue({ supplierId: 's1' });
    vm.chooseSupplier();

    vm.lines.at(0).patchValue({ itemId: 'i1' });
    vm.chooseItem(0);

    expect(vm.lines.at(0).getRawValue()).toMatchObject({ packName: 'carton', unitsPerPack: 12, packPrice: 840 });
  });

  it('works out the lines total and the difference from the invoice', () => {
    const { vm } = setup();
    vm.openForm();
    vm.header.patchValue({ invoiceTotal: 1700 });
    vm.lines.at(0).patchValue({ itemId: 'i1', packs: 2, unitsPerPack: 12, packPrice: 840 });

    expect(vm.linesTotal()).toBe(1680);
    expect(vm.difference()).toBe(20);
  });

  it('records the receipt with a request id and the typed lines', () => {
    const { vm, receipts } = setup();
    vm.openForm();
    vm.header.patchValue({ supplierId: 's1', invoiceNumber: ' INV-100 ' });
    vm.lines.at(0).patchValue({ itemId: 'i1', packs: 2, unitsPerPack: 12, packPrice: 840, packName: 'carton' });

    vm.save();

    const payload = receipts.recordReceipt.mock.calls[0][0];
    expect(payload).toMatchObject({
      supplierId: 's1',
      invoiceNumber: 'INV-100',
      lines: [{ itemId: 'i1', packs: 2, unitsPerPack: 12, packPrice: 840, packName: 'carton' }],
    });
    expect(payload.clientRequestId).toBeTruthy();
  });

  it('does not record a receipt without a supplier or item', () => {
    const { vm, receipts } = setup();
    vm.openForm();

    vm.save();

    expect(receipts.recordReceipt).not.toHaveBeenCalled();
  });

  it('hides prices from roles that cannot read costs', () => {
    const { vm, el, fixture } = setup({ canSeeCosts: false });
    vm.openForm();
    fixture.detectChanges();

    expect(el.querySelector('#rl-price-0')).toBeNull();
    expect(el.querySelector('#rc-total')).toBeNull();
  });

  it('fills the lines with what is still to come when received against an order', () => {
    const { vm, receipts } = setup();
    vm.openForm();
    vm.header.patchValue({ supplierId: 's1' });
    vm.chooseSupplier();

    vm.chooseOrder('p1');

    expect(vm.lines.at(0).getRawValue()).toMatchObject({ itemId: 'i1', packs: 3, unitsPerPack: 12 });
    vm.save();
    expect(receipts.recordReceipt.mock.calls[0][0].purchaseOrderId).toBe('p1');
  });
});
