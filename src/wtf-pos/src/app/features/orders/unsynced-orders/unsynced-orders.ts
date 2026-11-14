import { DecimalPipe, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { HttpErrorMessages } from '@core/messages';
import { AlertService, ListStateService, UnsyncedOrderService, UserService } from '@core/services';
import {
  ConfirmDialogComponent,
  ConnectionErrorComponent,
  IconComponent,
  PullToRefreshComponent,
  SideDrawerComponent,
  type FilterOption,
} from '@shared/components';
import { BadgeComponent, type BadgeVariant } from '@shared/components/badge/badge';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import {
  PaymentMethodEnum,
  UNSYNCED_RESOLUTION_LABELS,
  UnsyncedOrderDetailDto,
  UnsyncedOrderDto,
  UnsyncedOrderQuery,
  UnsyncedOrderResolutionEnum,
  UnsyncedOrderStatusEnum,
} from '@shared/models';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { debounceTime, distinctUntilChanged, Observable } from 'rxjs';

type SortColumn = 'date' | 'queue' | 'cashier' | 'total' | 'error';
type PendingAction = 'retry' | 'note' | 'discard';
type StatusFilter = 'open' | 'resolved' | 'all';

interface UnsyncedListState {
  statusFilter: StatusFilter;
  selectedDateRanges: string[];
  customStartDate: string;
  customEndDate: string;
  cashierId: string;
  pageSize?: number;
}

export const MAX_DISCARD_REASON_LENGTH = 500;
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

@Component({
  selector: 'app-unsynced-orders',
  imports: [
    BadgeComponent,
    ConfirmDialogComponent,
    ConnectionErrorComponent,
    DatePipe,
    DecimalPipe,
    FilterButtonComponent,
    IconComponent,
    PullToRefreshComponent,
    SearchInputComponent,
    SideDrawerComponent,
    SortHeaderComponent,
  ],
  templateUrl: './unsynced-orders.html',
  host: { class: 'flex-1 min-h-0' },
})
export class UnsyncedOrders implements OnInit {
  private readonly unsyncedService = inject(UnsyncedOrderService);
  private readonly userService = inject(UserService);
  private readonly alertService = inject(AlertService);
  private readonly listState = inject(ListStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stateKey = 'orders:unsynced';

  protected readonly searchControl = new FormControl('');

  protected readonly orders = signal<UnsyncedOrderDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isFiltersOpen = signal(false);
  protected readonly sortColumn = signal<SortColumn>('date');
  protected readonly sortDirection = signal<SortDirection>('desc');

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly page = signal(1);
  protected readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  protected readonly totalCount = signal(0);
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalCount() / this.pageSize())),
  );
  protected readonly firstRow = computed(() =>
    this.totalCount() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );
  protected readonly lastRow = computed(() =>
    Math.min(this.page() * this.pageSize(), this.totalCount()),
  );

  protected readonly statusFilter = signal<StatusFilter>('open');
  protected readonly selectedDateRanges = signal<string[]>([]);
  protected readonly customStartDate = signal('');
  protected readonly customEndDate = signal('');
  protected readonly cashierId = signal('');
  protected readonly cashiers = signal<{ id: string; name: string }[]>([]);
  protected readonly maxDate = (() => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offsetMs).toISOString().split('T')[0];
  })();

  protected readonly statusOptions: FilterOption[] = [
    { id: 'open', label: 'Open' },
    { id: 'resolved', label: 'Resolved' },
    { id: 'all', label: 'All' },
  ];
  protected readonly dateRangeOptions: FilterOption[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 days' },
    { id: '30d', label: 'Last 30 days' },
    { id: 'custom', label: 'Custom Range' },
  ];

  protected readonly activeFilterCount = computed(
    () =>
      (this.statusFilter() === 'open' ? 0 : 1) +
      (this.buildDateRange() !== null ? 1 : 0) +
      (this.cashierId() ? 1 : 0),
  );

  protected readonly selected = signal<UnsyncedOrderDetailDto | null>(null);
  protected readonly isDetailLoading = signal(false);
  protected readonly isDetailOpen = signal(false);
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly isBusy = signal(false);
  protected readonly retryError = signal<string | null>(null);
  protected readonly discardReason = signal('');
  protected readonly discardError = signal<string | null>(null);
  protected readonly maxReasonLength = MAX_DISCARD_REASON_LENGTH;
  protected readonly isOpenOrder = computed(
    () => this.selected()?.order.status === UnsyncedOrderStatusEnum.Open,
  );

  public ngOnInit(): void {
    this.restoreState();
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.filtersChanged());
    this.loadCashiers();
    this.loadOrders();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadOrders();
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set(column === 'date' ? 'desc' : 'asc');
    }

    this.page.set(1);
    this.loadOrders();
  }

  protected goToPage(target: number): void {
    const next = Math.min(Math.max(1, target), this.totalPages());
    if (next === this.page()) {
      return;
    }

    this.page.set(next);
    this.loadOrders();
  }

  protected onPageSizeChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (!PAGE_SIZE_OPTIONS.some((option) => option === value) || value === this.pageSize()) {
      return;
    }

    this.pageSize.set(value);
    this.filtersChanged();
  }

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected selectStatus(status: string): void {
    this.statusFilter.set(status as StatusFilter);
    this.filtersChanged();
  }

  protected isDateRangeSelected(rangeId: string): boolean {
    return this.selectedDateRanges()[0] === rangeId;
  }

  protected toggleDateRangeSelection(rangeId: string): void {
    this.selectedDateRanges.set(this.isDateRangeSelected(rangeId) ? [] : [rangeId]);
    if (rangeId !== 'custom') {
      this.customStartDate.set('');
      this.customEndDate.set('');
    }

    this.filtersChanged();
  }

  protected clearDateRangeSelections(): void {
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.filtersChanged();
  }

  protected onCustomStartDateChanged(value: string): void {
    this.customStartDate.set(value);
    this.selectedDateRanges.set(['custom']);
    this.filtersChanged();
  }

  protected onCustomEndDateChanged(value: string): void {
    this.customEndDate.set(value);
    this.selectedDateRanges.set(['custom']);
    this.filtersChanged();
  }

  protected selectCashier(id: string): void {
    this.cashierId.set(this.cashierId() === id ? '' : id);
    this.filtersChanged();
  }

  protected clearAllFilters(): void {
    this.statusFilter.set('open');
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.cashierId.set('');
    this.filtersChanged();
  }

  protected openOrder(order: UnsyncedOrderDto): void {
    this.isDetailOpen.set(true);
    this.isDetailLoading.set(true);
    this.selected.set(null);
    this.retryError.set(null);
    this.unsyncedService.getUnsyncedOrder(order.id).subscribe({
      next: (detail) => {
        this.selected.set(detail);
        this.isDetailLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.closeDetail();
      },
    });
  }

  protected closeDetail(): void {
    this.isDetailOpen.set(false);
    this.isDetailLoading.set(false);
    this.pendingAction.set(null);
  }

  protected askAction(action: PendingAction): void {
    this.discardReason.set('');
    this.discardError.set(null);
    this.pendingAction.set(action);
  }

  protected cancelAction(): void {
    if (!this.isBusy()) {
      this.pendingAction.set(null);
    }
  }

  protected onReasonInput(value: string): void {
    this.discardReason.set(value.slice(0, MAX_DISCARD_REASON_LENGTH));
    if (this.discardError() && this.discardReason().trim()) {
      this.discardError.set(null);
    }
  }

  protected confirmAction(): void {
    const action = this.pendingAction();
    const current = this.selected();
    if (!action || !current || this.isBusy()) {
      return;
    }

    const id = current.order.id;
    if (action === 'retry') {
      this.run(this.unsyncedService.retry(id), (result) => {
        if (result.resolved) {
          this.alertService.success(
            result.orderNumber
              ? `Order #${result.orderNumber} was saved.`
              : 'The order was saved.',
          );
          this.afterResolved();
          return;
        }

        this.retryError.set(result.error);
        this.pendingAction.set(null);
        this.selected.set({ ...current, order: result.order });
        this.alertService.error(result.error ?? 'The order still cannot be saved.');
      });
    } else if (action === 'note') {
      this.run(this.unsyncedService.saveAsNote(id), () => {
        this.alertService.success('The sale was saved as a note for the cash drawer.');
        this.afterResolved();
      });
    } else {
      const reason = this.discardReason().trim();
      if (!reason) {
        this.discardError.set('Please enter a reason for discarding the order.');
        return;
      }

      this.run(this.unsyncedService.discard(id, reason), () => {
        this.alertService.success('The order was discarded.');
        this.afterResolved();
      });
    }
  }

  protected statusVariant(order: UnsyncedOrderDto): BadgeVariant {
    if (order.status === UnsyncedOrderStatusEnum.Open) {
      return 'warning';
    }

    return order.resolution === UnsyncedOrderResolutionEnum.Discarded ? 'default' : 'success';
  }

  protected statusLabel(order: UnsyncedOrderDto): string {
    return order.status === UnsyncedOrderStatusEnum.Open
      ? 'Open'
      : order.resolution
        ? UNSYNCED_RESOLUTION_LABELS[order.resolution]
        : 'Resolved';
  }

  protected paymentLabel(method: PaymentMethodEnum | null): string {
    if (method === PaymentMethodEnum.Cash) {
      return 'Cash';
    }

    return method === PaymentMethodEnum.GCash ? 'GCash' : 'Not recorded';
  }

  private run<T>(
    request: Observable<T>,
    onDone: (value: T) => void,
  ): void {
    this.isBusy.set(true);
    request.subscribe({
      next: (value) => {
        this.isBusy.set(false);
        onDone(value);
      },
      error: (err) => {
        this.isBusy.set(false);
        this.pendingAction.set(null);
        this.alertService.error(err.message);
      },
    });
  }

  private afterResolved(): void {
    this.pendingAction.set(null);
    this.closeDetail();
    this.loadOrders();
  }

  private filtersChanged(): void {
    this.page.set(1);
    this.saveState();
    this.loadOrders();
  }

  private buildDateRange(): { fromDate: string; toDate?: string } | null {
    const selected = this.selectedDateRanges()[0];
    if (!selected) {
      return null;
    }

    const start = new Date();
    if (selected === 'today') {
      start.setHours(0, 0, 0, 0);
      return { fromDate: start.toISOString() };
    }

    if (selected === '7d' || selected === '30d') {
      start.setDate(start.getDate() - (selected === '7d' ? 7 : 30));
      return { fromDate: start.toISOString() };
    }

    const from = this.customStartDate();
    const to = this.customEndDate();
    if (selected === 'custom' && from && to) {
      return {
        fromDate: new Date(`${from}T00:00:00`).toISOString(),
        toDate: new Date(`${to}T23:59:59.999`).toISOString(),
      };
    }

    return null;
  }

  private buildQuery(): UnsyncedOrderQuery {
    const query: UnsyncedOrderQuery = {
      ...this.buildDateRange(),
      sortBy: this.sortColumn(),
      descending: this.sortDirection() === 'desc',
      page: this.page(),
      pageSize: this.pageSize(),
    };

    const status = this.statusFilter();
    if (status !== 'all') {
      query.status =
        status === 'open' ? UnsyncedOrderStatusEnum.Open : UnsyncedOrderStatusEnum.Resolved;
    }

    if (this.cashierId()) {
      query.cashierId = this.cashierId();
    }

    const term = this.searchControl.value?.trim();
    if (term) {
      query.searchTerm = term;
    }

    return query;
  }

  private loadCashiers(): void {
    this.userService.getUsers().subscribe({
      next: (users) =>
        this.cashiers.set(
          users.map((user) => ({
            id: user.id,
            name: `${user.firstName} ${user.lastName}`.trim(),
          })),
        ),
      error: () => this.cashiers.set([]),
    });
  }

  private loadOrders(): void {
    this.isLoading.set(!this.isRefreshing());
    this.connectionFailed.set(false);

    this.unsyncedService.getUnsyncedOrders(this.buildQuery()).subscribe({
      next: (result) => {
        this.totalCount.set(result.totalCount);
        if (result.items.length === 0 && result.totalCount > 0 && this.page() > this.totalPages()) {
          this.page.set(this.totalPages());
          this.loadOrders();
          return;
        }

        this.orders.set(result.items);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  private restoreState(): void {
    const state = this.listState.load<UnsyncedListState>(this.stateKey, {
      statusFilter: 'open',
      selectedDateRanges: [],
      customStartDate: '',
      customEndDate: '',
      cashierId: '',
    });

    this.statusFilter.set(state.statusFilter ?? 'open');
    this.selectedDateRanges.set(state.selectedDateRanges ?? []);
    this.customStartDate.set(state.customStartDate ?? '');
    this.customEndDate.set(state.customEndDate ?? '');
    this.cashierId.set(state.cashierId ?? '');
    const savedPageSize = state.pageSize;
    this.pageSize.set(
      PAGE_SIZE_OPTIONS.some((option) => option === savedPageSize)
        ? (savedPageSize as number)
        : DEFAULT_PAGE_SIZE,
    );
  }

  private saveState(): void {
    this.listState.save<UnsyncedListState>(this.stateKey, {
      statusFilter: this.statusFilter(),
      selectedDateRanges: this.selectedDateRanges(),
      customStartDate: this.customStartDate(),
      customEndDate: this.customEndDate(),
      cashierId: this.cashierId(),
      pageSize: this.pageSize(),
    });
  }
}
