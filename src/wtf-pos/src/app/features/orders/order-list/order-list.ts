import type { BadgeVariant } from '@shared/components/badge/badge';
import { orderStatusLabel, orderStatusVariant } from '@shared/utils/order-status';
import { CommonModule, DatePipe } from '@angular/common';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { selectedFilterCount } from '@shared/utils/filter-count';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  AlertService,
  AuthService,
  ConnectivityService,
  ListStateService,
  OfflineOrderService,
  OrderService,
  PlanStore,
  SignalRService,
  BranchService,
} from '@core/services';
import {
  BadgeComponent,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  SideDrawerComponent,
  type FilterOption,
} from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';
import type { CartItemDto } from '@shared/models';
import {
  OrderDto,
  KitchenStateEnum,
  OrderSourceEnum,
  OrderStatusEnum,
} from '@shared/models';
import { debounceTime, Subscription } from 'rxjs';
import {
  cartTotal,
  dateRangeBounds,
  orderMatchesListFilter,
  type OrderListFilter,
} from '@shared/calculations';
import { ListScrollService, type ListScrollPosition } from '@core/services/list-scroll.service';
import { ScrollLoaderComponent } from '@shared/components/scroll-loader/scroll-loader';
import { orderAddressOf } from '@shared/utils/order-address';
import type { PendingOrder, SyncOutcome, SyncResultEntry } from '@core/services/db';

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type KitchenFilter = 'open' | 'served';
type SortColumn = 'orderNumber' | 'date' | 'totalAmount';
type SortDirection = 'asc' | 'desc';
interface OrderListState {
  searchTerm: string;
  selectedStatuses: OrderStatusEnum[];
  selectedSources?: OrderSourceEnum[];
  selectedKitchen?: KitchenFilter | null;
  selectedDateRanges: string[];
  customStartDate: string;
  customEndDate: string;
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
}

interface OrderGroup {
  label: string;
  orders: OrderDto[];
}

