import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService, AuthService, BranchService, ConnectivityService, InventoryService, StockTransferService } from '@core/services';
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
  cancelForm: () => void;
  confirmDiscard: () => void;
  keepEditing: () => void;
  isFormOpen: () => boolean;
  showDiscardModal: () => boolean;
}

describe('StockTransfersComponent', () => {
  function setup(options: { active?: string; canWrite?: boolean; items?: object[]; online?: boolean } = {}) {
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
        { provide: InventoryService, useValue: { getInventoryItems: vi.fn().mockReturnValue(of(options.items ?? [])) } },
        { provide: AlertService, useValue: { error: vi.fn(), success: vi.fn() } },
        { provide: AuthService, useValue: { canWriteStockMovements: () => options.canWrite ?? true } },
        { provide: BranchService, useValue: branches },
        { provide: ConnectivityService, useValue: { isOnline: signal(options.online ?? true) } },
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

  it('shows no offline notice and enables Move Stock while online', () => {
    const { fixture } = setup();

    expect(fixture.nativeElement.querySelector('[data-testid="transfers-offline"]')).toBeNull();
    expect((fixture.nativeElement.querySelector('[data-testid="open-transfer"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the offline notice and disables Move Stock while offline', () => {
    const { fixture } = setup({ online: false });

    expect(fixture.nativeElement.querySelector('[data-testid="transfers-offline"]')).not.toBeNull();
    expect((fixture.nativeElement.querySelector('[data-testid="open-transfer"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not send a transfer while offline', () => {
    const { vm, service } = setup({ online: false });
    vm.openForm();
    vm.form.patchValue({ toBranchId: 'b2' });
    vm.lines.at(0).patchValue({ itemId: 'i1', quantity: 250 });

    vm.submit();

    expect(service.createTransfer).not.toHaveBeenCalled();
  });

  it('does not send a form with no destination or quantity', () => {
    const { vm, service } = setup();
    vm.openForm();

    vm.submit();

    expect(service.createTransfer).not.toHaveBeenCalled();
  });

  describe('asking before the form is thrown away', () => {
    it('closes at once when nothing was typed', () => {
      const { vm } = setup();
      vm.openForm();

      vm.cancelForm();

      expect(vm.isFormOpen()).toBe(false);
      expect(vm.showDiscardModal()).toBe(false);
    });

    it('asks "Discard Changes?" when something was typed, and keeps the form on Keep Editing', () => {
      const { vm, fixture } = setup();
      vm.openForm();
      fixture.detectChanges();
      const notes = fixture.nativeElement.querySelector('#transfer-notes') as HTMLInputElement;
      notes.value = 'Weekend rush';
      notes.dispatchEvent(new Event('input'));

      vm.cancelForm();
      fixture.detectChanges();

      expect(vm.showDiscardModal()).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('Discard Changes?');
      expect(vm.isFormOpen()).toBe(true);

      vm.keepEditing();
      expect(vm.showDiscardModal()).toBe(false);
      expect(vm.isFormOpen()).toBe(true);
    });

    it('closes the form once the person confirms the discard', () => {
      const { vm, fixture } = setup();
      vm.openForm();
      fixture.detectChanges();
      const notes = fixture.nativeElement.querySelector('#transfer-notes') as HTMLInputElement;
      notes.value = 'Weekend rush';
      notes.dispatchEvent(new Event('input'));
      vm.cancelForm();

      vm.confirmDiscard();

      expect(vm.isFormOpen()).toBe(false);
      expect(vm.showDiscardModal()).toBe(false);
    });
  });

  describe('the quantity against what is available here', () => {
    const items = [{ id: 'i1', name: 'Arabica beans', unitName: 'kg', currentQuantity: 10 }];

    it('does not send more than the branch has, and says how much there is', () => {
      const { vm, service, fixture } = setup({ items });
      vm.openForm();
      vm.form.patchValue({ toBranchId: 'b2' });
      vm.lines.at(0).patchValue({ itemId: 'i1', quantity: 12 });

      vm.submit();
      fixture.detectChanges();

      expect(service.createTransfer).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('[data-testid="transfer-exceeds"]').textContent).toContain(
        'Only 10 kg available',
      );
    });

    it('sends exactly what the branch has', () => {
      const { vm, service } = setup({ items });
      vm.openForm();
      vm.form.patchValue({ toBranchId: 'b2' });
      vm.lines.at(0).patchValue({ itemId: 'i1', quantity: 10 });

      vm.submit();

      expect(service.createTransfer).toHaveBeenCalledTimes(1);
    });

    it('checks the quantity again when another item is chosen', () => {
      const { vm, service } = setup({
        items: [...items, { id: 'i2', name: 'Oat milk', unitName: 'L', currentQuantity: 50 }],
      });
      vm.openForm();
      vm.form.patchValue({ toBranchId: 'b2' });
      vm.lines.at(0).patchValue({ itemId: 'i2', quantity: 30 });
      vm.lines.at(0).patchValue({ itemId: 'i1' });

      vm.submit();

      expect(service.createTransfer).not.toHaveBeenCalled();
    });
  });
});
