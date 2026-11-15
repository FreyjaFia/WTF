import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  AlertService,
  AuthService,
  InventoryService,
  PurchaseOrderService,
  SupplierService,
} from '@core/services';
import { PurchaseOrderDto, PurchaseOrderStatus, PurchaseOrderSummaryDto } from '@shared/models';
import { Observable, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseOrdersComponent } from './purchase-orders';

const summary: PurchaseOrderSummaryDto = {
  id: 'p1',
  poNumber: 7,
  supplierId: 's1',
  supplierName: 'Metro Dairy',
  status: PurchaseOrderStatus.Draft,
  expectedOn: null,
  note: null,
  createdAt: '2026-11-08T01:00:00Z',
  createdByName: 'admin',
  sentAt: null,
  lineCount: 1,
  total: 1680,
};

const detail: PurchaseOrderDto = {
  summary,
  receiptIds: [],
  lines: [
    {
      itemId: 'i1',
      itemName: 'Oat Milk',
      unitName: 'bottle',
      packName: 'carton',
      unitsPerPack: 12,
      packPrice: 840,
      packsOrdered: 2,
      packsReceived: 0,
      lineTotal: 1680,
    },
  ],
};

interface Vm {
  header: { patchValue: (value: object) => void };
  lines: { at: (i: number) => { patchValue: (value: object) => void; controls: { unitsPerPack: { value: number | null }; packName: { value: string | null } } } };
  chooseItem: (index: number) => void;
  openForm: () => void;
  editOrder: (order: PurchaseOrderDto) => void;
  toggleOrder: (order: PurchaseOrderSummaryDto) => void;
  chooseSupplier: () => void;
  save: () => void;
  askConfirm: (action: 'send' | 'cancel' | 'close', order: PurchaseOrderDto) => void;
  runPending: () => void;
  searchControl: { setValue: (value: string) => void };
  goToPage: (page: number) => void;
  changePageSize: (size: number) => void;
  page: () => number;
  setFilter: (status: number | null) => void;
  orderTotal: () => number | null;
  toggleSort: (column: 'order' | 'expected' | 'status' | 'total') => void;
  sortDirection: () => string;
}

const paged = (items: PurchaseOrderSummaryDto[], totalCount = items.length) => ({
  items,
  page: 1,
  pageSize: 25,
  totalCount,
});

