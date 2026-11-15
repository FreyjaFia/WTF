import { HttpErrorMessages } from '@core/messages';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  AlertService,
  AuthService,
  ListStateService,
  ModalStackService,
  StockWasteService,
  WasteReasonService,
} from '@core/services';
import { ConnectionErrorComponent, IconComponent, PullToRefreshComponent, SideDrawerComponent } from '@shared/components';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  STOCK_WASTE_STATUS_LABELS,
  STOCK_WASTE_STATUSES,
  StockWasteDto,
  StockWasteQuery,
  StockWasteSource,
  StockWasteStatus,
  WasteReasonDto,
} from '@shared/models';
import { debounceTime, Observable, Subscription } from 'rxjs';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, isPageSizeOption } from '@shared/calculations/pagination';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';

type DatePreset = 'today' | 'week' | 'month' | 'all';
type ReviewAction = 'confirm' | 'dispute' | 'reverse';
type WasteSortColumn = 'item' | 'recorded' | 'quantity' | 'status';

const DEFAULT_DATE_PRESET: DatePreset = 'month';
const STATE_KEY = 'waste';

interface WasteListState {
  pageSize?: number;
}
const NOTE_MAX_LENGTH = 500;

const STATUS_VARIANTS: Record<StockWasteStatus, BadgeVariant> = {
  Recorded: 'default',
  PendingReview: 'amber',
  Confirmed: 'success',
  Disputed: 'error',
  Reversed: 'info',
};

const STATUS_BARS: Record<StockWasteStatus, string> = {
  Recorded: 'bg-gray-300',
  PendingReview: 'bg-amber-400',
  Confirmed: 'bg-green-500',
  Disputed: 'bg-red-500',
  Reversed: 'bg-blue-300',
};

