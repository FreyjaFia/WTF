import { CommonModule, DatePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  AlertService,
  ConnectivityService,
  ListStateService,
  OfflineOrderService,
  OrderService,
} from '@core/services';
import {
  BadgeComponent,
  SideDrawerComponent,
  FilterDropdownComponent,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  type FilterOption,
} from '@shared/components';
import type { CartItemDto } from '@shared/models';
import { OrderDto, OrderStatusEnum } from '@shared/models';
import { debounceTime } from 'rxjs';

type SortColumn = 'orderNumber' | 'date' | 'totalAmount';
type SortDirection = 'asc' | 'desc';
interface OrderListState {
  searchTerm: string;
  selectedStatuses: OrderStatusEnum[];
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
    CommonModule,
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    SideDrawerComponent,
    FilterDropdownComponent,
    BadgeComponent,
    PullToRefreshComponent,
    SearchInputComponent,
  ],
  templateUrl: './order-list.html',
})
export class OrderList implements OnInit {
  private readonly loadMoreSentinel = viewChild<ElementRef<HTMLElement>>('loadMoreSentinel');
  private readonly stateKey = 'orders:order-list';
  private readonly orderService = inject(OrderService);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);
  private readonly listState = inject(ListStateService);
  private readonly connectivity = inject(ConnectivityService);
  protected readonly offlineOrderService = inject(OfflineOrderService);
  protected readonly isOnline = this.connectivity.isOnline;

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly orders = signal<OrderDto[]>([]);
  protected readonly ordersCache = signal<OrderDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isLoadingMore = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly totalCount = signal(0);
  protected readonly OrderStatusEnum = OrderStatusEnum;
  protected readonly pendingOrders = this.offlineOrderService.pendingOrders;
  protected readonly isSyncingOffline = this.offlineOrderService.isSyncing;
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isMobileFiltersOpen = signal(false);
  protected readonly sortColumn = signal<SortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('desc');
  protected readonly selectedStatuses = signal<OrderStatusEnum[]>([]);
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
  private readonly infiniteScrollEffect = effect((onCleanup) => {
    const sentinel = this.loadMoreSentinel()?.nativeElement;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.loadMoreOrders();
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0 },
    );

    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

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
    const cache = this.ordersCache();
    return {
      [OrderStatusEnum.All]: cache.length,
      [OrderStatusEnum.Pending]: cache.filter((o) => o.status === OrderStatusEnum.Pending).length,
      [OrderStatusEnum.Completed]: cache.filter((o) => o.status === OrderStatusEnum.Completed)
        .length,
      [OrderStatusEnum.Cancelled]: cache.filter((o) => o.status === OrderStatusEnum.Cancelled)
        .length,
      [OrderStatusEnum.Refunded]: cache.filter((o) => o.status === OrderStatusEnum.Refunded).length,
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
    () => this.ordersCache().length < this.totalCount(),
  );

  public ngOnInit(): void {
    this.restoreState();
    this.resetAndLoadOrders();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.resetAndLoadOrders();
      this.saveState();
    });
  }

  protected loadOrders(): void {
    if (!this.connectivity.isOnline()) {
      return;
    }

    this.isLoading.set(true);
    this.currentPage.set(1);
    this.totalCount.set(0);
    this.ordersCache.set([]);
    this.orders.set([]);

    this.orderService
      .getOrdersPaged({
        searchTerm: this.filterForm.controls.searchTerm.value,
        page: 1,
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.currentPage.set(result.page);
          this.totalCount.set(result.totalCount);
          this.ordersCache.set(result.items);
          this.applyFiltersToCache();
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        },
        error: (err) => {
          this.alertService.error(err.message || this.alertService.getLoadErrorMessage('orders'));
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        },
      });
  }

  protected loadMoreOrders(): void {
    if (!this.connectivity.isOnline() || this.isLoading() || this.isLoadingMore() || !this.hasMoreOrders()) {
      return;
    }

    this.isLoadingMore.set(true);
    const nextPage = this.currentPage() + 1;

    this.orderService
      .getOrdersPaged({
        searchTerm: this.filterForm.controls.searchTerm.value,
        page: nextPage,
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.currentPage.set(result.page);
          this.totalCount.set(result.totalCount);
          this.ordersCache.set([...this.ordersCache(), ...result.items]);
          this.applyFiltersToCache();
          this.isLoadingMore.set(false);
        },
        error: (err) => {
          this.alertService.error(err.message || this.alertService.getLoadErrorMessage('orders'));
          this.isLoadingMore.set(false);
        },
      });
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.resetAndLoadOrders();
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
      this.applyFiltersToCache();
      this.saveState();
      return;
    }

    this.selectedDateRanges.set([selected]);
    if (selected !== 'custom') {
      this.customStartDate.set('');
      this.customEndDate.set('');
    }
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onDateRangeFilterReset(): void {
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.applyFiltersToCache();
    this.saveState();
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
    this.applyFiltersToCache();
    this.saveState();
  }

  protected clearDateRangeSelections(): void {
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onCustomStartDateChanged(value: string): void {
    this.customStartDate.set(value);
    this.selectedDateRanges.set(['custom']);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onCustomEndDateChanged(value: string): void {
    this.customEndDate.set(value);
    this.selectedDateRanges.set(['custom']);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected clearCustomDateRange(): void {
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onStatusFilterChange(selectedIds: (string | number)[]): void {
    this.selectedStatuses.set(selectedIds as OrderStatusEnum[]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onStatusFilterReset(): void {
    this.selectedStatuses.set([]);
    this.applyFiltersToCache();
    this.saveState();
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
    this.applyFiltersToCache();
    this.saveState();
  }

  protected clearStatusSelections(): void {
    this.selectedStatuses.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected openMobileFilters(): void {
    this.isMobileFiltersOpen.set(true);
  }

  protected closeMobileFilters(): void {
    this.isMobileFiltersOpen.set(false);
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('desc');
    }
    this.applyFiltersToCache();
    this.saveState();
  }

  protected resetFilters(): void {
    this.filterForm.reset({
      searchTerm: '',
    });
    this.selectedStatuses.set([]);
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.applyFiltersToCache();
    this.saveState();
  }

  protected getStatusVariant(
    status: OrderStatusEnum,
  ): 'success' | 'error' | 'warning' | 'info' | 'default' {
    switch (status) {
      case OrderStatusEnum.Pending:
        return 'warning';
      case OrderStatusEnum.Completed:
        return 'success';
      case OrderStatusEnum.Cancelled:
        return 'default';
      case OrderStatusEnum.Refunded:
        return 'error';
      default:
        return 'info';
    }
  }

  protected getStatusLabel(status: OrderStatusEnum): string {
    switch (status) {
      case OrderStatusEnum.Pending:
        return 'Pending';
      case OrderStatusEnum.Completed:
        return 'Completed';
      case OrderStatusEnum.Cancelled:
        return 'Cancelled';
      case OrderStatusEnum.Refunded:
        return 'Refunded';
      default:
        return 'Unknown';
    }
  }

  protected getOrderDate(order: OrderDto): string {
    return order.createdAt || order.updatedAt || '';
  }

  protected getItemsText(order: OrderDto): string {
    const nonBundleCount = order.items
      .filter((item) => !item.bundlePromotionId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const bundleCount = (order.bundlePromotions ?? []).reduce((sum, bundle) => sum + bundle.quantity, 0);
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
      this.router.navigate(['/orders/editor', order.id]);
      return;
    }

    this.router.navigate(['/orders/details', order.id]);
  }

  protected editPendingOrder(localId: string): void {
    this.router.navigate(['/orders/editor'], { queryParams: { offline: localId } });
  }

  protected syncPendingOrders(): void {
    this.offlineOrderService.syncAll();
  }

  protected getPendingItemCount(cartSnapshot: CartItemDto[]): string {
    const count = cartSnapshot.reduce((sum, item) => sum + item.qty, 0);
    return count === 1 ? '1 item' : `${count} items`;
  }

  protected getPendingTotal(cartSnapshot: CartItemDto[]): number {
    return cartSnapshot.reduce((sum, item) => {
      const addOnTotal = (item.addOns ?? []).reduce((s, ao) => s + ao.price, 0);
      return sum + item.qty * (item.price + addOnTotal);
    }, 0);
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
    let items = [...this.ordersCache()];

    // Filter by status
    const selectedStatuses = this.selectedStatuses();
    if (selectedStatuses.length > 0) {
      items = items.filter((order) => selectedStatuses.includes(order.status));
    }

    // Filter by date range
    const selectedDateRange = this.selectedDateRanges()[0];
    if (selectedDateRange && selectedDateRange !== 'custom') {
      const now = new Date();
      const start = new Date(now);
      if (selectedDateRange === 'today') {
        start.setHours(0, 0, 0, 0);
        items = items.filter((order) => new Date(this.getOrderDate(order)) >= start);
      } else if (selectedDateRange === '7d') {
        start.setDate(now.getDate() - 7);
        items = items.filter((order) => new Date(this.getOrderDate(order)) >= start);
      } else if (selectedDateRange === '30d') {
        start.setDate(now.getDate() - 30);
        items = items.filter((order) => new Date(this.getOrderDate(order)) >= start);
      }
    }

    const customStartDate = this.customStartDate();
    const customEndDate = this.customEndDate();
    if (selectedDateRange === 'custom' && customStartDate && customEndDate) {
      const start = new Date(`${customStartDate}T00:00:00`);
      const end = new Date(`${customEndDate}T23:59:59.999`);
      items = items.filter((order) => {
        const orderDate = new Date(this.getOrderDate(order));
        return orderDate >= start && orderDate <= end;
      });
    }

    // Sort
    const sortColumn = this.sortColumn();
    const sortDirection = this.sortDirection();

    if (sortColumn === 'orderNumber') {
      items.sort((a, b) =>
        sortDirection === 'asc' ? a.orderNumber - b.orderNumber : b.orderNumber - a.orderNumber,
      );
    } else if (sortColumn === 'date') {
      items.sort((a, b) => {
        const dateA = new Date(this.getOrderDate(a) || 0).getTime();
        const dateB = new Date(this.getOrderDate(b) || 0).getTime();
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      });
    } else if (sortColumn === 'totalAmount') {
      items.sort((a, b) =>
        sortDirection === 'asc' ? a.totalAmount - b.totalAmount : b.totalAmount - a.totalAmount,
      );
    } else {
      // Default sort by date descending
      items.sort((a, b) => {
        const dateA = new Date(this.getOrderDate(a) || 0).getTime();
        const dateB = new Date(this.getOrderDate(b) || 0).getTime();
        return dateB - dateA;
      });
    }

    this.orders.set(items);
  }

  private restoreState(): void {
    const state = this.listState.load<OrderListState>(this.stateKey, {
      searchTerm: '',
      selectedStatuses: [],
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
      selectedDateRanges: this.selectedDateRanges(),
      customStartDate: this.customStartDate(),
      customEndDate: this.customEndDate(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    });
  }
}