describe('PurchaseOrdersComponent', () => {
  function setup(
    options: {
      canWrite?: boolean;
      canSeeCosts?: boolean;
      orders?: PurchaseOrderSummaryDto[];
      supplier$?: Observable<unknown>;
    } = {},
  ) {
    const api = {
      getOrdersPaged: vi.fn().mockReturnValue(of(paged(options.orders ?? [summary]))),
      getOrder: vi.fn().mockReturnValue(of(detail)),
      createOrder: vi.fn().mockReturnValue(of(detail)),
      updateOrder: vi.fn().mockReturnValue(of(detail)),
      sendOrder: vi.fn().mockReturnValue(of({ ...detail, summary: { ...summary, status: PurchaseOrderStatus.Sent } })),
      cancelOrder: vi.fn(),
      closeOrder: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PurchaseOrderService, useValue: api },
        {
          provide: SupplierService,
          useValue: {
            getSuppliers: vi.fn().mockReturnValue(of([{ id: 's1', name: 'Metro Dairy' }])),
            getSupplier: vi.fn().mockReturnValue(options.supplier$ ?? of({ items: [{ itemId: 'i1', packName: 'carton', unitsPerPack: 12, packPrice: 840 }] })),
          },
        },
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
    const fixture = TestBed.createComponent(PurchaseOrdersComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    return { fixture, api, navigate, el: fixture.nativeElement as HTMLElement, vm: fixture.componentInstance as unknown as Vm };
  }

  it('lists orders with number, supplier, status and total', () => {
    const { el } = setup();

    const text = el.querySelector('[data-testid="order-row"]')?.textContent ?? '';
    expect(text).toContain('PO-7');
    expect(text).toContain('Metro Dairy');
    expect(text).toContain('Draft');
    expect(text).toContain('1,680.00');
  });

  it('opens the suggested orders view from its button', () => {
    const { el, navigate } = setup();

    (el.querySelector('[data-testid="open-suggestions"]') as HTMLButtonElement).click();

    expect(navigate).toHaveBeenCalledWith('/inventory/purchase-orders/suggestions');
  });

  describe('searching, sorting and paging on the server', () => {
    const lastQuery = (api: { getOrdersPaged: ReturnType<typeof vi.fn> }): Record<string, unknown> =>
      api.getOrdersPaged.mock.calls.at(-1)![0];

    it('asks for the first page of 25 in the server order until a column is picked', () => {
      const { api } = setup();
      expect(lastQuery(api)).toEqual({
        status: null,
        search: null,
        sortBy: null,
        sortDirection: null,
        page: 1,
        pageSize: 25,
      });
    });

    it('asks the server to sort, reverses on a second pick and returns to page 1', () => {
      const { vm, api } = setup();
      vm.goToPage(3);

      vm.toggleSort('order');
      expect(lastQuery(api)).toMatchObject({ sortBy: 'order', sortDirection: 'asc', page: 1 });

      vm.toggleSort('order');
      expect(vm.sortDirection()).toBe('desc');
      expect(lastQuery(api)).toMatchObject({ sortBy: 'order', sortDirection: 'desc' });
    });

    it('sorts by expected date, status and total on the server', () => {
      const { vm, api } = setup();
      for (const column of ['expected', 'status', 'total'] as const) {
        vm.toggleSort(column);
        expect(lastQuery(api)).toMatchObject({ sortBy: column, sortDirection: 'asc' });
      }
    });

    it('filters by status through the API and returns to page 1', () => {
      const { vm, api } = setup();
      vm.goToPage(2);

      vm.setFilter(PurchaseOrderStatus.Sent);

      expect(lastQuery(api)).toMatchObject({ status: PurchaseOrderStatus.Sent, page: 1 });
    });

    it('searches on the server after a short pause and returns to page 1', () => {
      vi.useFakeTimers();
      try {
        const { vm, api } = setup();
        vm.goToPage(4);

        vm.searchControl.setValue(' po-7 ');
        vi.advanceTimersByTime(300);

        expect(lastQuery(api)).toMatchObject({ search: 'po-7', page: 1 });
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes back to page 1 when the rows per page change', () => {
      const { vm, api } = setup();
      vm.goToPage(2);

      vm.changePageSize(50);

      expect(lastQuery(api)).toMatchObject({ page: 1, pageSize: 50 });
    });

    it('shows the pagination bar and follows the page the server returns', () => {
      const { vm, api, el, fixture } = setup();
      expect(el.querySelector('app-pagination')).not.toBeNull();
      api.getOrdersPaged.mockReturnValue(of({ ...paged([summary], 30), page: 2 }));

      vm.goToPage(9);
      fixture.detectChanges();

      expect(vm.page()).toBe(2);
    });
  });

  it('hides the new order button without write access', () => {
    expect(setup({ canWrite: false }).el.querySelector('[data-testid="open-order"]')).toBeNull();
  });

  it('saves a new draft with the typed lines', () => {
    const { vm, api } = setup();
    vm.openForm();
    vm.header.patchValue({ supplierId: 's1', note: ' soon ' });
    vm.lines.at(0).patchValue({ itemId: 'i1', packs: 2, unitsPerPack: 12, packPrice: 840, packName: 'carton' });

    expect(vm.orderTotal()).toBe(1680);
    vm.save();

    expect(api.createOrder).toHaveBeenCalledWith({
      supplierId: 's1',
      expectedOn: null,
      note: 'soon',
      lines: [{ itemId: 'i1', packs: 2, unitsPerPack: 12, packPrice: 840, packName: 'carton' }],
    });
  });

  it('fills the pack details of an item picked before the supplier answered', () => {
    const supplier$ = new Subject<unknown>();
    const { vm } = setup({ supplier$ });
    vm.openForm();
    vm.header.patchValue({ supplierId: 's1' });
    vm.chooseSupplier();
    vm.lines.at(0).patchValue({ itemId: 'i1' });
    vm.chooseItem(0);
    expect(vm.lines.at(0).controls.unitsPerPack.value).toBe(1);

    supplier$.next({ items: [{ itemId: 'i1', packName: 'carton', unitsPerPack: 12, packPrice: 840 }] });

    expect(vm.lines.at(0).controls.unitsPerPack.value).toBe(12);
    expect(vm.lines.at(0).controls.packName.value).toBe('carton');
  });

  it('does not save an empty order', () => {
    const { vm, api } = setup();
    vm.openForm();

    vm.save();

    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it('updates a draft that is being edited', () => {
    const { vm, api } = setup();
    vm.editOrder(detail);

    vm.save();

    expect(api.updateOrder).toHaveBeenCalledWith('p1', expect.objectContaining({ supplierId: 's1' }));
  });

  it('shows draft actions when an order is opened', () => {
    const { vm, el, fixture } = setup();
    vm.toggleOrder(summary);
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="send-order"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="close-order"]')).toBeNull();
  });

  it('asks before sending, and sends once confirmed', () => {
    const { vm, api, el, fixture } = setup();

    vm.askConfirm('send', detail);
    fixture.detectChanges();
    expect(el.querySelector('app-confirm-dialog')?.textContent).toContain('PO-7');
    expect(api.sendOrder).not.toHaveBeenCalled();

    vm.runPending();
    fixture.detectChanges();

    expect(api.sendOrder).toHaveBeenCalledWith('p1');
    expect(el.querySelector('app-confirm-dialog')).toBeNull();
  });

  it('cancels and closes through the same confirmation', () => {
    const { vm, api } = setup();
    api.cancelOrder.mockReturnValue(of(detail));
    api.closeOrder.mockReturnValue(of(detail));

    vm.askConfirm('cancel', detail);
    vm.runPending();
    vm.askConfirm('close', detail);
    vm.runPending();

    expect(api.cancelOrder).toHaveBeenCalledWith('p1');
    expect(api.closeOrder).toHaveBeenCalledWith('p1');
  });

  it('shows the status as a badge', () => {
    const { el } = setup();

    expect(el.querySelector('app-badge')?.textContent).toContain('Draft');
  });
});
