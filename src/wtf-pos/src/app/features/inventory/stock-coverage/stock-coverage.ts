import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AlertService, AuthService, InventoryService } from '@core/services';
import { IconComponent, PullToRefreshComponent } from '@shared/components';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { AppRoutes } from '@shared/constants/app-routes';
import { ProductCoverageDto, ProductCoverageStatus, StockCoverageDto } from '@shared/models';

type CoverageFilter = 'attention' | 'all';

interface StatusStyle {
  label: string;
  bar: string;
  badge: string;
}

const STATUS_STYLES: Record<ProductCoverageStatus, StatusStyle> = {
  Covered: { label: 'Takes stock', bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-800' },
  Partial: { label: 'Some options missing', bar: 'bg-orange-500', badge: 'bg-orange-100 text-orange-800' },
  Missing: { label: 'Takes no stock', bar: 'bg-red-500', badge: 'bg-red-100 text-red-800' },
};

@Component({
  selector: 'app-stock-coverage',
  imports: [RouterLink, IconComponent, PullToRefreshComponent, SearchInputComponent],
  templateUrl: './stock-coverage.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockCoverageComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly alertService = inject(AlertService);

  protected readonly coverage = signal<StockCoverageDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly filter = signal<CoverageFilter>('attention');
  protected readonly search = signal('');

  protected readonly total = computed(() => {
    const summary = this.coverage();
    return summary ? summary.covered + summary.partial + summary.missing : 0;
  });
  protected readonly attentionCount = computed(() => {
    const summary = this.coverage();
    return summary ? summary.partial + summary.missing : 0;
  });
  protected readonly coveredPercent = computed(() => this.percentOf(this.coverage()?.covered ?? 0));
  protected readonly partialPercent = computed(() => this.percentOf(this.coverage()?.partial ?? 0));
  protected readonly missingPercent = computed(() => this.percentOf(this.coverage()?.missing ?? 0));

  protected readonly rows = computed<ProductCoverageDto[]>(() => {
    const term = this.search().trim().toLowerCase();
    return (this.coverage()?.products ?? [])
      .filter((product) => this.filter() === 'all' || product.status !== 'Covered')
      .filter(
        (product) =>
          !term ||
          product.name.toLowerCase().includes(term) ||
          product.code.toLowerCase().includes(term),
      );
  });

  public ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);
    this.inventoryService.getStockCoverage().subscribe({
      next: (coverage) => {
        this.coverage.set(coverage);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected setFilter(value: CoverageFilter): void {
    this.filter.set(value);
  }

  protected setSearch(value: string): void {
    this.search.set(value);
  }

  protected styleOf(status: ProductCoverageStatus): StatusStyle {
    return STATUS_STYLES[status];
  }

  protected statusLabel(status: ProductCoverageStatus): string {
    return STATUS_STYLES[status].label;
  }

  protected productLink(product: ProductCoverageDto): string | null {
    if (this.authService.canWriteProducts()) {
      return AppRoutes.ManagementProductEditById(product.productId);
    }

    return this.authService.canReadProducts()
      ? AppRoutes.ManagementProductDetailsById(product.productId)
      : null;
  }

  protected linkLabel(): string {
    return this.authService.canWriteProducts() ? 'Set up stock' : 'View product';
  }

  private percentOf(count: number): number {
    const total = this.total();
    return total === 0 ? 0 : (count / total) * 100;
  }
}
