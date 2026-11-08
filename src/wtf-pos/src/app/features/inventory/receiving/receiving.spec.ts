import { TestBed } from '@angular/core/testing';
import {
  AlertService,
  AuthService,
  InventoryService,
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
  save: () => void;
  linesTotal: () => number | null;
  difference: () => number | null;
}

describe('ReceivingComponent', () => {
  function setup(options: { canWrite?: boolean; canSeeCosts?: boolean } = {}) {
    const receipts = {
      getReceipts: vi.fn().mockReturnValue(of([summary])),
      getReceipt: vi.fn().mockReturnValue(of({ summary, lines: [] } as StockReceiptDto)),
      recordReceipt: vi.fn().mockReturnValue(of({ summary, lines: [] } as StockReceiptDto)),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: StockReceiptService, useValue: receipts },
        { provide: SupplierService, useValue: { getSuppliers: vi.fn().mockReturnValue(of([supplier.summary])), getSupplier: vi.fn().mockReturnValue(of(supplier)) } },
        { provide: InventoryService, useValue: { getInventoryItems: vi.fn().mockReturnValue(of([{ id: 'i1', name: 'Oat Milk', unitName: 'bottle' }])) } },
        { provide: AlertService, useValue: { error: vi.fn(), success: vi.fn() } },
        {
          provide: AuthService,
          useValue: {
            canWriteStockMovements: () => options.canWrite ?? true,
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
});
