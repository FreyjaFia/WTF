import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { BadgeComponent } from '@shared/components/badge/badge';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { SideDrawerComponent } from '@shared/components/side-drawer/side-drawer';
import { selectedFilterCount } from '@shared/utils/filter-count';
import { PublicOrderDto, PublicOrderStatusKind } from '@shared/models';
import { publicStatusVariant } from '../public-order-status';

export type PublicOrdersState = 'idle' | 'loading' | 'ready' | 'error';

type DateRange = 'all' | 'today' | '7d' | '30d';
type SortColumn = 'orderNumber' | 'date' | 'total';
type SortDirection = 'asc' | 'desc';

const DATE_RANGES: { id: DateRange; label: string; days: number | null }[] = [
  { id: 'all', label: 'All time', days: null },
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
];

const STATUS_FILTERS: { kind: PublicOrderStatusKind; label: string }[] = [
  { kind: 'waiting', label: 'Waiting for confirmation' },
  { kind: 'accepted', label: 'Accepted' },
  { kind: 'ready', label: 'Ready' },
  { kind: 'completed', label: 'Completed' },
  { kind: 'rejected', label: 'Rejected' },
  { kind: 'cancelled', label: 'Cancelled' },
  { kind: 'refunded', label: 'Refunded' },
];

/**
 * The customer's list of orders on the public page, in the same look as the order list the shop staff use. It only
 * shows what it is given; the page owns loading and which order is open.
 */
@Component({
  selector: 'app-public-orders',
  imports: [
    BadgeComponent,
    DatePipe,
    DecimalPipe,
    FilterButtonComponent,
    IconComponent,
    SearchInputComponent,
    SideDrawerComponent,
  ],
  templateUrl: './public-orders.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class PublicOrdersComponent {
  public readonly orders = input.required<PublicOrderDto[]>();
  public readonly state = input<PublicOrdersState>('idle');
  public readonly errorMessage = input('');

  public readonly refresh = output<void>();
  public readonly opened = output<string>();
  /** The customer wants to order again: the page shows the menu. */
  public readonly newOrder = output<void>();

  /** Unread messages from the shop, by order id, for the small badge on a row. */

  /** What the customer typed: matches the order number. */
  protected readonly search = signal('');
  /** Newest first, like the shop's own order list. */
  protected readonly sortColumn = signal<SortColumn>('date');
  protected readonly sortDirection = signal<SortDirection>('desc');
  protected readonly isFiltersOpen = signal(false);
  protected readonly selectedStatuses = signal<PublicOrderStatusKind[]>([]);
  protected readonly dateRange = signal<DateRange>('all');

  protected readonly statusOptions = computed(() =>
    STATUS_FILTERS.map((option) => ({
      ...option,
      count: this.orders().filter((order) => order.statusKind === option.kind).length,
    })),
  );

  protected readonly dateRanges = DATE_RANGES;

  protected readonly filterCount = computed(
    () =>
      selectedFilterCount(this.selectedStatuses().length, STATUS_FILTERS.length) +
      (this.dateRange() === 'all' ? 0 : 1),
  );

  /** The orders that pass the filters; empty filters pass everything. */
  protected readonly visibleOrders = computed(() => {
    const statuses = this.selectedStatuses();
    const days = DATE_RANGES.find((range) => range.id === this.dateRange())?.days ?? null;
    const since = days === null ? null : this.startOfDay(days - 1);

    const term = this.search().trim().replace(/^#/, '');

    const matching = this.orders().filter(
      (order) =>
        (term === '' || String(order.orderNumber).includes(term)) &&
        (statuses.length === 0 || statuses.includes(order.statusKind)) &&
        (since === null || new Date(order.createdAt) >= since),
    );

    const column = this.sortColumn();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const key = (order: PublicOrderDto): number =>
      column === 'orderNumber'
        ? order.orderNumber
        : column === 'total'
          ? order.total
          : new Date(order.createdAt).getTime();

    return [...matching].sort((a, b) => (key(a) - key(b)) * direction);
  });

  protected readonly byDate = computed(() => {
    const groups = new Map<string, PublicOrderDto[]>();

    for (const order of this.visibleOrders()) {
      const key = new Date(order.createdAt).toDateString();
      groups.set(key, [...(groups.get(key) ?? []), order]);
    }

    return [...groups.entries()].map(([date, orders]) => ({
      date,
      label: this.dayLabel(new Date(orders[0].createdAt)),
      orders,
    }));
  });

  protected isSortActive(column: SortColumn): boolean {
    return this.sortColumn() === column;
  }

  /** The same column again flips the direction; another column starts with the biggest or newest first. */
  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('desc');
    }
  }

  protected toggleStatus(kind: PublicOrderStatusKind): void {
    this.selectedStatuses.update((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );
  }

  protected clearStatuses(): void {
    this.selectedStatuses.set([]);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.selectedStatuses.set([]);
    this.dateRange.set('all');
  }

  private startOfDay(daysBack: number): Date {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - daysBack);
    return day;
  }

  /** Same labels as the shop's own order list: Today, Yesterday, then e.g. "Monday, Jan 20". */
  private dayLabel(day: Date): string {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (day.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (day.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  protected readonly variant = publicStatusVariant;

  protected itemsText(order: PublicOrderDto): string {
    const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
    return `${count} ${count === 1 ? 'item' : 'items'}`;
  }
}
