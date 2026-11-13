import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { HttpErrorMessages } from '@core/messages';
import { AlertService, HeldOrderService, ModalStackService } from '@core/services';
import {
  ConnectionErrorComponent,
  IconComponent,
  PullToRefreshComponent,
  SideDrawerComponent,
} from '@shared/components';
import { BadgeComponent } from '@shared/components/badge/badge';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { sumAmounts } from '@shared/calculations';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  BulkApproveResultDto,
  HELD_REASON_LABELS,
  HeldOrderFilter,
  HeldOrderRowDto,
  HeldOrdersDto,
  heldReasonLabel,
  isSeniorPwdReason,
} from '@shared/models';

type DatePreset = 'all' | 'today' | 'week' | 'month';
type HeldSortColumn = 'order' | 'reasons' | 'cashier' | 'sold' | 'value';

interface BulkRequest {
  filter: HeldOrderFilter;
  preview: BulkApproveResultDto;
  scope: 'selected' | 'matching';
}

@Component({
  selector: 'app-held-orders',
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
  templateUrl: './held-orders.html',
  host: { class: 'flex-1 min-h-0' },
})
export class HeldOrders implements OnInit, OnDestroy {
  private readonly heldOrderService = inject(HeldOrderService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly datePresets: { value: DatePreset; label: string }[] = [
    { value: 'all', label: 'Any time' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: '7 days' },
    { value: 'month', label: '30 days' },
  ];
  protected readonly reasonOptions = Object.entries(HELD_REASON_LABELS).map(([code, label]) => ({
    code,
    label,
  }));
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isCheckingBulk = signal(false);
  protected readonly isApprovingBulk = signal(false);
  protected readonly result = signal<HeldOrdersDto | null>(null);
  protected readonly cashiers = signal<{ id: string; name: string }[]>([]);
  protected readonly reasonCodes = signal<string[]>([]);
  protected readonly cashierId = signal<string | null>(null);
  protected readonly datePreset = signal<DatePreset>('all');
  protected readonly agedOnly = signal(false);
  protected readonly search = signal('');
  protected readonly isFiltersOpen = signal(false);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly bulkRequest = signal<BulkRequest | null>(null);
  protected readonly sortColumn = signal<HeldSortColumn | null>('sold');
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly activeFilterCount = computed(
    () =>
      (this.reasonCodes().length > 0 ? 1 : 0) +
      (this.cashierId() !== null ? 1 : 0) +
      (this.datePreset() !== 'all' ? 1 : 0) +
      (this.agedOnly() ? 1 : 0),
  );
  protected readonly orders = computed(() => this.result()?.items ?? []);
  protected readonly visibleOrders = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.orders();
    }

