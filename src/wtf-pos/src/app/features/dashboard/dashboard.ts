import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardService, SignalRService } from '@core/services';
import {
  AnimatedCounterComponent,
  AreaChartComponent,
  type AreaChartPoint,
  BadgeComponent,
  type BadgeVariant,
  DonutChartComponent,
  type DonutSegment,
  Icon,
  SparklineComponent,
} from '@shared/components';
import { DashboardDto } from '@shared/models';
import { Subscription, interval } from 'rxjs';

const TIME_AGO_INTERVAL_MS = 30_000;

const GREETINGS = [
  "What's the Forecast?",
  'Current Chaos',
  "Today's Brew",
  'The Daily Grind',
  'Fresh Numbers',
];

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, DecimalPipe, RouterLink, Icon, BadgeComponent, SparklineComponent, AreaChartComponent, DonutChartComponent, AnimatedCounterComponent],
  templateUrl: './dashboard.html',
})
export class Dashboard implements OnInit, OnDestroy {
  private readonly dashboardService = inject(DashboardService);
  private readonly signalRService = inject(SignalRService);

  private hubSub: Subscription | null = null;
  private timeAgoSub: Subscription | null = null;

  protected readonly dashboard = signal<DashboardDto | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly orderTimeAgos = signal<Record<string, string>>({});

  protected readonly greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];

  protected readonly revenueSparkline = computed(() =>
    this.dashboard()?.hourlyRevenue?.map((h) => h.revenue) ?? [],
  );

  protected readonly ordersSparkline = computed(() =>
    this.dashboard()?.hourlyRevenue?.map((h) => h.orders) ?? [],
  );

  protected readonly avgOrderSparkline = computed(() => {
    const data = this.dashboard()?.hourlyRevenue;

    if (!data) {
      return [];
    }

    return data.map((h) => (h.orders > 0 ? h.revenue / h.orders : 0));
  });

  protected readonly tipsSparkline = computed(() =>
    this.dashboard()?.hourlyRevenue?.map((h) => h.tips) ?? [],
  );

  protected readonly revenueChangePercent = computed(() =>
    this.calcChangePercent(
      this.dashboard()?.today?.totalRevenue ?? 0,
      this.dashboard()?.today?.yesterdayTotalRevenue ?? 0,
    ),
  );

  protected readonly ordersChangePercent = computed(() =>
    this.calcChangePercent(
      this.dashboard()?.today?.totalOrders ?? 0,
      this.dashboard()?.today?.yesterdayTotalOrders ?? 0,
    ),
  );

  protected readonly avgOrderChangeDelta = computed(() => {
    const today = this.dashboard()?.today?.averageOrderValue ?? 0;
    const yesterday = this.dashboard()?.today?.yesterdayAverageOrderValue ?? 0;
    return today - yesterday;
  });

  protected readonly tipsChangePercent = computed(() =>
    this.calcChangePercent(
      this.dashboard()?.today?.totalTips ?? 0,
      this.dashboard()?.today?.yesterdayTotalTips ?? 0,
    ),
  );

  protected readonly salesByHour = computed<AreaChartPoint[]>(() => {
    const data = this.dashboard()?.hourlyRevenue;

    if (!data) {
      return [];
    }

    return data
      .filter((h) => h.hour >= 8)
      .map((h) => ({
        label: h.hour === 0 ? '12am' : h.hour < 12 ? `${h.hour}am` : h.hour === 12 ? '12pm' : `${h.hour - 12}pm`,
        value: h.revenue,
      }));
  });

  protected readonly paymentDonutSegments = computed<DonutSegment[]>(() => {
    const methods = this.dashboard()?.paymentMethods;

    if (!methods || methods.length === 0) {
      return [];
    }

    const colors = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#6b7280'];
    return methods.map((m, i) => ({
      label: m.name,
      value: m.total,
      color: colors[i % colors.length],
    }));
  });

  protected readonly topProductTotalRevenue = computed(() => {
    const products = this.dashboard()?.topSellingProducts;

    if (!products || products.length === 0) {
      return 0;
    }

    return products.reduce((sum, p) => sum + p.revenue, 0);
  });

  protected readonly statusTotal = computed(() => {
    const s = this.dashboard()?.ordersByStatus;

    if (!s) {
      return 0;
    }

    return s.pending + s.completed + s.cancelled + s.refunded;
  });

  public ngOnInit(): void {
    this.loadDashboard();

    // Connect to SignalR hub for real-time updates
    this.signalRService.startDashboardHub();
    this.hubSub = this.signalRService.dashboardUpdated.subscribe(() => {
      this.silentRefresh();
    });

    // Refresh relative timestamps periodically
    this.timeAgoSub = interval(TIME_AGO_INTERVAL_MS).subscribe(() => {
      this.updateTimeAgos();
    });
  }

  public ngOnDestroy(): void {
    this.hubSub?.unsubscribe();
    this.timeAgoSub?.unsubscribe();
    this.signalRService.stopDashboardHub();
  }

  protected refreshDashboard(): void {
    this.loadDashboard();
  }

  protected getStatusVariant(statusId: number): BadgeVariant {
    switch (statusId) {
      case 1:
        return 'warning';
      case 2:
        return 'success';
      case 3:
        return 'default';
      case 4:
        return 'error';
      default:
        return 'info';
    }
  }

  private computeTimeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffSec = Math.floor((now - then) / 1000);

    if (diffSec < 60) {
      return 'just now';
    }

    const diffMin = Math.floor(diffSec / 60);

    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }

    const diffHr = Math.floor(diffMin / 60);

    if (diffHr < 24) {
      return `${diffHr}h ago`;
    }

    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  }

  private updateTimeAgos(): void {
    const d = this.dashboard();

    if (!d?.recentOrders) {
      this.orderTimeAgos.set({});
      return;
    }

    const map: Record<string, string> = {};

    for (const order of d.recentOrders) {
      map[order.id] = this.computeTimeAgo(order.createdAt);
    }

    this.orderTimeAgos.set(map);
  }

  private loadDashboard(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.dashboardService.getDashboard().subscribe({
      next: (data) => {
        this.dashboard.set(data);
        this.isLoading.set(false);
        this.updateTimeAgos();
      },
      error: (err: Error) => {
        this.errorMessage.set(err.message);
        this.isLoading.set(false);
      },
    });
  }

  private silentRefresh(): void {
    this.dashboardService.getDashboard().subscribe({
      next: (data) => {
        this.dashboard.set(data);
        this.errorMessage.set(null);
        this.updateTimeAgos();
      },
      error: () => {
        // Swallow silent refresh errors — stale data is better than a spinner.
      },
    });
  }

  private calcChangePercent(today: number, yesterday: number): number {
    if (yesterday === 0) {
      return today > 0 ? 100 : 0;
    }

    return Math.round(((today - yesterday) / yesterday) * 100);
  }

  protected productRevenuePercent(revenue: number): number {
    const total = this.dashboard()?.today?.totalRevenue ?? 0;
    return total > 0 ? Math.round((revenue / total) * 100) : 0;
  }

  protected statusPercent(count: number): number {
    const total = this.statusTotal();
    return total > 0 ? (count / total) * 100 : 0;
  }
}