@Component({
  selector: 'app-waste',
  imports: [ConnectionErrorComponent, 
    BadgeComponent,
    ConfirmDialogComponent,
    DatePipe,
    FilterButtonComponent,
    IconComponent,
    PaginationComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    RouterLink,
    SearchInputComponent,
    SideDrawerComponent,
    SortHeaderComponent,
  ],
  templateUrl: './waste.html',
  host: { class: 'flex-1 min-h-0' },
})
export class WasteComponent implements OnInit, OnDestroy {
  private readonly stockWaste = inject(StockWasteService);
  private readonly wasteReasons = inject(WasteReasonService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly listState = inject(ListStateService);
  protected readonly auth = inject(AuthService);

  protected readonly statuses = STOCK_WASTE_STATUSES;
  protected readonly statusLabels = STOCK_WASTE_STATUS_LABELS;
  protected readonly datePresets: { value: DatePreset; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: '7 days' },
    { value: 'month', label: '30 days' },
    { value: 'all', label: 'All' },
  ];
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isReloading = signal(false);
  protected readonly page = signal(readPageParam(this.route));
  protected readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly entries = signal<StockWasteDto[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly pendingCount = signal(0);
  protected readonly reasons = signal<WasteReasonDto[]>([]);
  protected readonly datePreset = signal<DatePreset>(DEFAULT_DATE_PRESET);
  protected readonly status = signal<StockWasteStatus | null>(null);
  protected readonly reasonId = signal<number | null>(null);
  protected readonly itemFilter = signal<{ id: string; name: string } | null>(null);
  protected readonly searchControl = new FormControl<string | null>('');
  protected readonly isFiltersOpen = signal(false);
  protected readonly routes = AppRoutes;
  protected readonly activeFilterCount = computed(
    () =>
      (this.datePreset() !== DEFAULT_DATE_PRESET ? 1 : 0) +
      (this.status() !== null ? 1 : 0) +
      (this.reasonId() !== null ? 1 : 0) +
      (this.itemFilter() !== null ? 1 : 0),
  );
  protected readonly canReview = computed(() => this.auth.canReviewStockWaste());
  protected readonly sortColumn = signal<WasteSortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly reviewTarget = signal<StockWasteDto | null>(null);
  protected readonly reviewAction = signal<ReviewAction | null>(null);
  protected readonly isReviewing = signal(false);
  protected readonly reviewNote = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(NOTE_MAX_LENGTH)],
  });
  protected readonly noteMaxLength = NOTE_MAX_LENGTH;

  private loadRequest: Subscription | null = null;
  private modalStackId: number | null = null;
  private countingPending = false;

  public ngOnInit(): void {
    const status = this.route.snapshot.queryParamMap.get('status');
    if (status && (STOCK_WASTE_STATUSES as readonly string[]).includes(status)) {
      this.status.set(status as StockWasteStatus);
    }

    this.wasteReasons.getReasons(true).subscribe({
      next: (reasons) => this.reasons.set(reasons),
      error: () => this.reasons.set([]),
    });

    if (this.canReview()) {
      this.countingPending = true;
      this.stockWaste.startPendingCount();
    }

    const saved = this.listState.load<WasteListState>(STATE_KEY, {});
    this.pageSize.set(isPageSizeOption(saved.pageSize) ? (saved.pageSize as number) : DEFAULT_PAGE_SIZE);

    this.searchControl.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reloadFromFirstPage());

    this.load();
  }

  public ngOnDestroy(): void {
    this.loadRequest?.unsubscribe();
    if (this.countingPending) {
      this.stockWaste.stopPendingCount();
    }
    this.removeFromStack();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected load(): void {
    const firstLoad = this.entries().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.connectionFailed.set(false);
    this.loadRequest?.unsubscribe();

    this.loadRequest = this.stockWaste.getWaste(this.buildQuery()).subscribe({
      next: (result) => {
        this.entries.set(result.items);
        this.totalCount.set(result.totalCount);
        this.pendingCount.set(result.pendingCount);
        if (result.page && result.page !== this.page()) {
          this.page.set(result.page);
          writePageParam(this.router, this.route, result.page);
        }
        this.isLoading.set(false);
        this.isReloading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isReloading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    writePageParam(this.router, this.route, page);
    this.load();
  }

  protected changePageSize(size: number): void {
    this.pageSize.set(size);
    this.listState.save<WasteListState>(STATE_KEY, { pageSize: size });
    this.reloadFromFirstPage();
  }

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected resetDatePreset(): void {
    this.setDatePreset(DEFAULT_DATE_PRESET);
  }

  protected setDatePreset(preset: DatePreset): void {
    this.datePreset.set(preset);
    this.reloadFromFirstPage();
  }

  protected setStatus(value: string): void {
    this.status.set(value ? (value as StockWasteStatus) : null);
    this.syncStatusParam();
    this.reloadFromFirstPage();
  }

  protected toggleSort(column: WasteSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }

    this.reloadFromFirstPage();
  }

  protected togglePending(): void {
    this.status.set(this.status() === 'PendingReview' ? null : 'PendingReview');
    this.syncStatusParam();
    this.reloadFromFirstPage();
  }

  protected setReason(value: string): void {
    this.reasonId.set(value ? Number(value) : null);
    this.reloadFromFirstPage();
  }

  protected filterByItem(entry: StockWasteDto): void {
    this.itemFilter.set({ id: entry.itemId, name: entry.itemName });
    this.reloadFromFirstPage();
  }

  protected clearItemFilter(): void {
    this.itemFilter.set(null);
    this.reloadFromFirstPage();
  }

  protected statusVariant(status: StockWasteStatus): BadgeVariant {
    return STATUS_VARIANTS[status] ?? 'default';
  }

  protected statusBar(status: StockWasteStatus): string {
    return STATUS_BARS[status] ?? 'bg-gray-300';
  }

  protected isFromPos(entry: StockWasteDto): boolean {
    return entry.source === StockWasteSource.Pos;
  }

  protected format(quantity: number): string {
    return Number(quantity.toFixed(3)).toLocaleString('en-US');
  }

  protected openItem(entry: StockWasteDto): void {
    void this.router.navigate([AppRoutes.InventoryItemDetailsById(entry.itemId)], {
      queryParams: { returnUrl: AppRoutes.InventoryWaste },
    });
  }

  protected canConfirmOrDispute(entry: StockWasteDto): boolean {
    return this.canReview() && entry.status === 'PendingReview';
  }

  protected canReverse(entry: StockWasteDto): boolean {
    return this.canReview() && entry.status !== 'Reversed';
  }

  protected startReview(entry: StockWasteDto, action: ReviewAction): void {
    this.reviewTarget.set(entry);
    this.reviewAction.set(action);
    this.reviewNote.reset('');
    this.modalStackId = this.modalStack.push(() => this.cancelReview());
  }

  protected cancelReview(): void {
    if (this.isReviewing()) {
      return;
    }

    this.reviewTarget.set(null);
    this.reviewAction.set(null);
    this.removeFromStack();
  }

  protected noteRequired(): boolean {
    return this.reviewAction() !== 'confirm';
  }

  protected submitReview(): void {
    const entry = this.reviewTarget();
    const action = this.reviewAction();
    if (!entry || !action || this.isReviewing()) {
      return;
    }

    const note = this.reviewNote.value.trim();
    if (this.noteRequired() && !note) {
      this.reviewNote.markAsTouched();
      this.alertService.error(
        action === 'reverse' ? 'Enter a reason for reversing.' : 'Enter a note for the dispute.',
      );
      return;
    }
    if (this.reviewNote.invalid) {
      this.reviewNote.markAsTouched();
      return;
    }

    this.isReviewing.set(true);
    this.reviewRequest(entry.id, action, note).subscribe({
      next: (updated) => {
        this.entries.update((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        if (entry.status === 'PendingReview') {
          this.pendingCount.update((count) => Math.max(0, count - 1));
        }
        this.isReviewing.set(false);
        this.alertService.success(this.successMessage(action, updated));
        this.reviewTarget.set(null);
        this.reviewAction.set(null);
        this.removeFromStack();
        this.stockWaste.refreshPendingCount();
      },
      error: (err: Error) => {
        this.isReviewing.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected reviewHeading(): string {
    switch (this.reviewAction()) {
      case 'confirm':
        return 'Confirm Waste';
      case 'dispute':
        return 'Dispute Waste';
      default:
        return 'Reverse Waste';
    }
  }

  protected reviewConfirmLabel(): string {
    switch (this.reviewAction()) {
      case 'confirm':
        return 'Confirm';
      case 'dispute':
        return 'Dispute';
      default:
        return 'Reverse';
    }
  }

  protected reviewBusyLabel(): string {
    switch (this.reviewAction()) {
      case 'confirm':
        return 'Confirming...';
      case 'dispute':
        return 'Disputing...';
      default:
        return 'Reversing...';
    }
  }

  protected reviewNoteLabel(): string {
    switch (this.reviewAction()) {
      case 'confirm':
        return 'Note (optional)';
      case 'dispute':
        return 'Why is it disputed?';
      default:
        return 'Reason for reversing';
    }
  }

  private reviewRequest(id: string, action: ReviewAction, note: string): Observable<StockWasteDto> {
    switch (action) {
      case 'confirm':
        return this.stockWaste.confirm(id, note || null);
      case 'dispute':
        return this.stockWaste.dispute(id, note);
      default:
        return this.stockWaste.reverse(id, note);
    }
  }

  private successMessage(action: ReviewAction, entry: StockWasteDto): string {
    switch (action) {
      case 'confirm':
        return `Waste of ${entry.itemName} confirmed.`;
      case 'dispute':
        return `Waste of ${entry.itemName} disputed.`;
      default:
        return `Waste of ${entry.itemName} reversed. The stock is back.`;
    }
  }

  private buildQuery(): StockWasteQuery {
    const range = this.dateRange();
    return {
      fromDate: range.from,
      toDate: range.to,
      status: this.status(),
      wasteReasonId: this.reasonId(),
      itemId: this.itemFilter()?.id ?? null,
      searchTerm: this.searchControl.value?.trim() || null,
      sortBy: this.sortColumn(),
      sortDirection: this.sortColumn() ? this.sortDirection() : null,
      page: this.page(),
      pageSize: this.pageSize(),
    };
  }

  private dateRange(): { from: string | null; to: string | null } {
    const preset = this.datePreset();
    if (preset === 'all') {
      return { from: null, to: null };
    }

    const today = new Date();
    const from = new Date(today);
    if (preset === 'week') {
      from.setDate(from.getDate() - 6);
    } else if (preset === 'month') {
      from.setDate(from.getDate() - 29);
    }

    return { from: this.toDateString(from), to: this.toDateString(today) };
  }

  private toDateString(date: Date): string {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  private reloadFromFirstPage(): void {
    this.page.set(1);
    writePageParam(this.router, this.route, 1);
    this.load();
  }

  private syncStatusParam(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status: this.status() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
