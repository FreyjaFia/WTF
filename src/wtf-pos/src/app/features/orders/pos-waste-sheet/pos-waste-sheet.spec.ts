import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AlertService,
  ConnectivityService,
  ModalStackService,
  StockWasteService,
  WasteReasonService,
} from '@core/services';
import { fakeAlert, internals } from '@app/testing/management-spec-helpers';
import { RecordStockWasteDto, StockWasteSource } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { PosWasteSheetComponent } from './pos-waste-sheet';

const payload = {
  itemId: 'item-1',
  quantity: 2,
  reasonId: 1,
  source: StockWasteSource.Pos,
} as unknown as RecordStockWasteDto;

function wasteItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-1',
    name: 'Oat Milk',
    baseUnit: 'Milliliter',
    currentQuantity: 500,
    allowNegativeStock: true,
    wasteApprovalLimit: 100,
    ...overrides,
  };
}

describe('PosWasteSheetComponent', () => {
  let fixture: ComponentFixture<PosWasteSheetComponent>;
  let stockWaste: { recordWaste: ReturnType<typeof vi.fn>; getWasteItems: ReturnType<typeof vi.fn> };
  let isOnline: ReturnType<typeof signal<boolean>>;
  let alert: ReturnType<typeof fakeAlert>;
  let modalStack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  function create(): void {
    fixture = TestBed.createComponent(PosWasteSheetComponent);
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function buttonByText(text: string): HTMLButtonElement | undefined {
    return Array.from(element().querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === text,
    );
  }

  function itemButtons(): HTMLButtonElement[] {
    return Array.from(element().querySelectorAll('.grid button'));
  }

  beforeEach(() => {
    isOnline = signal(true);
    stockWaste = {
      recordWaste: vi.fn(),
      getWasteItems: vi.fn().mockReturnValue(
        of([
          wasteItem({ id: 'item-2', name: 'Paper Cup', currentQuantity: 0, baseUnit: 'Piece' }),
          wasteItem(),
        ]),
      ),
    };
    alert = fakeAlert();
    modalStack = { push: vi.fn().mockReturnValue(7), remove: vi.fn() };

    TestBed.configureTestingModule({
      imports: [PosWasteSheetComponent],
      providers: [
        { provide: ConnectivityService, useValue: { isOnline } },
        { provide: StockWasteService, useValue: stockWaste },
        { provide: AlertService, useValue: alert },
        { provide: ModalStackService, useValue: modalStack },
        { provide: WasteReasonService, useValue: { getReasons: vi.fn().mockReturnValue(of([])) } },
      ],
    });
  });

  describe('loading items', () => {
    it('loads the POS waste items sorted by name', () => {
      create();

      expect(stockWaste.getWasteItems).toHaveBeenCalledTimes(1);
      const items = internals(fixture.componentInstance).items();
      expect(items.map((item: { name: string }) => item.name)).toEqual(['Oat Milk', 'Paper Cup']);
      expect(items[0]).toEqual({
        id: 'item-1',
        name: 'Oat Milk',
        unitName: 'Milliliter',
        currentQuantity: 500,
        allowNegativeStock: true,
        wasteApprovalLimit: 100,
      });
    });

    it('treats a missing approval limit as none', () => {
      stockWaste.getWasteItems.mockReturnValue(of([wasteItem({ wasteApprovalLimit: undefined })]));
      create();

      expect(internals(fixture.componentInstance).items()[0].wasteApprovalLimit).toBeNull();
    });

    it('shows each item with its balance and marks an empty one', () => {
      create();

      const buttons = itemButtons();
      expect(buttons).toHaveLength(2);
      expect(buttons[0].textContent).toContain('Oat Milk');
      expect(buttons[0].textContent).toContain('500');
      expect(buttons[0].querySelector('.text-error')).toBeNull();
      expect(buttons[1].querySelector('.text-error')?.textContent).toContain('0');
    });

    it('shows a spinner while loading', () => {
      stockWaste.getWasteItems.mockReturnValue(new Subject());
      create();

      expect(element().querySelector('.loading-spinner')).not.toBeNull();
      expect(itemButtons()).toHaveLength(0);
    });

    it('shows the error and retries the item list', () => {
      stockWaste.getWasteItems.mockReturnValueOnce(throwError(() => new Error('Items failed.')));
      create();

      expect(element().textContent).toContain('Items failed.');
      buttonByText('Try Again')!.click();
      fixture.detectChanges();

      expect(stockWaste.getWasteItems).toHaveBeenCalledTimes(2);
      expect(internals(fixture.componentInstance).loadError()).toBeNull();
      expect(itemButtons()).toHaveLength(2);
    });

    it('says when there are no items', () => {
      stockWaste.getWasteItems.mockReturnValue(of([]));
      create();

      expect(element().textContent).toContain('No items found.');
    });
  });

  describe('offline', () => {
    it('turns recording off with a message while offline', () => {
      create();
      isOnline.set(false);
      fixture.detectChanges();

      expect(element().textContent).toContain('Recording waste needs a connection');
      expect(itemButtons().every((button) => button.disabled)).toBe(true);
      internals(fixture.componentInstance).selectItem(internals(fixture.componentInstance).items()[0]);
      expect(internals(fixture.componentInstance).selectedItem()).toBeNull();
    });

    it('refuses to save while offline', () => {
      create();
      isOnline.set(false);

      internals(fixture.componentInstance).confirmWaste(payload);

      expect(stockWaste.recordWaste).not.toHaveBeenCalled();
      expect(alert.error).toHaveBeenCalledWith(
        'Recording waste needs a connection. Try again when you are back online.',
      );
    });

    it('loads the list again once the connection is back after a failed load', () => {
      isOnline.set(false);
      stockWaste.getWasteItems.mockReturnValueOnce(throwError(() => new Error('Offline.')));
      create();
      expect(stockWaste.getWasteItems).toHaveBeenCalledTimes(1);

      isOnline.set(true);
      fixture.detectChanges();

      expect(stockWaste.getWasteItems).toHaveBeenCalledTimes(2);
      expect(itemButtons()).toHaveLength(2);
    });

    it('does not reload when nothing failed', () => {
      create();
      isOnline.set(false);
      fixture.detectChanges();
      isOnline.set(true);
      fixture.detectChanges();

      expect(stockWaste.getWasteItems).toHaveBeenCalledTimes(1);
    });
  });
  describe('search', () => {
    it('filters by name ignoring case and spaces', () => {
      create();
      internals(fixture.componentInstance).searchTerm.set('  oat ');
      fixture.detectChanges();

      expect(itemButtons().map((button) => button.textContent)).toHaveLength(1);
      expect(itemButtons()[0].textContent).toContain('Oat Milk');
    });

    it('shows the empty message when nothing matches', () => {
      create();
      internals(fixture.componentInstance).searchTerm.set('coffee beans');
      fixture.detectChanges();

      expect(element().textContent).toContain('No items found.');
    });
  });

  describe('recording waste', () => {
    it('opens the record waste dialog for the picked item from the POS', () => {
      create();
      itemButtons()[0].click();
      fixture.detectChanges();

      expect(internals(fixture.componentInstance).selectedItem().id).toBe('item-1');
      expect(element().querySelector('app-record-waste-dialog')).not.toBeNull();
      expect(internals(fixture.componentInstance).source).toBe(StockWasteSource.Pos);
    });

    it('closes the dialog on cancel', () => {
      create();
      itemButtons()[0].click();
      fixture.detectChanges();

      internals(fixture.componentInstance).cancelWaste();
      fixture.detectChanges();

      expect(element().querySelector('app-record-waste-dialog')).toBeNull();
    });

    it('records the waste, confirms and closes the sheet', () => {
      stockWaste.recordWaste.mockReturnValue(of({ status: 'Confirmed' }));
      create();
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);
      internals(fixture.componentInstance).selectItem(internals(fixture.componentInstance).items()[0]);

      internals(fixture.componentInstance).confirmWaste(payload);

      expect(stockWaste.recordWaste).toHaveBeenCalledWith(payload);
      expect(alert.success).toHaveBeenCalledWith('Waste recorded.');
      expect(internals(fixture.componentInstance).selectedItem()).toBeNull();
      expect(internals(fixture.componentInstance).isSaving()).toBe(false);
      expect(modalStack.remove).toHaveBeenCalledWith(7);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('says when the waste needs Admin review', () => {
      stockWaste.recordWaste.mockReturnValue(of({ status: 'PendingReview' }));
      create();

      internals(fixture.componentInstance).confirmWaste(payload);

      expect(alert.success).toHaveBeenCalledWith('Waste recorded. It needs Admin review.');
    });

    it('keeps the dialog open and shows the error when saving fails', () => {
      stockWaste.recordWaste.mockReturnValue(throwError(() => new Error('Not enough stock.')));
      create();
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);
      internals(fixture.componentInstance).selectItem(internals(fixture.componentInstance).items()[0]);

      internals(fixture.componentInstance).confirmWaste(payload);

      expect(alert.error).toHaveBeenCalledWith('Not enough stock.');
      expect(internals(fixture.componentInstance).isSaving()).toBe(false);
      expect(internals(fixture.componentInstance).selectedItem()).not.toBeNull();
      expect(closed).not.toHaveBeenCalled();
    });

    it('ignores a second save, cancel and close while saving', () => {
      const pending = new Subject<unknown>();
      stockWaste.recordWaste.mockReturnValue(pending);
      create();
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);
      internals(fixture.componentInstance).selectItem(internals(fixture.componentInstance).items()[0]);

      internals(fixture.componentInstance).confirmWaste(payload);
      internals(fixture.componentInstance).confirmWaste(payload);
      internals(fixture.componentInstance).cancelWaste();
      internals(fixture.componentInstance).close();
      fixture.detectChanges();

      expect(stockWaste.recordWaste).toHaveBeenCalledTimes(1);
      expect(internals(fixture.componentInstance).selectedItem()).not.toBeNull();
      expect(closed).not.toHaveBeenCalled();
      expect(element().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.disabled).toBe(true);
    });
  });

  describe('closing', () => {
    it('registers with the modal stack and closes through it', () => {
      create();
      expect(modalStack.push).toHaveBeenCalledTimes(1);
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);

      modalStack.push.mock.calls[0][0]();

      expect(modalStack.remove).toHaveBeenCalledWith(7);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('closes from the close button and the backdrop, removing the modal once', () => {
      create();
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);

      element().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      element().querySelector<HTMLElement>('[role="dialog"]')!.click();

      expect(closed).toHaveBeenCalledTimes(2);
      expect(modalStack.remove).toHaveBeenCalledTimes(1);
    });

    it('does not close when clicking inside the sheet', () => {
      create();
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);

      element().querySelector<HTMLElement>('[role="document"]')!.click();

      expect(closed).not.toHaveBeenCalled();
    });
  });
});
