import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AlertService, AuthService, SupplierService } from '@core/services';
import { SupplierDto, SupplierSummaryDto } from '@shared/models';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SuppliersComponent } from './suppliers';

const summary = (overrides: Partial<SupplierSummaryDto> = {}): SupplierSummaryDto => ({
  id: 's1',
  name: 'Metro Dairy',
  contactName: 'Ana',
  phone: '0917',
  email: null,
  address: null,
  leadTimeDays: 2,
  paymentTerms: null,
  notes: null,
  isActive: true,
  itemCount: 3,
  ...overrides,
});

interface Vm {
  form: { patchValue: (value: object) => void };
  create: () => void;
  openForm: () => void;
  setShowInactive: (value: boolean) => void;
}

describe('SuppliersComponent', () => {
  function setup(options: { canWrite?: boolean; suppliers?: SupplierSummaryDto[] } = {}) {
    const service = {
      getSuppliers: vi.fn().mockReturnValue(of(options.suppliers ?? [summary()])),
      createSupplier: vi.fn().mockReturnValue(of({ summary: summary({ id: 'new' }), items: [] } as SupplierDto)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SupplierService, useValue: service },
        { provide: AlertService, useValue: { error: vi.fn(), success: vi.fn() } },
        { provide: AuthService, useValue: { canWriteStockMovements: () => options.canWrite ?? true } },
      ],
    });
    const fixture = TestBed.createComponent(SuppliersComponent);
    fixture.detectChanges();
    return {
      fixture,
      service,
      el: fixture.nativeElement as HTMLElement,
      vm: fixture.componentInstance as unknown as Vm,
      router: TestBed.inject(Router),
    };
  }

  it('lists suppliers with contact, lead time and item count', () => {
    const { el } = setup();

    const text = el.querySelector('[data-testid="supplier-row"]')?.textContent ?? '';
    expect(text).toContain('Metro Dairy');
    expect(text).toContain('Ana');
    expect(text).toContain('2 day lead time');
    expect(text).toContain('3 items');
  });

  it('shows an empty state when there are no suppliers', () => {
    const { el } = setup({ suppliers: [] });

    expect(el.querySelector('[data-testid="suppliers-empty"]')).not.toBeNull();
  });

  it('hides the add button without write access', () => {
    const { el } = setup({ canWrite: false });

    expect(el.querySelector('[data-testid="open-new"]')).toBeNull();
  });

  it('does not create a supplier without a name', () => {
    const { service, vm } = setup();

    vm.openForm();
    vm.create();

    expect(service.createSupplier).not.toHaveBeenCalled();
  });

  it('creates a supplier and opens it', () => {
    const { service, vm, router } = setup();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    vm.openForm();
    vm.form.patchValue({ name: ' Farm Fresh ', leadTimeDays: 3 });
    vm.create();

    expect(service.createSupplier).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Farm Fresh', leadTimeDays: 3, contactName: null }),
    );
    expect(navigate).toHaveBeenCalledWith('/management/setup/suppliers/new');
  });

  it('asks for inactive suppliers when the box is ticked', () => {
    const { service, vm } = setup();

    vm.setShowInactive(true);

    expect(service.getSuppliers).toHaveBeenLastCalledWith({ includeInactive: true });
  });
});
