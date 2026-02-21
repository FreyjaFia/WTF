import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertService, ListStateService, OrderService } from '@core/services';
import { BadgeComponent, FilterDropdown, Icon, type FilterOption } from '@shared/components';
import { OrderDto, OrderStatusEnum } from '@shared/models';
import { debounceTime } from 'rxjs';

type SortColumn = 'orderNumber' | 'date' | 'totalAmount';
type SortDirection = 'asc' | 'desc';
interface OrderListState {
  searchTerm: string;
  selectedStatuses: OrderStatusEnum[];
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
}

interface OrderGroup {
  label: string;
  orders: OrderDto[];
}

@Component({
  selector: 'app-order-list',
  imports: [CommonModule, DatePipe, ReactiveFormsModule, Icon, FilterDropdown, BadgeComponent],
  templateUrl: './order-list.html',
})
export class OrderList implements OnInit {
  private readonly stateKey = 'orders:order-list';
  private readonly orderService = inject(OrderService);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);
  private readonly listState = inject(ListStateService);

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly orders = signal<OrderDto[]>([]);
  protected readonly ordersCache = signal<OrderDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly OrderStatusEnum = OrderStatusEnum;
  protected readonly sortColumn = signal<SortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('desc');
  protected readonly selectedStatuses = signal<OrderStatusEnum[]>([]);

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

  public ngOnInit(): void {
    this.restoreState();
    this.loadOrders();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.applyFiltersToCache();
      this.saveState();
    });
  }

  protected loadOrders(): void {
    this.isLoading.set(true);

    this.orderService.getOrders().subscribe({
      next: (result) => {
        this.ordersCache.set(result);
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

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadOrders();
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
    this.applyFiltersToCache();
    this.saveState();
  }

  protected getStatusVariant(status: OrderStatusEnum): 'success' | 'error' | 'warning' | 'info' | 'default' {
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
    return order.updatedAt || order.createdAt;
  }

  protected getItemsText(order: OrderDto): string {
    const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
    return count === 1 ? '1 item' : `${count} items`;
  }

  private getDateGroupLabel(order: OrderDto): string {
    const orderDate = new Date(order.updatedAt || order.createdAt);
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

  protected editOrder(order: OrderDto): void {
    this.router.navigate(['/orders/editor', order.id]);
  }

  protected isSortActive(column: SortColumn): boolean {
    return this.sortColumn() === column;
  }

  protected stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  private applyFiltersToCache(): void {
    const { searchTerm } = this.filterForm.value;

    let items = [...this.ordersCache()];

    // Filter by search term
    if (searchTerm && searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      items = items.filter(
        (order) =>
          order.orderNumber.toString().includes(lowerSearch) ||
          order.id.toLowerCase().includes(lowerSearch),
      );
    }

    // Filter by status
    const selectedStatuses = this.selectedStatuses();
    if (selectedStatuses.length > 0) {
      items = items.filter((order) => selectedStatuses.includes(order.status));
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
        const dateA = new Date(a.updatedAt || a.createdAt).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt).getTime();
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      });
    } else if (sortColumn === 'totalAmount') {
      items.sort((a, b) =>
        sortDirection === 'asc' ? a.totalAmount - b.totalAmount : b.totalAmount - a.totalAmount,
      );
    } else {
      // Default sort by date descending
      items.sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt).getTime();
        return dateB - dateA;
      });
    }

    this.orders.set(items);
  }

  private restoreState(): void {
    const state = this.listState.load<OrderListState>(this.stateKey, {
      searchTerm: '',
      selectedStatuses: [],
      sortColumn: null,
      sortDirection: 'desc',
    });

    this.filterForm.patchValue(
      {
        searchTerm: state.searchTerm,
      },
      { emitEvent: false },
    );
    this.selectedStatuses.set(state.selectedStatuses);
    this.sortColumn.set(state.sortColumn);
    this.sortDirection.set(state.sortDirection);
  }

  private saveState(): void {
    this.listState.save<OrderListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedStatuses: this.selectedStatuses(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    });
  }
}

