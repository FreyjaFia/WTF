import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService, AuthService, BranchService, InventoryService, StockTransferService } from '@core/services';
import { PagedResultDto, StockTransferSummaryDto } from '@shared/models';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StockTransfersComponent } from './stock-transfers';

const row = (overrides: Partial<StockTransferSummaryDto> = {}): StockTransferSummaryDto => ({
  id: 't1',
  fromBranchId: 'b1',
  fromBranchCode: 'MKT',
  fromBranchName: 'Makati',
  toBranchId: 'b2',
  toBranchCode: 'BGC',
  toBranchName: 'BGC',
  notes: 'Beans for the weekend',
  createdAt: '2026-11-18T02:00:00Z',
  createdByName: 'Alain E',
  lineCount: 2,
  totalQuantity: 1200,
  ...overrides,
});

const paged = (items: StockTransferSummaryDto[]): PagedResultDto<StockTransferSummaryDto> => ({
  items,
  page: 1,
  pageSize: 25,
  totalCount: items.length,
});

interface Vm {
  canMove: () => boolean;
  destinations: () => { id: string }[];
  form: { patchValue: (value: object) => void };
  lines: { length: number; at: (i: number) => { patchValue: (v: object) => void } };
  openForm: () => void;
  addLine: () => void;
  removeLine: (index: number) => void;
  submit: () => void;
}

describe('StockTransfersComponent', () => {
  function setup(options: { active?: string; canWrite?: boolean } = {}) {
    const service = {
      getTransfersPaged: vi.fn().mockReturnValue(of(paged([row()]))),
      createTransfer: vi.fn().mockReturnValue(of({ summary: row(), lines: [] })),
    };
    const branches = {
      branches: signal([
        { id: 'b1', name: 'Makati', code: 'MKT', isMain: true, isActive: true },
        { id: 'b2', name: 'BGC', code: 'BGC', isMain: false, isActive: true },
        { id: 'b3', name: 'Old', code: 'OLD', isMain: false, isActive: false },
      ]),
      activeId: signal(options.active ?? 'b1'),
      isAllSelected: () => (options.active ?? 'b1') === 'all',
      activeLabel: signal('Makati'),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StockTransferService, useValue: service },
        { provide: InventoryService, useValue: { getInventoryItems: vi.fn().mockReturnValue(of([])) } },
        { provide: AlertService, useValue: { error: vi.fn(), success: vi.fn() } },
        { provide: AuthService, useValue: { canWriteStockMovements: () => options.canWrite ?? true } },
        { provide: BranchService, useValue: branches },
      ],
    });
    const fixture = TestBed.createComponent(StockTransfersComponent);
    fixture.detectChanges();
    return { fixture, service, vm: fixture.componentInstance as unknown as Vm };
  }

  it('lists the transfers', () => {
    const { fixture } = setup();

    expect(fixture.nativeElement.querySelectorAll('[data-testid="transfer-row"]').length).toBe(1);
  });

  it('only offers the other active branches as a destination', () => {
    const { vm } = setup();

    expect(vm.destinations().map((b) => b.id)).toEqual(['b2']);
    expect(vm.canMove()).toBe(true);
  });

  it('cannot move stock out of All branches or without the stock permission', () => {
    expect(setup({ active: 'all' }).vm.canMove()).toBe(false);
    TestBed.resetTestingModule();
    expect(setup({ canWrite: false }).vm.canMove()).toBe(false);
  });

  it('keeps one line and sends the filled form', () => {
    const { vm, service } = setup();
    vm.openForm();
    vm.removeLine(0);
    expect(vm.lines.length).toBe(1);

    vm.form.patchValue({ toBranchId: 'b2', notes: ' Weekend rush ' });
    vm.lines.at(0).patchValue({ itemId: 'i1', quantity: 250 });
    vm.submit();

    expect(service.createTransfer).toHaveBeenCalledWith({
      toBranchId: 'b2',
      notes: 'Weekend rush',
      lines: [{ itemId: 'i1', quantity: 250 }],
    });
  });

  it('does not send a form with no destination or quantity', () => {
    const { vm, service } = setup();
    vm.openForm();

    vm.submit();

    expect(service.createTransfer).not.toHaveBeenCalled();
  });
});