    return this.orders().filter(
      (order) =>
        `${order.orderNumber}`.includes(term.replace('#', '')) ||
        order.cashierName.toLowerCase().includes(term) ||
        (order.customerName ?? '').toLowerCase().includes(term) ||
        order.reasons.some((reason) => reason.toLowerCase().includes(term)),
    );
  });
  protected readonly sortedOrders = computed(() => {
    const column = this.sortColumn();
    const orders = [...this.visibleOrders()];
    if (!column) {
      return orders;
    }

    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: HeldOrderRowDto, b: HeldOrderRowDto): number => {
      switch (column) {
        case 'order':
          return a.orderNumber - b.orderNumber;
        case 'reasons':
          return (a.reasons[0] ?? '').localeCompare(b.reasons[0] ?? '', undefined, {
            sensitivity: 'base',
          });
        case 'cashier':
          return a.cashierName.localeCompare(b.cashierName, undefined, { sensitivity: 'base' });
        case 'sold':
          return a.createdAt.localeCompare(b.createdAt);
        case 'value':
          return a.amount - b.amount;
      }
    };

    return orders.sort((a, b) => compare(a, b) * direction);
  });
  protected readonly selectableOrders = computed(() =>
    this.visibleOrders().filter((order) => !this.isBulkSkipped(order)),
  );
  protected readonly selectedOrders = computed(() => {
    const selected = this.selectedIds();
    return this.orders().filter((order) => selected.has(order.id));
  });
  protected readonly selectedTotal = computed(() =>
    sumAmounts(this.selectedOrders().map((order) => order.amount)),
  );
  protected readonly allSelected = computed(
    () =>
      this.selectableOrders().length > 0 &&
      this.selectableOrders().every((order) => this.selectedIds().has(order.id)),
  );
  protected readonly cashierName = computed(
    () => this.cashiers().find((cashier) => cashier.id === this.cashierId())?.name ?? '',
  );

  private modalStackId: number | null = null;

  public ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('agedOnly') === 'true') {
      this.agedOnly.set(true);
    }

    this.load();
  }

  public ngOnDestroy(): void {
    this.removeFromStack();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected load(): void {
    this.connectionFailed.set(false);
    this.isLoading.set(this.result() === null);
    this.heldOrderService.getHeldOrders(this.filter()).subscribe({
      next: (result) => {
        this.result.set(result);
        this.rememberCashiers(result.items);
        this.dropVanishedSelection(result.items);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected toggleReason(code: string): void {
    this.reasonCodes.update((codes) =>
      codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code],
    );
    this.load();
  }

  protected clearReasons(): void {
    this.reasonCodes.set([]);
    this.load();
  }

  protected setCashier(value: string): void {
    this.cashierId.set(value || null);
    this.load();
  }

  protected setDatePreset(preset: DatePreset): void {
    this.datePreset.set(preset);
    this.load();
  }

  protected toggleAgedOnly(): void {
    this.agedOnly.update((value) => !value);
    this.load();
  }

  protected toggleSort(column: HeldSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  protected reasonLabel(code: string): string {
    return heldReasonLabel(code);
  }

  protected isBulkSkipped(order: HeldOrderRowDto): boolean {
    const named = this.reasonCodes();
    return order.reasonCodes.some((code) => isSeniorPwdReason(code) && !named.includes(code));
  }

  protected isSelected(order: HeldOrderRowDto): boolean {
    return this.selectedIds().has(order.id);
  }

  protected toggleSelected(order: HeldOrderRowDto): void {
    if (this.isBulkSkipped(order)) {
      return;
    }

    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(order.id)) {
        next.delete(order.id);
      } else {
        next.add(order.id);
      }

      return next;
    });
  }

  protected toggleSelectAll(): void {
    if (this.allSelected()) {
      this.selectedIds.set(new Set());
      return;
    }

    this.selectedIds.set(new Set(this.selectableOrders().map((order) => order.id)));
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  protected openOrder(order: HeldOrderRowDto): void {
    void this.router.navigateByUrl(AppRoutes.OrderDetailsById(order.id));
  }

  protected backToOrders(): void {
    void this.router.navigateByUrl(AppRoutes.OrdersList);
  }

  protected askApproveSelected(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) {
      return;
    }

    this.checkBulk({ ...this.filter(), ids }, 'selected');
  }

  protected askApproveMatching(): void {
    const searching = this.search().trim().length > 0;
    const filter = searching
      ? { ...this.filter(), ids: this.visibleOrders().map((order) => order.id) }
      : this.filter();
    this.checkBulk(filter, 'matching');
  }

  protected cancelBulk(): void {
    if (this.isApprovingBulk()) {
      return;
    }

    this.bulkRequest.set(null);
    this.removeFromStack();
  }

  protected confirmBulk(): void {
    const request = this.bulkRequest();
    if (!request || this.isApprovingBulk()) {
      return;
    }

    this.isApprovingBulk.set(true);
    this.heldOrderService.bulkApprove(request.filter, false).subscribe({
      next: (outcome) => {
        this.isApprovingBulk.set(false);
        this.bulkRequest.set(null);
        this.removeFromStack();
        this.clearSelection();
        this.reportOutcome(outcome);
        this.load();
      },
      error: (err: Error) => {
        this.isApprovingBulk.set(false);
        this.bulkRequest.set(null);
        this.removeFromStack();
        this.alertService.error(err.message);
        this.load();
      },
    });
  }

  protected skippedSeniorPwd(result: BulkApproveResultDto): number {
    return result.items.filter((item) => item.outcome === 'SkippedSeniorPwd').length;
  }

  protected skippedNotHeld(result: BulkApproveResultDto): number {
    return result.items.filter((item) => item.outcome === 'SkippedNotHeld').length;
  }

  protected plural(count: number, one: string, many: string): string {
    return count === 1 ? one : many;
  }

  private filter(): HeldOrderFilter {
    const range = this.dateRange();
    return {
      reasonCodes: this.reasonCodes(),
      cashierId: this.cashierId(),
      fromDate: range.from,
      toDate: range.to,
      agedOnly: this.agedOnly(),
    };
  }

  private checkBulk(filter: HeldOrderFilter, scope: 'selected' | 'matching'): void {
    if (this.isCheckingBulk() || this.isApprovingBulk()) {
      return;
    }

    this.isCheckingBulk.set(true);
    this.heldOrderService.bulkApprove(filter, true).subscribe({
      next: (preview) => {
        this.isCheckingBulk.set(false);
        if (preview.count === 0) {
          this.alertService.info(
            preview.skippedCount > 0
              ? 'Nothing can be approved together here. Senior/PWD orders are approved one by one.'
              : 'There are no orders to approve.',
          );
          this.load();
          return;
        }

        this.bulkRequest.set({ filter, preview, scope });
        this.modalStackId = this.modalStack.push(() => this.cancelBulk());
      },
      error: (err: Error) => {
        this.isCheckingBulk.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  private reportOutcome(outcome: BulkApproveResultDto): void {
    const money = `PHP ${outcome.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const approved = `${outcome.count} ${this.plural(outcome.count, 'order', 'orders')} approved (${money}).`;
    if (outcome.failedCount === 0 && outcome.skippedCount === 0) {
      this.alertService.success(approved);
      return;
    }

    const left = outcome.failedCount + outcome.skippedCount;
    this.alertService.warning(
      `${approved} ${left} ${this.plural(left, 'order was', 'orders were')} left for you to look at.`,
    );
  }

  private rememberCashiers(items: HeldOrderRowDto[]): void {
    const known = new Map(this.cashiers().map((cashier) => [cashier.id, cashier.name]));
    for (const order of items) {
      known.set(order.cashierId, order.cashierName);
    }

    this.cashiers.set(
      [...known.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    );
  }

  private dropVanishedSelection(items: HeldOrderRowDto[]): void {
    const present = new Set(items.map((order) => order.id));
    const kept = [...this.selectedIds()].filter((id) => present.has(id));
    if (kept.length !== this.selectedIds().size) {
      this.selectedIds.set(new Set(kept));
    }
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

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
