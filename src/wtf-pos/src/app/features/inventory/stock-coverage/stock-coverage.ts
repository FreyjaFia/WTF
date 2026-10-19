import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertService, AuthService, InventoryService } from '@core/services';
import { BadgeComponent } from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';
import { ProductCoverageDto, ProductCoverageStatus, StockCoverageDto } from '@shared/models';

type CoverageFilter = 'attention' | 'all';

@Component({
  selector: 'app-stock-coverage',
  imports: [RouterLink, BadgeComponent],
  templateUrl: './stock-coverage.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockCoverageComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly alertService = inject(AlertService);

  protected readonly coverage = signal<StockCoverageDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly filter = signal<CoverageFilter>('attention');

  protected readonly rows = computed<ProductCoverageDto[]>(() => {
    const products = this.coverage()?.products ?? [];
    return this.filter() === 'all'
      ? products
      : products.filter((product) => product.status !== 'Covered');
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

  protected setFilter(value: string): void {
    this.filter.set(value === 'all' ? 'all' : 'attention');
  }

  protected badgeVariant(status: ProductCoverageStatus): 'success' | 'warning' | 'error' {
    switch (status) {
      case 'Covered':
        return 'success';
      case 'Partial':
        return 'warning';
      default:
        return 'error';
    }
  }

  protected statusLabel(status: ProductCoverageStatus): string {
    switch (status) {
      case 'Covered':
        return 'Takes stock';
      case 'Partial':
        return 'Some options missing';
      default:
        return 'Takes no stock';
    }
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
}
