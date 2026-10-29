import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  AlertService,
  AuthService,
  ModalStackService,
  StockWasteService,
  WasteReasonService,
} from '@core/services';
import { fakeAlert, internals } from '@app/testing/management-spec-helpers';
import { AppRoutes } from '@shared/constants/app-routes';
import { PagedStockWasteDto, StockWasteDto, StockWasteSource } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WasteComponent } from './waste';

function entry(overrides: Partial<StockWasteDto> = {}): StockWasteDto {
  return {
    id: 'w1',
    itemId: 'i1',
    itemName: 'Oat Milk',
    baseUnit: 'ml',
    quantity: 500,
    wasteReasonId: 1,
    reasonName: 'Spilled',
    notes: null,
    status: 'Recorded',
    requiresReview: false,
    quantityBefore: 1000,
    quantityAfter: 500,
    createdAt: '2026-10-20T02:00:00Z',
    createdBy: 'u1',
    createdByName: 'Cashier Ann',
    source: StockWasteSource.ItemDetails,
    ...overrides,
  };
}

function page(items: StockWasteDto[], totalCount = items.length, pendingCount = 0): PagedStockWasteDto {
  return { items, totalCount, pendingCount };
}

function dateString(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

describe('WasteComponent', () => {
  let stockWaste: {
    getWaste: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    dispute: ReturnType<typeof vi.fn>;
    reverse: ReturnType<typeof vi.fn>;
    startPendingCount: ReturnType<typeof vi.fn>;
    stopPendingCount: ReturnType<typeof vi.fn>;
    refreshPendingCount: ReturnType<typeof vi.fn>;
  };
  let reasons: { getReasons: ReturnType<typeof vi.fn> };
  let alerts: ReturnType<typeof fakeAlert>;
  let modalStack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn> };
  let auth: { canReviewStockWaste: ReturnType<typeof vi.fn> };
  let queryParams: Record<string, string>;
  let route: { snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> } };

  function create() {
    route = { snapshot: { queryParamMap: convertToParamMap(queryParams) } };
    TestBed.configureTestingModule({
      providers: [
        { provide: StockWasteService, useValue: stockWaste },
        { provide: WasteReasonService, useValue: reasons },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: modalStack },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: route },
        { provide: AuthService, useValue: auth },
      ],
    });
    const fixture = TestBed.createComponent(WasteComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function buttons(fixture: { nativeElement: HTMLElement }, label: string): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button')).filter(
      (b) => (b as HTMLButtonElement).textContent?.trim() === label,
    ) as HTMLButtonElement[];
  }

  function lastQuery(): Record<string, unknown> {
    return stockWaste.getWaste.mock.calls.at(-1)![0];
  }

  beforeEach(() => {
    stockWaste = {
      getWaste: vi.fn(() => of(page([entry()]))),
      confirm: vi.fn(),
      dispute: vi.fn(),
      reverse: vi.fn(),
      startPendingCount: vi.fn(),
      stopPendingCount: vi.fn(),
      refreshPendingCount: vi.fn(),
    };
    reasons = {
      getReasons: vi.fn(() =>
        of([
          { id: 1, name: 'Spilled', requiresNote: false, sortOrder: 1, isActive: true, isSystem: false },
          { id: 2, name: 'Old', requiresNote: false, sortOrder: 2, isActive: false, isSystem: false },
        ]),
      ),
    };
    alerts = fakeAlert();
    modalStack = { push: vi.fn(() => 7), remove: vi.fn() };
    router = { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn() };
    auth = { canReviewStockWaste: vi.fn(() => true) };
    queryParams = {};
  });

  describe('loading', () => {
    it('loads the last 30 days by default with page 1 and size 20', () => {
      create();

      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      expect(lastQuery()).toEqual({
        fromDate: dateString(from),
        toDate: dateString(today),
        status: null,
        wasteReasonId: null,
        itemId: null,
        page: 1,
        pageSize: 20,
      });
    });

    it('loads the reasons including inactive ones and lists them in the filter', () => {
      const fixture = create();

      expect(reasons.getReasons).toHaveBeenCalledWith(true);
      expect(text(fixture)).toContain('Old (inactive)');
    });

    it('falls back to no reasons when they fail to load', () => {
      reasons.getReasons.mockReturnValue(throwError(() => new Error('down')));
      const fixture = create();

      expect(internals(fixture.componentInstance).reasons()).toEqual([]);
    });

    it('shows the entries and the pending count from the response', () => {
      stockWaste.getWaste.mockReturnValue(of(page([entry({ notes: 'Dropped the jug' })], 1, 3)));
      const fixture = create();

      expect(text(fixture)).toContain('Oat Milk');
      expect(text(fixture)).toContain('Dropped the jug');
      expect(fixture.nativeElement.querySelector('[data-testid="tile-pending"]').textContent).toContain('3');
    });

    it('shows the empty state when nothing was recorded', () => {
      stockWaste.getWaste.mockReturnValue(of(page([])));
      const fixture = create();

      expect(fixture.nativeElement.querySelector('[data-testid="waste-empty"]')).not.toBeNull();
    });

    it('shows a busy refresh button while loading', () => {
      const pending = new Subject<PagedStockWasteDto>();
      stockWaste.getWaste.mockReturnValue(pending);
      const fixture = create();

      const refresh = fixture.nativeElement.querySelector('button[aria-label="Refresh waste"]') as HTMLButtonElement;
      expect(refresh.disabled).toBe(true);
      expect(refresh.classList).toContain('opacity-70');

      pending.next(page([entry()]));
      pending.complete();
      fixture.detectChanges();
      expect(refresh.disabled).toBe(false);
      expect(refresh.classList).not.toContain('opacity-70');
    });

    it('shows the error when the list fails to load', () => {
      stockWaste.getWaste.mockReturnValue(throwError(() => new Error('Could not load waste.')));
      const fixture = create();

      expect(alerts.error).toHaveBeenCalledWith('Could not load waste.');
      expect(internals(fixture.componentInstance).isLoading()).toBe(false);
    });

    it('marks entries recorded at the POS', () => {
      stockWaste.getWaste.mockReturnValue(of(page([entry({ source: StockWasteSource.Pos })])));
      const fixture = create();

      expect(text(fixture)).toContain('from the POS');
    });
  });

  describe('status query parameter', () => {
    it('starts filtered on a valid status from the address', () => {
      queryParams = { status: 'PendingReview' };
      create();

      expect(lastQuery()['status']).toBe('PendingReview');
    });

    it('ignores an unknown status in the address', () => {
      queryParams = { status: 'Bogus' };
      create();

      expect(lastQuery()['status']).toBeNull();
    });
  });

  describe('pending count', () => {
    it('starts and stops the pending count for reviewers', () => {
      const fixture = create();

      expect(stockWaste.startPendingCount).toHaveBeenCalled();
      fixture.destroy();
      expect(stockWaste.stopPendingCount).toHaveBeenCalled();
    });

    it('does not count pending waste or show the tile for staff who cannot review', () => {
      auth.canReviewStockWaste.mockReturnValue(false);
      const fixture = create();

      expect(stockWaste.startPendingCount).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('[data-testid="tile-pending"]')).toBeNull();
      fixture.destroy();
      expect(stockWaste.stopPendingCount).not.toHaveBeenCalled();
    });

    it('says on a waiting entry that the stock was already taken', () => {
      stockWaste.getWaste.mockReturnValue(of(page([entry({ status: 'PendingReview' }), entry({ id: 'w2', status: 'Recorded' })], 2, 1)));
      const fixture = create();

      const hints = fixture.nativeElement.querySelectorAll('[data-testid="pending-hint"]');
      expect(hints).toHaveLength(1);
      expect(hints[0].textContent).toContain('Stock was already taken');
    });

    it('hides the Needs review chip when nothing waits for a decision', () => {
      const fixture = create();

      expect(fixture.nativeElement.querySelector('[data-testid="tile-pending"]')).toBeNull();
    });

    it('toggles the Needs review filter and writes it to the address', () => {
      stockWaste.getWaste.mockReturnValue(of(page([entry()], 1, 3)));
      const fixture = create();
      const tile = fixture.nativeElement.querySelector('[data-testid="tile-pending"]') as HTMLButtonElement;

      tile.click();
      fixture.detectChanges();
      expect(lastQuery()['status']).toBe('PendingReview');
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({
          queryParams: { status: 'PendingReview' },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        }),
      );

      tile.click();
      fixture.detectChanges();
      expect(lastQuery()['status']).toBeNull();
      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { status: null } }));
    });
  });

  describe('filters', () => {
    it('changes the date range', () => {
      const fixture = create();
      const component = internals(fixture.componentInstance);

      component.setDatePreset('all');
      expect(lastQuery()['fromDate']).toBeNull();
      expect(lastQuery()['toDate']).toBeNull();

      component.setDatePreset('today');
      const today = dateString(new Date());
      expect(lastQuery()['fromDate']).toBe(today);
      expect(lastQuery()['toDate']).toBe(today);

      component.setDatePreset('week');
      const from = new Date();
      from.setDate(from.getDate() - 6);
      expect(lastQuery()['fromDate']).toBe(dateString(from));
    });

    it('filters by status and ignores unknown values', () => {
      const fixture = create();
      const component = internals(fixture.componentInstance);

      component.setStatus('Disputed');
      expect(lastQuery()['status']).toBe('Disputed');

      component.setStatus('');
      expect(lastQuery()['status']).toBeNull();
    });


    it('counts applied filters on the Filters button and opens and closes the drawer', () => {
      const fixture = create();
      const component = internals(fixture.componentInstance);
      expect(component.activeFilterCount()).toBe(0);

      component.setDatePreset('week');
      component.setStatus('Disputed');
      component.setReason('2');
      expect(component.activeFilterCount()).toBe(3);

      component.resetDatePreset();
      expect(component.activeFilterCount()).toBe(2);
      expect(lastQuery()['fromDate']).not.toBeNull();

      expect(component.isFiltersOpen()).toBe(false);
      component.openFilters();
      expect(component.isFiltersOpen()).toBe(true);
      component.closeFilters();
      expect(component.isFiltersOpen()).toBe(false);
    });

    it('shows the filters in the drawer instead of inline selects', () => {
      const fixture = create();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('select')).toBeNull();
      expect(el.querySelector('app-filter-button')).not.toBeNull();
    });

    it('filters by reason as a number and clears it', () => {
      const fixture = create();
      const component = internals(fixture.componentInstance);

      component.setReason('2');
      expect(lastQuery()['wasteReasonId']).toBe(2);

      component.setReason('');
      expect(lastQuery()['wasteReasonId']).toBeNull();
    });

    it('filters by item and clears the item filter', () => {
      const fixture = create();

      buttons(fixture, 'Filter by Item')[0].click();
      fixture.detectChanges();
      expect(lastQuery()['itemId']).toBe('i1');
      expect(text(fixture)).toContain('Item: Oat Milk');
      expect(buttons(fixture, 'Filter by Item')).toHaveLength(0);

      (fixture.nativeElement.querySelector('button[aria-label="Clear item filter"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(lastQuery()['itemId']).toBeNull();
    });

    it('searches item, reason, staff and note locally', () => {
      stockWaste.getWaste.mockReturnValue(
        of(
          page([
            entry({ id: 'a', itemName: 'Oat Milk' }),
            entry({ id: 'b', itemName: 'Cup', reasonName: 'Breakage', createdByName: 'Ben', notes: 'cracked box' }),
          ]),
        ),
      );
      const fixture = create();
      const component = internals(fixture.componentInstance);

      component.search.set('breakage');
      expect(component.visibleEntries().map((e: StockWasteDto) => e.id)).toEqual(['b']);
      component.search.set('ben');
      expect(component.visibleEntries().map((e: StockWasteDto) => e.id)).toEqual(['b']);
      component.search.set('CRACKED');
      expect(component.visibleEntries().map((e: StockWasteDto) => e.id)).toEqual(['b']);
      component.search.set('oat');
      expect(component.visibleEntries().map((e: StockWasteDto) => e.id)).toEqual(['a']);
    });
  });

  describe('load more', () => {
    it('appends the next page', () => {
      stockWaste.getWaste.mockReturnValueOnce(of(page([entry({ id: 'a' })], 2)));
      const fixture = create();
      stockWaste.getWaste.mockReturnValueOnce(of(page([entry({ id: 'b' })], 2)));

      buttons(fixture, 'Load More')[0].click();
      fixture.detectChanges();

      expect(lastQuery()['page']).toBe(2);
      expect(internals(fixture.componentInstance).entries().map((e: StockWasteDto) => e.id)).toEqual(['a', 'b']);
      expect(buttons(fixture, 'Load More')).toHaveLength(0);
    });

    it('does nothing when every entry is shown', () => {
      const fixture = create();
      const calls = stockWaste.getWaste.mock.calls.length;

      internals(fixture.componentInstance).loadMore();

      expect(stockWaste.getWaste.mock.calls.length).toBe(calls);
    });

    it('shows a busy button while loading more', () => {
      stockWaste.getWaste.mockReturnValueOnce(of(page([entry({ id: 'a' })], 2)));
      const fixture = create();
      stockWaste.getWaste.mockReturnValueOnce(new Subject());

      buttons(fixture, 'Load More')[0].click();
      fixture.detectChanges();

      expect(buttons(fixture, 'Loading...')[0].disabled).toBe(true);
    });

    it('goes back a page and reports the error when loading more fails', () => {
      stockWaste.getWaste.mockReturnValueOnce(of(page([entry({ id: 'a' })], 3)));
      const fixture = create();
      stockWaste.getWaste.mockReturnValueOnce(throwError(() => new Error('Network down')));
      const component = internals(fixture.componentInstance);

      component.loadMore();
      expect(alerts.error).toHaveBeenCalledWith('Network down');

      stockWaste.getWaste.mockReturnValueOnce(of(page([entry({ id: 'b' })], 3)));
      component.loadMore();
      expect(lastQuery()['page']).toBe(2);
    });

    it('hides Load More while searching', () => {
      stockWaste.getWaste.mockReturnValue(of(page([entry()], 5)));
      const fixture = create();

      internals(fixture.componentInstance).search.set('oat');
      fixture.detectChanges();

      expect(buttons(fixture, 'Load More')).toHaveLength(0);
    });
  });

  describe('review buttons', () => {
    it('offers Confirm, Dispute and Reverse on waste that needs review', () => {
      stockWaste.getWaste.mockReturnValue(of(page([entry({ status: 'PendingReview' })])));
      const fixture = create();

      expect(buttons(fixture, 'Confirm')).toHaveLength(1);
      expect(buttons(fixture, 'Dispute')).toHaveLength(1);
      expect(buttons(fixture, 'Reverse')).toHaveLength(1);
    });

    it('offers only Reverse on recorded, confirmed or disputed waste', () => {
      stockWaste.getWaste.mockReturnValue(
        of(
          page([
            entry({ id: 'a', status: 'Recorded' }),
            entry({ id: 'b', status: 'Confirmed' }),
            entry({ id: 'c', status: 'Disputed' }),
          ]),
        ),
      );
      const fixture = create();

      expect(buttons(fixture, 'Confirm')).toHaveLength(0);
      expect(buttons(fixture, 'Dispute')).toHaveLength(0);
      expect(buttons(fixture, 'Reverse')).toHaveLength(3);
    });

    it('offers nothing on reversed waste', () => {
      stockWaste.getWaste.mockReturnValue(
        of(page([entry({ status: 'Reversed', reversedAt: '2026-10-20T03:00:00Z', reversedByName: 'Admin', reversalReason: 'Mistake' })])),
      );
      const fixture = create();

      expect(buttons(fixture, 'Reverse')).toHaveLength(0);
      expect(text(fixture)).toContain('Reversed by Admin');
      expect(text(fixture)).toContain('Mistake');
    });

    it('hides every review button from staff who cannot review', () => {
      auth.canReviewStockWaste.mockReturnValue(false);
      stockWaste.getWaste.mockReturnValue(of(page([entry({ status: 'PendingReview' })])));
      const fixture = create();

      expect(buttons(fixture, 'Confirm')).toHaveLength(0);
      expect(buttons(fixture, 'Dispute')).toHaveLength(0);
      expect(buttons(fixture, 'Reverse')).toHaveLength(0);
    });

    it('opens the item details', () => {
      const fixture = create();

      buttons(fixture, 'Oat Milk')[0].click();

      expect(router.navigate).toHaveBeenCalledWith([AppRoutes.InventoryItemDetailsById('i1')], {
        queryParams: { returnUrl: AppRoutes.InventoryWaste },
      });
    });
  });

  describe('review dialog', () => {
    function openReview(action: 'confirm' | 'dispute' | 'reverse', status: StockWasteDto['status'] = 'PendingReview') {
      stockWaste.getWaste.mockReturnValue(of(page([entry({ status })], 1, 2)));
      const fixture = create();
      const component = internals(fixture.componentInstance);
      component.pendingCount.set(2);
      component.startReview(component.entries()[0], action);
      fixture.detectChanges();
      return { fixture, component };
    }

    it('pushes the dialog on the modal stack with the right wording', () => {
      const { fixture, component } = openReview('dispute');

      expect(modalStack.push).toHaveBeenCalled();
      expect(component.reviewHeading()).toBe('Dispute Waste');
      expect(component.reviewNoteLabel()).toBe('Why is it disputed?');
      expect(component.reviewBusyLabel()).toBe('Disputing...');
      expect(text(fixture)).toContain('Dispute this waste of 500 ml of Oat Milk');
    });

    it('labels each action', () => {
      const { component } = openReview('confirm');
      expect(component.reviewHeading()).toBe('Confirm Waste');
      expect(component.reviewConfirmLabel()).toBe('Confirm');
      expect(component.reviewBusyLabel()).toBe('Confirming...');
      expect(component.reviewNoteLabel()).toBe('Note (optional)');

      component.startReview(component.entries()[0], 'reverse');
      expect(component.reviewHeading()).toBe('Reverse Waste');
      expect(component.reviewConfirmLabel()).toBe('Reverse');
      expect(component.reviewBusyLabel()).toBe('Reversing...');
      expect(component.reviewNoteLabel()).toBe('Reason for reversing');
    });

    it('confirms without a note', () => {
      const { component } = openReview('confirm');
      stockWaste.confirm.mockReturnValue(of(entry({ status: 'Confirmed' })));

      component.submitReview();

      expect(stockWaste.confirm).toHaveBeenCalledWith('w1', null);
      expect(alerts.success).toHaveBeenCalledWith('Waste of Oat Milk confirmed.');
      expect(component.entries()[0].status).toBe('Confirmed');
      expect(component.pendingCount()).toBe(1);
      expect(component.reviewTarget()).toBeNull();
      expect(modalStack.remove).toHaveBeenCalledWith(7);
      expect(stockWaste.refreshPendingCount).toHaveBeenCalled();
    });

    it('sends a trimmed confirm note', () => {
      const { component } = openReview('confirm');
      stockWaste.confirm.mockReturnValue(of(entry({ status: 'Confirmed' })));
      component.reviewNote.setValue('  checked bin  ');

      component.submitReview();

      expect(stockWaste.confirm).toHaveBeenCalledWith('w1', 'checked bin');
    });

    it('requires a note to dispute', () => {
      const { component } = openReview('dispute');
      component.reviewNote.setValue('   ');

      component.submitReview();

      expect(alerts.error).toHaveBeenCalledWith('Enter a note for the dispute.');
      expect(stockWaste.dispute).not.toHaveBeenCalled();
      expect(component.reviewNote.touched).toBe(true);
    });

    it('requires a reason to reverse', () => {
      const { component } = openReview('reverse', 'Confirmed');

      component.submitReview();

      expect(alerts.error).toHaveBeenCalledWith('Enter a reason for reversing.');
      expect(stockWaste.reverse).not.toHaveBeenCalled();
    });

    it('refuses a note over 500 characters', () => {
      const { component } = openReview('dispute');
      component.reviewNote.setValue('x'.repeat(501));

      component.submitReview();

      expect(stockWaste.dispute).not.toHaveBeenCalled();
    });

    it('disputes with the note', () => {
      const { component } = openReview('dispute');
      stockWaste.dispute.mockReturnValue(of(entry({ status: 'Disputed' })));
      component.reviewNote.setValue('Not seen on camera');

      component.submitReview();

      expect(stockWaste.dispute).toHaveBeenCalledWith('w1', 'Not seen on camera');
      expect(alerts.success).toHaveBeenCalledWith('Waste of Oat Milk disputed.');
      expect(component.pendingCount()).toBe(1);
    });

    it('reverses with the reason and keeps the pending count for non-pending waste', () => {
      const { component } = openReview('reverse', 'Confirmed');
      stockWaste.reverse.mockReturnValue(of(entry({ status: 'Reversed' })));
      component.reviewNote.setValue('Entered twice');

      component.submitReview();

      expect(stockWaste.reverse).toHaveBeenCalledWith('w1', 'Entered twice');
      expect(alerts.success).toHaveBeenCalledWith('Waste of Oat Milk reversed. The stock is back.');
      expect(component.pendingCount()).toBe(2);
      expect(component.entries()[0].status).toBe('Reversed');
    });

    it('is busy while saving and cannot be cancelled or sent twice', () => {
      const { fixture, component } = openReview('confirm');
      const pending = new Subject<StockWasteDto>();
      stockWaste.confirm.mockReturnValue(pending);

      component.submitReview();
      fixture.detectChanges();
      expect(component.isReviewing()).toBe(true);
      expect(text(fixture)).toContain('Confirming...');

      component.submitReview();
      expect(stockWaste.confirm).toHaveBeenCalledTimes(1);

      component.cancelReview();
      expect(component.reviewTarget()).not.toBeNull();

      pending.next(entry({ status: 'Confirmed' }));
      pending.complete();
      expect(component.isReviewing()).toBe(false);
      expect(component.reviewTarget()).toBeNull();
    });

    it('keeps the dialog open and reports the error when the review fails', () => {
      const { component } = openReview('dispute');
      stockWaste.dispute.mockReturnValue(throwError(() => new Error('Already reviewed.')));
      component.reviewNote.setValue('No');

      component.submitReview();

      expect(alerts.error).toHaveBeenCalledWith('Already reviewed.');
      expect(component.isReviewing()).toBe(false);
      expect(component.reviewTarget()).not.toBeNull();
      expect(modalStack.remove).not.toHaveBeenCalled();
    });

    it('cancels and removes the dialog from the modal stack', () => {
      const { component } = openReview('confirm');

      component.cancelReview();

      expect(component.reviewTarget()).toBeNull();
      expect(modalStack.remove).toHaveBeenCalledWith(7);
    });

    it('removes an open dialog from the modal stack when the page closes', () => {
      const { fixture } = openReview('confirm');

      fixture.destroy();

      expect(modalStack.remove).toHaveBeenCalledWith(7);
    });
  });
});
