import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AlertService, AuthService, InventoryService } from '@core/services';
import { IconComponent, PullToRefreshComponent } from '@shared/components';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { formatPeso } from '@shared/calculations';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  ProductCoverageStatus,
  ProductIngredientsDto,
  ProductIngredientsRowDto,
} from '@shared/models';

type IngredientsFilter = 'attention' | 'low-margin' | 'all';

export const LOW_MARGIN_PERCENT = 30;

interface StatusStyle {
  label: string;
  bar: string;
  badge: string;
}

const STATUS_STYLES: Record<ProductCoverageStatus, StatusStyle> = {
  Covered: {
    label: 'Takes stock',
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  Partial: {
    label: 'Some options missing',
    bar: 'bg-orange-500',
    badge: 'bg-orange-100 text-orange-800',
  },
  Missing: { label: 'Takes no stock', bar: 'bg-red-500', badge: 'bg-red-100 text-red-800' },
};

@Component({
  selector: 'app-ingredients',
  imports: [RouterLink, IconComponent, PullToRefreshComponent, SearchInputComponent],
  templateUrl: './ingredients.html',
  host: { class: 'flex-1 min-h-0' },
})
export class IngredientsComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly alertService = inject(AlertService);

  protected readonly data = signal<ProductIngredientsDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly filter = signal<IngredientsFilter>('attention');
  protected readonly search = signal('');

  protected readonly total = computed(() => {
    const summary = this.data();
    return summary ? summary.ready + summary.partial + summary.missing : 0;
  });
  protected readonly attentionCount = computed(() => {
    const summary = this.data();
    return summary ? summary.partial + summary.missing : 0;
  });
  protected readonly showsCosts = computed(() => this.data()?.showsCosts ?? false);
  protected readonly lowMarginCount = computed(
    () => (this.data()?.products ?? []).filter((product) => this.isLowMargin(product)).length,
  );
  protected readonly readyPercent = computed(() => this.percentOf(this.data()?.ready ?? 0));
  protected readonly partialPercent = computed(() => this.percentOf(this.data()?.partial ?? 0));
  protected readonly missingPercent = computed(() => this.percentOf(this.data()?.missing ?? 0));

  protected readonly rows = computed<ProductIngredientsRowDto[]>(() => {
    const term = this.search().trim().toLowerCase();
    const filter = this.filter();
    return (this.data()?.products ?? [])
      .filter((product) => {
        if (filter === 'attention') {
          return product.status !== 'Covered';
        }

        return filter === 'low-margin' ? this.isLowMargin(product) : true;
      })
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
    this.inventoryService.getProductIngredients().subscribe({
      next: (data) => {
        this.data.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected setFilter(value: IngredientsFilter): void {
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

  protected isLowMargin(product: ProductIngredientsRowDto): boolean {
    return product.marginPercent !== null && product.marginPercent < LOW_MARGIN_PERCENT;
  }

  protected peso(amount: number): string {
    return formatPeso(amount);
  }

  protected productLink(product: ProductIngredientsRowDto): string | null {
    return AppRoutes.InventoryIngredientsEditById(product.productId);
  }

  protected linkLabel(): string {
    return this.authService.canWriteItems() ? 'Set up stock' : 'View ingredients';
  }

  private percentOf(count: number): number {
    const total = this.total();
    return total === 0 ? 0 : (count / total) * 100;
  }
}