@Component({
  selector: 'app-order-list',
  imports: [
    FilterButtonComponent,
    CommonModule,
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    SideDrawerComponent,
    BadgeComponent,
    PullToRefreshComponent,
    SearchInputComponent,
    ScrollLoaderComponent,
  ],
  templateUrl: './order-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderList implements OnInit, OnDestroy {
  private readonly pullToRefresh = viewChild(PullToRefreshComponent);
  private readonly listScroll = inject(ListScrollService);
  private readonly stateKey = 'orders:order-list';
  private readonly orderService = inject(OrderService);
  protected readonly branchService = inject(BranchService);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);
  private readonly listState = inject(ListStateService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly signalRService = inject(SignalRService);
  private readonly authService = inject(AuthService);
  private readonly planStore = inject(PlanStore);
  protected readonly offlineOrderService = inject(OfflineOrderService);
  protected readonly isOnline = this.connectivity.isOnline;
  protected readonly routes = AppRoutes;

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly orders = signal<OrderDto[]>([]);
  protected readonly canCreateOrders = computed(() => this.authService.canWriteOrders());
  protected readonly ordersCache = signal<OrderDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isLoadingMore = signal(false);
  protected readonly isReloading = signal(false);
  protected readonly loadMoreFailed = signal(false);
  private readonly endReachedSignal = signal(false);
  protected readonly facets = signal<Record<string, number>>({});
  protected readonly isRefreshing = signal(false);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly totalCount = signal(0);
  protected readonly pendingOrders = this.offlineOrderService.visiblePendingOrders;
  protected readonly syncResults = this.offlineOrderService.syncResults;
  protected readonly isSyncResultsExpanded = signal(true);
  protected readonly isSyncingOffline = this.offlineOrderService.isSyncing;
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isFiltersOpen = signal(false);
  protected readonly isPendingExpanded = signal(false);
  protected readonly sortColumn = signal<SortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('desc');
  protected readonly selectedStatuses = signal<OrderStatusEnum[]>([]);
  protected readonly selectedSources = signal<OrderSourceEnum[]>([]);
  protected readonly selectedKitchen = signal<KitchenFilter | null>(null);
  protected readonly kitchenOptions: { id: KitchenFilter; label: string }[] = [
    { id: 'open', label: 'With the kitchen' },
    { id: 'served', label: 'Served' },
  ];
  protected readonly showKitchenFilter = computed(() => this.planStore.hasFeature('kitchen'));
  protected readonly sourceOptions: { id: OrderSourceEnum; label: string }[] = [
    { id: OrderSourceEnum.Pos, label: 'Shop orders' },
    { id: OrderSourceEnum.CustomerLink, label: 'Customer link orders' },
  ];
  protected readonly selectedDateRanges = signal<string[]>([]);
  protected readonly customStartDate = signal('');
  protected readonly customEndDate = signal('');
  protected readonly maxDate = (() => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offsetMs).toISOString().split('T')[0];
  })();
  private readonly waitingForReconnectSync = signal(false);
  private wasOnline = this.connectivity.isOnline();
  private wasSyncingOffline = false;
  private lastQueryKey = '';
  private pendingRestore: ListScrollPosition | null = null;
  private scrollOffset = 0;
  private loadRequest: Subscription | null = null;
  private hubSub: Subscription | null = null;
  constructor() {
    effect(
      () => {
        const online = this.isOnline();
        const syncingOffline = this.isSyncingOffline();
        const pendingCount = this.pendingOrders().length;

        if (online && !this.wasOnline) {
          if (pendingCount > 0) {
            this.waitingForReconnectSync.set(true);
            this.isLoading.set(true);
          } else {
            this.loadOrders();
          }
        }

        if (this.wasSyncingOffline && !syncingOffline && online) {
          if (this.waitingForReconnectSync()) {
            this.waitingForReconnectSync.set(false);
            this.loadOrders();
          } else if (pendingCount === 0) {
            this.loadOrders();
          }
        }

        if (!online) {
          this.waitingForReconnectSync.set(false);
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        }

        this.wasOnline = online;
        this.wasSyncingOffline = syncingOffline;
      },
      { allowSignalWrites: true },
    );
  }




  protected readonly groupedOrders = computed<OrderGroup[]>(() => {
    const items = this.orders();
    const groups = new Map<string, OrderDto[]>();

    items.forEach((order) => {
      const dateLabel = this.getDateGroupLabel(order);
      if (!groups.has(dateLabel)) {
        groups.set(dateLabel, []);
      }
      groups.get(dateLabel)!.push(order);
    });

    return Array.from(groups, ([label, orders]) => ({ label, orders }));
  });

  protected readonly statusCounts = computed(() => {
    const facets = this.facets();
    return {
      [OrderStatusEnum.All]: facets['all'] ?? 0,
      [OrderStatusEnum.Pending]: facets[OrderStatusEnum.Pending] ?? 0,
      [OrderStatusEnum.Completed]: facets[OrderStatusEnum.Completed] ?? 0,
      [OrderStatusEnum.Cancelled]: facets[OrderStatusEnum.Cancelled] ?? 0,
      [OrderStatusEnum.Refunded]: facets[OrderStatusEnum.Refunded] ?? 0,
    };
  });

  protected readonly filterOptions = computed<FilterOption[]>(() => [
    {
      id: OrderStatusEnum.Pending,
      label: 'Pending',
      count: this.statusCounts()[OrderStatusEnum.Pending],
    },
    {
      id: OrderStatusEnum.Completed,
      label: 'Completed',
      count: this.statusCounts()[OrderStatusEnum.Completed],
    },
    {
      id: OrderStatusEnum.Cancelled,
      label: 'Cancelled',
      count: this.statusCounts()[OrderStatusEnum.Cancelled],
    },
    {
      id: OrderStatusEnum.Refunded,
      label: 'Refunded',
      count: this.statusCounts()[OrderStatusEnum.Refunded],
    },
  ]);

  protected readonly dateRangeOptions = computed<FilterOption[]>(() => [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 days' },
    { id: '30d', label: 'Last 30 days' },
    { id: 'custom', label: 'Custom Range' },
  ]);

  protected readonly selectedDateRangeId = computed<string[]>(() => {
    const selected = this.selectedDateRanges()[0];
    return selected ? [selected] : [];
  });
  protected readonly hasMoreOrders = computed(
    () => !this.endReachedSignal() && this.ordersCache().length < this.totalCount(),
  );

  public ngOnInit(): void {
    this.restoreState();
    this.pendingRestore = this.listScroll.take(this.stateKey);
    this.resetAndLoadOrders();
    // The orders hub, not the dashboard one, so staff who cannot open the dashboard still see changes live.
    this.signalRService.startStaffOrdersHub();
    this.hubSub = this.signalRService.orderChanged.subscribe((orderId) => {
      this.handleOrderUpdated(orderId);
    });

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.resetAndLoadOrders();
      this.saveState();
    });
  }

  public ngOnDestroy(): void {
    if (this.scrollOffset > 0 || this.currentPage() > 1) {
      this.listScroll.save(this.stateKey, {
        pages: this.currentPage(),
        offset: this.scrollOffset,
      });
    }

    this.hubSub?.unsubscribe();
    this.signalRService.stopStaffOrdersHub();
  }

  protected loadOrders(): void {
    if (!this.connectivity.isOnline()) {
      return;
    }

    this.loadRequest?.unsubscribe();
    const restore = this.pendingRestore;
    this.pendingRestore = null;
    const firstLoad = this.ordersCache().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.isLoadingMore.set(false);
    this.loadMoreFailed.set(false);
    this.endReachedSignal.set(false);
    this.lastQueryKey = this.queryKey();

    const pageSize = restore ? Math.min(restore.pages * PAGE_SIZE, MAX_PAGE_SIZE) : PAGE_SIZE;
    this.loadRequest = this.orderService.getOrdersPaged(this.listQuery(1, pageSize)).subscribe({
      next: (result) => {
        this.currentPage.set(Math.max(1, Math.ceil(result.items.length / PAGE_SIZE)));
        this.totalCount.set(result.totalCount);
        this.facets.set(result.facets ?? {});
        this.ordersCache.set(result.items);
        this.applyFiltersToCache();
        this.isLoading.set(false);
        this.isReloading.set(false);
        this.isRefreshing.set(false);
        if (restore) {
          this.restoreScroll(restore);
        } else {
          this.scrollToTopSoon();
        }
      },
      error: (err) => {
        this.alertService.error(err.message || this.alertService.getLoadErrorMessage('orders'));
        this.isLoading.set(false);
        this.isReloading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  protected loadMoreOrders(): void {
    if (
      !this.connectivity.isOnline() ||
      this.isLoading() ||
      this.isReloading() ||
      this.isLoadingMore() ||
      !this.hasMoreOrders()
    ) {
      return;
    }

    this.isLoadingMore.set(true);
    this.loadMoreFailed.set(false);
    const nextPage = this.currentPage() + 1;
    const queryKey = this.lastQueryKey;

    this.orderService.getOrdersPaged(this.listQuery(nextPage, PAGE_SIZE)).subscribe({
      next: (result) => {
        if (queryKey !== this.lastQueryKey) {
          return;
        }

        // A new order arriving while scrolling shifts the pages down by one, so drop rows already shown.
        const known = new Set(this.ordersCache().map((order) => order.id));
        const fresh = result.items.filter((order) => !known.has(order.id));
        this.currentPage.set(result.page);
        this.totalCount.set(result.totalCount);
        this.facets.set(result.facets ?? this.facets());
        this.ordersCache.set([...this.ordersCache(), ...fresh]);
        this.endReachedSignal.set(fresh.length === 0 || result.page < nextPage);
        this.applyFiltersToCache();
        this.isLoadingMore.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message || this.alertService.getLoadErrorMessage('orders'));
        this.loadMoreFailed.set(true);
        this.isLoadingMore.set(false);
      },
    });
  }

  protected refresh(): void {
    if (this.isRefreshing() || this.isSyncingOffline()) {
      return;
    }

    this.isRefreshing.set(true);
    this.resetAndLoadOrders();
  }

  private serverFilter(): OrderListFilter {
    return {
      statuses: this.selectedStatuses(),
      bounds: dateRangeBounds(
        this.selectedDateRanges()[0],
        this.customStartDate(),
        this.customEndDate(),
      ),
      source: this.sourceFilter(),
    };
  }

  private serverSort(): { sortBy?: string; sortDirection?: string } {
    const column = this.sortColumn();
    if (column === 'orderNumber') {
      return { sortBy: 'orderNumber', sortDirection: this.sortDirection() };
    }

    if (column === 'date') {
      return { sortBy: 'createdAt', sortDirection: this.sortDirection() };
    }

    return {};
  }

  private listQuery(page: number, pageSize: number) {
    const filter = this.serverFilter();
    return {
      searchTerm: this.filterForm.controls.searchTerm.value,
      source: filter.source,
      kitchen: this.selectedKitchen() ?? undefined,
      statuses: [...filter.statuses],
      from: filter.bounds.from,
      to: filter.bounds.to,
      ...this.serverSort(),
      page,
      pageSize,
    };
  }

  private queryKey(): string {
    return JSON.stringify(this.listQuery(1, PAGE_SIZE));
  }

  private reloadIfQueryChanged(): void {
    if (this.queryKey() !== this.lastQueryKey) {
      this.loadOrders();
    } else {
      this.applyFiltersToCache();
    }
  }

  private scrollToTopSoon(): void {
    queueMicrotask(() => this.pullToRefresh()?.scrollToTop());
  }

  private restoreScroll(position: ListScrollPosition): void {
    setTimeout(() => this.pullToRefresh()?.scrollToOffset(position.offset), 0);
  }

  protected rememberScroll(event: Event): void {
    this.scrollOffset = (event.target as HTMLElement).scrollTop;
  }

  private resetAndLoadOrders(): void {
    this.loadOrders();
  }

  protected onDateRangeFilterChange(selectedIds: (string | number)[]): void {
    const selected = selectedIds[0]?.toString();
    if (!selected) {
      this.selectedDateRanges.set([]);
      this.customStartDate.set('');
      this.customEndDate.set('');
      this.saveState();
      this.reloadIfQueryChanged();
      return;
    }

    this.selectedDateRanges.set([selected]);
    if (selected !== 'custom') {
      this.customStartDate.set('');
      this.customEndDate.set('');
    }
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected onDateRangeFilterReset(): void {
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected isDateRangeSelected(rangeId: string): boolean {
    return this.selectedDateRanges()[0] === rangeId;
  }

  protected toggleDateRangeSelection(rangeId: string): void {
    if (this.selectedDateRanges()[0] === rangeId) {
      this.selectedDateRanges.set([]);
    } else {
      this.selectedDateRanges.set([rangeId]);
    }
    if (rangeId !== 'custom') {
      this.customStartDate.set('');
      this.customEndDate.set('');
    }
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected clearDateRangeSelections(): void {
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected onCustomStartDateChanged(value: string): void {
    this.customStartDate.set(value);
    this.selectedDateRanges.set(['custom']);
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected onCustomEndDateChanged(value: string): void {
    this.customEndDate.set(value);
    this.selectedDateRanges.set(['custom']);
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected clearCustomDateRange(): void {
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected onStatusFilterChange(selectedIds: (string | number)[]): void {
    this.selectedStatuses.set(selectedIds as OrderStatusEnum[]);
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected onStatusFilterReset(): void {
    this.selectedStatuses.set([]);
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected isStatusSelected(statusId: number): boolean {
    return this.selectedStatuses().includes(statusId as OrderStatusEnum);
  }

  protected toggleStatusSelection(statusId: number): void {
    const status = statusId as OrderStatusEnum;
    const current = this.selectedStatuses();
    if (current.includes(status)) {
      this.selectedStatuses.set(current.filter((item) => item !== status));
    } else {
      this.selectedStatuses.set([...current, status]);
    }
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected clearStatusSelections(): void {
    this.selectedStatuses.set([]);
    this.saveState();
    this.reloadIfQueryChanged();
  }

  /** The one source to ask the server for. Both chosen, or none, means every order. */
  private sourceFilter(): OrderSourceEnum | undefined {
    const chosen = this.selectedSources();
    return chosen.length === 1 ? chosen[0] : undefined;
  }

  protected isSourceSelected(source: OrderSourceEnum): boolean {
    return this.selectedSources().includes(source);
  }

  protected toggleSourceSelection(source: OrderSourceEnum): void {
    const current = this.selectedSources();
    this.selectedSources.set(
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
    );
    this.saveState();
    this.resetAndLoadOrders();
  }

  protected selectKitchen(kitchen: KitchenFilter | null): void {
    this.selectedKitchen.set(kitchen);
    this.saveState();
    this.resetAndLoadOrders();
  }

  protected kitchenChip(order: OrderDto): { label: string; variant: BadgeVariant } | null {
    switch (order.kitchenStatus) {
      case KitchenStateEnum.New:
        return { label: 'Kitchen: new', variant: 'default' };
      case KitchenStateEnum.Preparing:
        return { label: 'Kitchen: making', variant: 'amber' };
      case KitchenStateEnum.Ready:
        return { label: 'Kitchen: ready', variant: 'success' };
      case KitchenStateEnum.Served:
        return { label: 'Served', variant: 'info' };
      default:
        return null;
    }
  }

  protected clearSourceSelections(): void {
    this.selectedSources.set([]);
    this.saveState();
    this.resetAndLoadOrders();
  }

  /** How many filters are applied, shown on the Filters button. */
  protected readonly activeFilterCount = computed(
    () =>
      selectedFilterCount(this.selectedStatuses().length, this.filterOptions().length) +
      selectedFilterCount(this.selectedSources().length, this.sourceOptions.length) +
      (this.selectedKitchen() ? 1 : 0) +
      (this.selectedDateRanges().length > 0 ? 1 : 0),
  );

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('desc');
    }
    this.saveState();
    this.reloadIfQueryChanged();
  }

  protected resetFilters(): void {
    this.filterForm.reset({
      searchTerm: '',
    });
    this.selectedStatuses.set([]);
    this.selectedSources.set([]);
    this.selectedKitchen.set(null);
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.saveState();
    this.reloadIfQueryChanged();
    this.resetAndLoadOrders();
  }

  protected getStatusVariant(status?: OrderStatusEnum | null): BadgeVariant {
    return orderStatusVariant(status);
  }

  protected getStatusLabel(status?: OrderStatusEnum | null): string {
    return orderStatusLabel(status);
  }

  protected getOrderDate(order: OrderDto): string {
    return order.createdAt || order.updatedAt || '';
  }

  protected getItemsText(order: OrderDto): string {
    const nonBundleCount = order.items
      .filter((item) => !item.bundlePromotionId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const bundleCount = (order.bundlePromotions ?? []).reduce(
      (sum, bundle) => sum + bundle.quantity,
      0,
    );
    const count = nonBundleCount + bundleCount;
    return count === 1 ? '1 item' : `${count} items`;
  }

  private getDateGroupLabel(order: OrderDto): string {
    const orderDate = new Date(this.getOrderDate(order));
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const orderDateStr = orderDate.toDateString();
    const todayStr = today.toDateString();
    const yesterdayStr = yesterday.toDateString();

    if (orderDateStr === todayStr) {
      return 'Today';
    } else if (orderDateStr === yesterdayStr) {
      return 'Yesterday';
    } else {
      // Format as "Monday, Jan 20"
      return orderDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
    }
  }

  protected openOrder(order: OrderDto): void {
    if (order.status === OrderStatusEnum.Pending) {
      this.router.navigateByUrl(AppRoutes.OrderEditorById(order.id));
      return;
    }

    this.router.navigateByUrl(AppRoutes.OrderDetailsById(order.id));
  }

  protected editPendingOrder(localId: string): void {
    void this.router.navigate([AppRoutes.OrdersEditor], { queryParams: { offline: localId } });
  }

  protected syncPendingOrders(): void {
    if (this.isRefreshing()) {
      return;
    }

    void this.offlineOrderService.syncNow();
  }

  protected syncOutcomeVariant(outcome: SyncOutcome): BadgeVariant {
    switch (outcome) {
      case 'saved':
        return 'success';
      case 'saved-with-note':
        return 'info';
      case 'sent-for-review':
        return 'warning';
      default:
        return 'error';
    }
  }

  protected syncOutcomeLabel(entry: SyncResultEntry): string {
    switch (entry.outcome) {
      case 'saved':
        return entry.orderNumber ? `Saved as order #${entry.orderNumber}` : 'Saved';
      case 'saved-with-note':
        return entry.orderNumber ? `Saved as order #${entry.orderNumber} with a note` : 'Saved with a note';
      case 'sent-for-review':
        return entry.orderNumber ? `Order #${entry.orderNumber} sent for review` : 'Sent for review';
      default:
        return 'Could not sync';
    }
  }

  protected dismissSyncResult(entry: SyncResultEntry): void {
    void this.offlineOrderService.dismissSyncResult(entry.id!);
  }

  protected clearSyncResults(): void {
    void this.offlineOrderService.clearSyncResults();
  }

  protected getPendingItemCount(cartSnapshot: CartItemDto[]): string {
    const count = cartSnapshot.reduce((sum, item) => sum + item.qty, 0);
    return count === 1 ? '1 item' : `${count} items`;
  }

  protected getPendingTotal(pending: Pick<PendingOrder, 'cartSnapshot' | 'previewTotal'>): number {
    return pending.previewTotal ?? cartTotal(pending.cartSnapshot);
  }

  protected getOrderStatusVariant(
    status?: OrderStatusEnum | null,
  ): 'success' | 'error' | 'warning' | 'info' | 'default' {
    switch (status) {
      case OrderStatusEnum.Pending:
        return 'warning';
      case OrderStatusEnum.Completed:
        return 'success';
      default:
        return 'info';
    }
  }

  protected getOrderStatusLabel(status?: OrderStatusEnum | null): string {
    switch (status) {
      case OrderStatusEnum.Pending:
        return 'Pending';
      case OrderStatusEnum.Completed:
        return 'Completed';
      default:
        return 'Unknown';
    }
  }

  protected isSortActive(column: SortColumn): boolean {
    return this.sortColumn() === column;
  }

  protected stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  private applyFiltersToCache(): void {
    const items = [...this.ordersCache()];

    // The server filters and sorts by number and date; the total is a calculation, so it sorts the loaded rows only.
    if (this.sortColumn() === 'totalAmount') {
      const direction = this.sortDirection();
      items.sort((x, y) =>
        direction === 'asc' ? x.totalAmount - y.totalAmount : y.totalAmount - x.totalAmount,
      );
    }

    this.orders.set(items);
  }

  private handleOrderUpdated(orderId: string): void {
    if (!orderId || !this.connectivity.isOnline()) {
      return;
    }

    this.orderService.getOrder(orderId).subscribe({
      next: (order) => {
        // Held and waiting orders are handled on the Needs attention page, never in this list.
        if (
          order.status === OrderStatusEnum.PendingReview ||
          order.status === OrderStatusEnum.PendingApproval
        ) {
          return;
        }

        this.mergeIntoList(order);
      },
      error: () => {
        // Silent fail for background updates.
      },
    });
  }

  /** Puts an order that changed (or was just accepted or rejected) into the normal list. */
  private mergeIntoList(order: OrderDto): void {
    const matches = orderMatchesListFilter(order, this.serverFilter()) && this.matchesSearchTerm(order);
    const existingIndex = this.ordersCache().findIndex((item) => item.id === order.id);

    if (existingIndex >= 0) {
      const updated = [...this.ordersCache()];
      if (matches) {
        updated[existingIndex] = order;
      } else {
        updated.splice(existingIndex, 1);
      }
      this.ordersCache.set(updated);
      this.applyFiltersToCache();
    } else if (matches && this.isNewestFirst()) {
      this.ordersCache.set([order, ...this.ordersCache()]);
      this.applyFiltersToCache();
    }

    this.refreshCounts();
  }

  private isNewestFirst(): boolean {
    const column = this.sortColumn();
    return column === null || column === 'totalAmount' || (column === 'date' && this.sortDirection() === 'desc');
  }

  private refreshCounts(): void {
    if (!this.connectivity.isOnline()) {
      return;
    }

    const queryKey = this.lastQueryKey;
    this.orderService.getOrdersPaged(this.listQuery(1, 1)).subscribe({
      next: (result) => {
        if (queryKey === this.lastQueryKey) {
          this.totalCount.set(result.totalCount);
          this.facets.set(result.facets ?? {});
        }
      },
      error: () => {
        // The counts catch up on the next load.
      },
    });
  }

  // --- orders waiting for approval ---









  // --- offline orders held for review ---












  private matchesSearchTerm(order: OrderDto): boolean {
    const term = (this.filterForm.controls.searchTerm.value ?? '').trim().toLowerCase();
    if (!term) {
      return true;
    }

    const orderNumber = order.orderNumber.toString();
    const customerName = (order.customerName ?? '').toLowerCase();
    const address = (this.getOrderAddress(order) ?? '').toLowerCase();
    return orderNumber.includes(term) || customerName.includes(term) || address.includes(term);
  }

  protected getOrderAddress(order: OrderDto): string | null {
    return orderAddressOf(order);
  }

  private restoreState(): void {
    const state = this.listState.load<OrderListState>(this.stateKey, {
      searchTerm: '',
      selectedStatuses: [],
      selectedSources: [],
      selectedKitchen: null,
      selectedDateRanges: [],
      customStartDate: '',
      customEndDate: '',
      sortColumn: null,
      sortDirection: 'desc',
    });

    this.filterForm.patchValue(
      {
        searchTerm: state.searchTerm,
      },
      { emitEvent: false },
    );
    this.selectedStatuses.set(state.selectedStatuses ?? []);
    this.selectedSources.set(state.selectedSources ?? []);
    this.selectedKitchen.set(state.selectedKitchen ?? null);
    this.selectedDateRanges.set(state.selectedDateRanges ?? []);
    this.customStartDate.set(state.customStartDate ?? '');
    this.customEndDate.set(state.customEndDate ?? '');
    this.sortColumn.set(state.sortColumn);
    this.sortDirection.set(state.sortDirection);
  }

  private saveState(): void {
    this.listState.save<OrderListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedStatuses: this.selectedStatuses(),
      selectedSources: this.selectedSources(),
      selectedKitchen: this.selectedKitchen(),
      selectedDateRanges: this.selectedDateRanges(),
      customStartDate: this.customStartDate(),
      customEndDate: this.customEndDate(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    });
  }
}
