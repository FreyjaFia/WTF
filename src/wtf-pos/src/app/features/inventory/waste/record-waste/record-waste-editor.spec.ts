import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  AlertService,
  AuthService,
  ConnectivityService,
  ModalStackService,
  StockWasteService,
  WasteReasonService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordWasteEditorComponent } from './record-waste-editor';

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

const reasons = [
  { id: 1, name: 'Spilled', isActive: true, sortOrder: 1, requiresNote: false },
  { id: 2, name: 'Other', isActive: true, sortOrder: 2, requiresNote: true },
];

type Internals = {
  form: { setValue: (v: unknown) => void; markAsDirty: () => void };
  error: () => string | null;
  isSaving: () => boolean;
  isBlocked: () => boolean;
  showDiscardModal: () => boolean;
  save: () => void;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
};

describe('RecordWasteEditorComponent', () => {
  let fixture: ComponentFixture<RecordWasteEditorComponent>;
  let component: RecordWasteEditorComponent;
  let stockWaste: { getWasteItems: ReturnType<typeof vi.fn>; recordWaste: ReturnType<typeof vi.fn> };
  let alerts: { success: ReturnType<typeof vi.fn> };
  let modalStack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let isOnline: ReturnType<typeof signal<boolean>>;
  let itemId: string;
  let canSeeList: boolean;

  function create(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StockWasteService, useValue: stockWaste },
        { provide: WasteReasonService, useValue: { getReasons: () => of(reasons) } },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: modalStack },
        { provide: ConnectivityService, useValue: { isOnline } },
        { provide: AuthService, useValue: { canReadStockMovements: () => canSeeList } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ itemId }) } } },
      ],
    });
    fixture = TestBed.createComponent(RecordWasteEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const vm = () => component as unknown as Internals;
  const el = () => fixture.nativeElement as HTMLElement;

  function fill(quantity: number | null, reasonId = '1', notes = ''): void {
    vm().form.setValue({ quantity, reasonId, notes });
    vm().form.markAsDirty();
    fixture.detectChanges();
  }

  beforeEach(() => {
    isOnline = signal(true);
    itemId = 'item-1';
    canSeeList = true;
    alerts = { success: vi.fn() };
    modalStack = { push: vi.fn().mockReturnValue(7), remove: vi.fn() };
    stockWaste = {
      getWasteItems: vi.fn(() => of([wasteItem()])),
      recordWaste: vi.fn(() => of({ status: 'Recorded' })),
    };
  });

  it('opens the form for the item in the address', () => {
    create();

    expect(el().querySelector('[data-testid="record-waste-selected"]')?.textContent).toContain('Oat Milk');
  });

  it('points to the picker when the item has no stock or was not found', () => {
    itemId = 'missing';
    create();

    expect(el().querySelector('[data-testid="record-waste-missing"]')).not.toBeNull();
  });

  it('asks for the quantity, the reason and a required note', () => {
    create();

    fill(null);
    vm().save();
    expect(vm().error()).toBe('Enter how much was wasted.');

    fill(10, '');
    vm().save();
    expect(vm().error()).toBe('Choose a reason.');

    fill(10, '2');
    vm().save();
    expect(vm().error()).toContain('A note is required');
    expect(stockWaste.recordWaste).not.toHaveBeenCalled();
  });

  it('blocks more than the balance when the item cannot go negative', () => {
    create();

    fill(600);
    vm().save();

    expect(vm().isBlocked()).toBe(true);
    expect(stockWaste.recordWaste).not.toHaveBeenCalled();
  });

  it('says when the waste needs review', () => {
    create();

    fill(200);

    expect(el().querySelector('[data-testid="waste-needs-review"]')).not.toBeNull();
  });

  it('records the waste, confirms and returns to the Waste list without asking to discard', () => {
    create();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fill(25, '1', ' spilled ');
    vm().save();

    expect(stockWaste.recordWaste).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'item-1', quantity: 25, wasteReasonId: 1, notes: 'spilled' }),
    );
    expect(alerts.success).toHaveBeenCalledWith('Waste recorded.');
    expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryWaste);
    expect(component.canDeactivate()).toBe(true);
  });

  it('goes back to the picker after saving when the person cannot read the Waste list', () => {
    canSeeList = false;
    create();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fill(25);
    vm().save();

    expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryWasteRecord);
  });

  it('keeps the form and shows the error when saving fails', () => {
    stockWaste.recordWaste.mockReturnValue(throwError(() => new Error('Nope.')));
    create();

    fill(25);
    vm().save();

    expect(vm().error()).toBe('Nope.');
    expect(vm().isSaving()).toBe(false);
  });

  it('refuses to save while offline', () => {
    create();
    isOnline.set(false);

    fill(25);
    vm().save();

    expect(stockWaste.recordWaste).not.toHaveBeenCalled();
    expect(vm().error()).toContain('needs a connection');
  });

  describe('leaving the page', () => {
    it('lets go straight away when nothing was typed', () => {
      create();

      expect(component.canDeactivate()).toBe(true);
      expect(vm().showDiscardModal()).toBe(false);
    });

    it('asks first when something was typed, and stays on Keep Editing', async () => {
      create();
      fill(5);

      const result = component.canDeactivate() as Promise<boolean>;
      expect(vm().showDiscardModal()).toBe(true);

      vm().cancelDiscard();

      expect(await result).toBe(false);
      expect(vm().showDiscardModal()).toBe(false);
    });

    it('leaves when the person chooses Discard', async () => {
      create();
      fill(5);

      const result = component.canDeactivate() as Promise<boolean>;
      vm().confirmDiscard();

      expect(await result).toBe(true);
      expect(modalStack.remove).toHaveBeenCalledWith(7);
    });
  });
});
