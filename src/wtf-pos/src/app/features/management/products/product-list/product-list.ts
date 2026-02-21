import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, ListStateService, ProductService } from '@core/services';
import type { FilterOption } from '@shared/components';
import { AvatarComponent, BadgeComponent, FilterDropdown, Icon } from '@shared/components';
import { ProductCategoryEnum, ProductDto } from '@shared/models';
import { debounceTime } from 'rxjs';


type SortColumn = 'name' | 'price';
type SortDirection = 'asc' | 'desc';
interface ProductListState {
  searchTerm: string;
  selectedTypes: number[];
  selectedStatuses: string[];
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
}

@Component({
  selector: 'app-product-list',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    Icon,
    FilterDropdown,
    BadgeComponent,
    AvatarComponent,
  ],
  templateUrl: './product-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ProductListComponent implements OnInit {
  private readonly stateKey = 'management:product-list';
  private readonly productService = inject(ProductService);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly listState = inject(ListStateService);

  protected readonly products = signal<ProductDto[]>([]);
  protected readonly productsCache = signal<ProductDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly ProductCategoryEnum = ProductCategoryEnum;

  protected readonly selectedTypes = signal<number[]>([]);
  protected readonly selectedStatuses = signal<string[]>(['active']);

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly sortColumn = signal<SortColumn | null>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly showDeleteModal = signal(false);
  protected readonly productToDelete = signal<ProductDto | null>(null);
  protected readonly isDeleting = signal(false);

  protected readonly categoryCounts = computed(() => {
    const cache = this.productsCache();
    return {
      [ProductCategoryEnum.Drink]: cache.filter((p) => p.category === ProductCategoryEnum.Drink)
        .length,
      [ProductCategoryEnum.Food]: cache.filter((p) => p.category === ProductCategoryEnum.Food)
        .length,
      [ProductCategoryEnum.Dessert]: cache.filter((p) => p.category === ProductCategoryEnum.Dessert)
        .length,
      [ProductCategoryEnum.Other]: cache.filter((p) => p.category === ProductCategoryEnum.Other)
        .length,
    };
  });

  protected readonly statusCounts = computed(() => {
    const cache = this.productsCache();
    return {
      active: cache.filter((p) => p.isActive).length,
      inactive: cache.filter((p) => !p.isActive).length,
    };
  });

  protected readonly typeOptions = computed<FilterOption[]>(() => [
    {
      id: ProductCategoryEnum.Drink,
      label: 'Drink',
      count: this.categoryCounts()[ProductCategoryEnum.Drink],
    },
    {
      id: ProductCategoryEnum.Food,
      label: 'Food',
      count: this.categoryCounts()[ProductCategoryEnum.Food],
    },
    {
      id: ProductCategoryEnum.Dessert,
      label: 'Dessert',
      count: this.categoryCounts()[ProductCategoryEnum.Dessert],
    },
    {
      id: ProductCategoryEnum.Other,
      label: 'Other',
      count: this.categoryCounts()[ProductCategoryEnum.Other],
    },
  ]);

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'active', label: 'Active', count: this.statusCounts().active },
    { id: 'inactive', label: 'Inactive', count: this.statusCounts().inactive },
  ]);

  protected readonly sortedProducts = computed(() => {
    const products = [...this.products()];

    if (this.sortColumn() === 'name') {
      products.sort((a, b) => {
        const comparison = a.name.localeCompare(b.name);
        return this.sortDirection() === 'asc' ? comparison : -comparison;
      });
    } else if (this.sortColumn() === 'price') {
      products.sort((a, b) => {
        const comparison = a.price - b.price;
        return this.sortDirection() === 'asc' ? comparison : -comparison;
      });
    }

    return products;
  });

  public ngOnInit(): void {
    this.restoreState();
    this.loadProducts();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.applyFiltersToCache();
      this.saveState();
    });
  }

  protected loadProducts(): void {
    this.isLoading.set(true);

    this.productService.getProducts().subscribe({
      next: (data) => {
        this.productsCache.set(data);
        this.applyFiltersToCache();
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadProducts();
  }

  private applyFiltersToCache(): void {
    const { searchTerm } = this.filterForm.value;
    let items = [...this.productsCache()];

    if (searchTerm && searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().includes(lowerSearch));
    }

    const selectedTypes = this.selectedTypes();
    if (selectedTypes.length > 0) {
      items = items.filter((p) => selectedTypes.includes(p.category));
    }

    const selectedStatuses = this.selectedStatuses();
    if (selectedStatuses.length > 0) {
      items = items.filter((p) => {
        if (selectedStatuses.includes('active') && p.isActive) return true;
        if (selectedStatuses.includes('inactive') && !p.isActive) return true;
        return false;
      });
    }

    this.products.set(items);
  }

  protected navigateToEditor(productId?: string): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (productId) {
      this.router.navigate(['/management/products/edit', productId]);
    } else {
      this.router.navigate(['/management/products/new']);
    }
  }

  protected navigateToDetails(productId: string): void {
    this.router.navigate(['/management/products/details', productId]);
  }

  protected deleteProduct(product: ProductDto): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.productToDelete.set(product);
    this.showDeleteModal.set(true);
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.productToDelete.set(null);
  }

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const product = this.productToDelete();

    if (!product) {
      return;
    }

    this.isDeleting.set(true);

    this.productService.deleteProduct(product.id).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.productToDelete.set(null);
        this.loadProducts();
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected getProductCategoryName(category: ProductCategoryEnum): string {
    return ProductCategoryEnum[category];
  }

  protected getAssociationLabel(product: ProductDto): string {
    const count = product.addOnCount ?? 0;

    if (product.isAddOn) {
      return `${count} ${count === 1 ? 'linked item' : 'linked items'}`;
    }

    return `${count} ${count === 1 ? 'associated add-on' : 'associated add-ons'}`;
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }

    this.saveState();
  }

  protected onTypeFilterChange(selectedIds: (string | number)[]): void {
    this.selectedTypes.set(selectedIds as number[]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onTypeFilterReset(): void {
    this.selectedTypes.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onStatusFilterChange(selectedIds: (string | number)[]): void {
    this.selectedStatuses.set(selectedIds as string[]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onStatusFilterReset(): void {
    this.selectedStatuses.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }

  private restoreState(): void {
    const state = this.listState.load<ProductListState>(this.stateKey, {
      searchTerm: '',
      selectedTypes: [],
      selectedStatuses: ['active'],
      sortColumn: 'name',
      sortDirection: 'asc',
    });

    this.filterForm.patchValue(
      {
        searchTerm: state.searchTerm,
      },
      { emitEvent: false },
    );
    this.selectedTypes.set(state.selectedTypes);
    this.selectedStatuses.set(state.selectedStatuses);
    this.sortColumn.set(state.sortColumn);
    this.sortDirection.set(state.sortDirection);
  }

  private saveState(): void {
    this.listState.save<ProductListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedTypes: this.selectedTypes(),
      selectedStatuses: this.selectedStatuses(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    });
  }
}

