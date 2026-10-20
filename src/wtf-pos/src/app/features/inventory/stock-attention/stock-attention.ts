import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, StockAttentionService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';
import { StockAttentionItemDto, StockAttentionLevel } from '@shared/models';

type LevelFilter = 'all' | StockAttentionLevel;

interface LevelStyle {
  label: string;
  bar: string;
  tint: string;
  badge: string;
  fill: string;
}

const LEVEL_STYLES: Record<StockAttentionLevel, LevelStyle> = {
  OutOfStock: {
    label: 'Out',
    bar: 'bg-red-600',
    tint: 'bg-red-50',
    badge: 'bg-red-600 text-white',
    fill: 'bg-red-600',
  },
  Critical: {
    label: 'Critical',
    bar: 'bg-orange-500',
    tint: 'bg-orange-50',
    badge: 'bg-orange-500 text-white',
    fill: 'bg-orange-500',
  },
  Warning: {
    label: 'Low',
    bar: 'bg-amber-400',
    tint: 'bg-surface',
    badge: 'bg-amber-100 text-amber-800',
    fill: 'bg-amber-400',
  },
};

@Component({
  selector: 'app-stock-attention',
  imports: [RouterLink, IconComponent],
  templateUrl: './stock-attention.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockAttentionComponent implements OnInit, OnDestroy {
  private readonly attention = inject(StockAttentionService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly isLoading = signal(false);
  protected readonly filter = signal<LevelFilter>('all');
  protected readonly outCount = this.attention.outCount;
  protected readonly criticalCount = this.attention.criticalCount;
  protected readonly warningCount = this.attention.warningCount;
  protected readonly totalCount = this.attention.count;
  protected readonly hasLoaded = this.attention.hasLoaded;
  protected readonly stockInRoute = AppRoutes.InventoryStockIn;
  protected readonly visibleItems = computed(() => {
    const filter = this.filter();
    return this.attention.items().filter((item) => filter === 'all' || item.status === filter);
  });
  protected readonly summary = computed(() => {
    const parts: string[] = [];
    if (this.outCount() > 0) {
      parts.push(`${this.outCount()} out of stock`);
    }
    if (this.criticalCount() > 0) {
      parts.push(`${this.criticalCount()} critical`);
    }
    if (this.warningCount() > 0) {
      parts.push(`${this.warningCount()} running low`);
    }
    return parts.join(' · ');
  });

  public ngOnInit(): void {
    // The page listens for stock changes while it is open, so the list updates as sales happen.
    this.attention.start();
    this.isLoading.set(!this.attention.hasLoaded());
    this.attention.load().subscribe({
      next: () => this.isLoading.set(false),
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  public ngOnDestroy(): void {
    this.attention.stop();
  }

  protected setFilter(filter: LevelFilter): void {
    this.filter.set(this.filter() === filter ? 'all' : filter);
  }

  protected styleOf(item: StockAttentionItemDto): LevelStyle {
    return LEVEL_STYLES[item.status];
  }

  protected isNegative(item: StockAttentionItemDto): boolean {
    return item.currentQuantity < 0;
  }

  /** How full the shelf is compared with the warning level, for the small bar. Empty and below zero show no fill. */
  protected fillPercent(item: StockAttentionItemDto): number {
    const reference = item.warningQuantity ?? item.criticalQuantity ?? 0;
    if (reference <= 0 || item.currentQuantity <= 0) {
      return 0;
    }

    return Math.min(100, Math.max(4, Math.round((item.currentQuantity / reference) * 100)));
  }

  protected levelText(item: StockAttentionItemDto): string {
    const parts: string[] = [];
    if (item.warningQuantity !== null) {
      parts.push(`Low at ${this.format(item.warningQuantity)} ${item.unitName}`);
    }
    if (item.criticalQuantity !== null) {
      parts.push(`Critical at ${this.format(item.criticalQuantity)} ${item.unitName}`);
    }
    return parts.join(' · ');
  }

  protected coverText(item: StockAttentionItemDto): string {
    if (item.productCount === 0) {
      return 'No product uses this item';
    }

    const products = item.productCount === 1 ? '1 product' : `${item.productCount} products`;
    if (item.currentQuantity <= 0) {
      return `${products} cannot be made`;
    }

    return item.salesCovered === 1
      ? `Enough for 1 more sale · used by ${products}`
      : `Enough for ${item.salesCovered} more sales · used by ${products}`;
  }

  protected format(quantity: number): string {
    return Number(quantity.toFixed(3)).toLocaleString('en-US');
  }

  protected openItem(item: StockAttentionItemDto): void {
    void this.router.navigateByUrl(AppRoutes.InventoryItemDetailsById(item.id));
  }
}
