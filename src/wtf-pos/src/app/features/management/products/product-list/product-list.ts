import { HttpErrorMessages } from '@core/messages';
import { CommonModule } from '@angular/common';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { selectedFilterCount } from '@shared/utils/filter-count';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  AlertService,
  AuthService,
  BranchService,
  CatalogLookupService,
  ListStateService,
  ModalStackService,
  ProductAccessService,
  ProductService,
} from '@core/services';
import type { FilterOption } from '@shared/components';
import {
  AvatarComponent,
  BadgeComponent,
  IconComponent,
  ConnectionErrorComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  SideDrawerComponent,
} from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { ProductDto } from '@shared/models';
import { debounceTime, Subscription } from 'rxjs';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  isPageSizeOption,
} from '@shared/calculations/pagination';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';

type SortColumn = 'name' | 'price';
type SortDirection = 'asc' | 'desc';
interface ProductListState {
  searchTerm: string;
  selectedTypes: number[];
  selectedStatuses: string[];
  soldAt?: string;
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
  pageSize?: number;
}

@Component({
  selector: 'app-product-list',
  imports: [
    FilterButtonComponent,
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    ConfirmDialogComponent,
    AvatarComponent,
    ConnectionErrorComponent,
    PullToRefreshComponent,
    SearchInputComponent,
    SideDrawerComponent,
    PaginationComponent,
  ],
  templateUrl: './product-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ProductListComponent implements OnInit {
  private readonly stateKey = 'management:product-list';
  private readonly productService = inject(ProductService);
  private readonly lookups = inject(CatalogLookupService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly branchService = inject(BranchService);
  private readonly productAccess = inject(ProductAccessService);
  private readonly listState = inject(ListStateService);
  private readonly modalStack = inject(ModalStackService);
  protected readonly routes = AppRoutes;

  protected readonly products = signal<ProductDto[]>([]);
  protected readonly isReloading = signal(false);
  protected readonly page = signal(readPageParam(this.route));
  protected readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  protected readonly totalCount = signal(0);
  protected readonly facets = signal<Record<string, number>>({});
  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  private loadRequest: Subscription | null = null;
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isFiltersOpen = signal(false);

  protected readonly selectedTypes = signal<number[]>([]);
  protected readonly selectedStatuses = signal<string[]>(['active']);
  protected readonly soldAt = signal('');

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly sortColumn = signal<SortColumn | null>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly showDeleteModal = signal(false);
  protected readonly productToDelete = signal<ProductDto | null>(null);
  protected readonly isDeleting = signal(false);
  protected readonly showRestoreModal = signal(false);
  protected readonly productToRestore = signal<ProductDto | null>(null);
  protected readonly isRestoring = signal(false);
  private modalStackId: number | null = null;

  protected readonly categoryCounts = computed(() => {
    const counts: Record<number, number> = {};
    for (const [key, value] of Object.entries(this.facets())) {
      if (key.startsWith('category:')) {
        counts[Number(key.slice(9))] = value;
      }
    }

    return counts;
  });

  protected readonly statusCounts = computed(() => ({
    active: this.facets()['active'] ?? 0,
    inactive: this.facets()['inactive'] ?? 0,
  }));

  protected readonly typeOptions = computed<FilterOption[]>(() =>
    this.lookups.categories().map((category) => ({
      id: category.id,
      label: category.name,
      count: this.categoryCounts()[category.id] ?? 0,
    })),
  );

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'active', label: 'Active', count: this.statusCounts().active },
    { id: 'inactive', label: 'Inactive', count: this.statusCounts().inactive },
  ]);

  protected readonly showSoldAtFilter = computed(() => this.branchService.isMultiBranch());

  protected readonly soldAtOptions = computed<FilterOption[]>(() => [
    ...this.branchService
      .branches()
      .filter((branch) => branch.isActive)
      .map((branch) => ({
        id: branch.id,
        label: `Sold at ${branch.name}`,
        count: this.facets()[`soldat:${branch.id}`] ?? 0,
      })),
    { id: 'limited', label: 'Limited to some branches', count: this.facets()['soldat:limited'] ?? 0 },
  ]);

  public ngOnInit(): void {
    void this.lookups.ensureLoaded();
    this.restoreState();
    this.loadProducts();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.reloadFromFirstPage();
      this.saveState();
    });
  }

  protected loadProducts(): void {
    const firstLoad = this.products().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.connectionFailed.set(false);
    this.loadRequest?.unsubscribe();

    this.loadRequest = this.productService
      .getProductsPaged({
        searchTerm: this.filterForm.controls.searchTerm.value,
        isActive: this.activeFilter(),
        categories: this.selectedTypes(),
        soldAtBranchId: this.soldAt() && this.soldAt() !== 'limited' ? this.soldAt() : null,
        limitedOnly: this.soldAt() === 'limited',
        sortBy: this.sortColumn() ?? undefined,
        sortDirection: this.sortDirection(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.products.set(result.items);
          this.totalCount.set(result.totalCount);
          this.facets.set(result.facets ?? {});
          if (result.page !== this.page()) {
            this.page.set(result.page);
            writePageParam(this.router, this.route, result.page);
          }
          this.isLoading.set(false);
          this.isReloading.set(false);
          this.isRefreshing.set(false);
        },
        error: (err) => {
          this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
          this.alertService.error(err.message);
          this.isLoading.set(false);
          this.isReloading.set(false);
          this.isRefreshing.set(false);
        },
      });
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    writePageParam(this.router, this.route, page);
    this.loadProducts();
  }

  protected changePageSize(size: number): void {
    this.pageSize.set(size);
    this.saveState();
    this.reloadFromFirstPage();
  }

  private reloadFromFirstPage(): void {
    this.page.set(1);
    writePageParam(this.router, this.route, 1);
    this.loadProducts();
  }

  // Both or neither status ticked means every product.
  private activeFilter(): boolean | undefined {
    const chosen = this.selectedStatuses();
    return chosen.length === 1 ? chosen[0] === 'active' : undefined;
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadProducts();
  }

  /** How many filters are applied, shown on the Filters button. */
  protected readonly activeFilterCount = computed(
    () =>
      selectedFilterCount(this.selectedTypes().length, this.typeOptions().length) +
      selectedFilterCount(this.selectedStatuses().length, this.statusOptions().length) +
      (this.soldAt() ? 1 : 0),
  );

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected navigateToEditor(productId?: string): void {
    if (!this.canAddProducts()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (productId) {
      this.router.navigateByUrl(AppRoutes.ManagementProductEditById(productId));
    } else {
      this.router.navigateByUrl(AppRoutes.ManagementProductsNew);
    }
  }

  protected navigateToDetails(productId: string): void {
    this.router.navigateByUrl(AppRoutes.ManagementProductDetailsById(productId));
  }

  protected deleteProduct(product: ProductDto): void {
    if (!this.canAddProducts()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.productToDelete.set(product);
    this.showDeleteModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDelete());
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.productToDelete.set(null);
    this.removeFromStack();
  }

  protected restoreProduct(product: ProductDto): void {
    if (!this.canAddProducts()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.productToRestore.set(product);
    this.showRestoreModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelRestore());
  }

  protected cancelRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    this.showRestoreModal.set(false);
    this.productToRestore.set(null);
    this.removeFromStack();
  }

  protected confirmRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    if (!this.canAddProducts()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const product = this.productToRestore();
    if (!product) {
      return;
    }

    this.isRestoring.set(true);
    this.productService.restoreProduct(product.id).subscribe({
      next: () => {
        this.isRestoring.set(false);
        this.showRestoreModal.set(false);
        this.productToRestore.set(null);
        this.removeFromStack();
        this.alertService.successRestored('Product');
        this.loadProducts();
      },
      error: (err) => {
        this.isRestoring.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canAddProducts()) {
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
        this.removeFromStack();
        this.loadProducts();
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  protected getProductCategoryName(category: number): string {
    return this.lookups.categoryName(category);
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
    this.reloadFromFirstPage();
  }

  protected onTypeFilterChange(selectedIds: (string | number)[]): void {
    this.selectedTypes.set(selectedIds as number[]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected onTypeFilterReset(): void {
    this.selectedTypes.set([]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected onStatusFilterChange(selectedIds: (string | number)[]): void {
    this.selectedStatuses.set(selectedIds as string[]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected onStatusFilterReset(): void {
    this.selectedStatuses.set([]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected isTypeSelected(typeId: number): boolean {
    return this.selectedTypes().includes(typeId);
  }

  protected toggleTypeSelection(typeId: number): void {
    const current = this.selectedTypes();
    const hasType = current.includes(typeId);
    const next = hasType ? current.filter((id) => id !== typeId) : [...current, typeId];

    this.selectedTypes.set(next);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected clearTypeSelections(): void {
    this.selectedTypes.set([]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected isStatusSelected(statusId: string): boolean {
    return this.selectedStatuses().includes(statusId);
  }

  protected toggleStatusSelection(statusId: string): void {
    const current = this.selectedStatuses();
    const hasStatus = current.includes(statusId);
    const next = hasStatus ? current.filter((id) => id !== statusId) : [...current, statusId];

    this.selectedStatuses.set(next);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected clearStatusSelections(): void {
    this.selectedStatuses.set([]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected canWriteProducts(): boolean {
    return this.authService.canWriteProducts();
  }

  protected canAddProducts(): boolean {
    return this.productAccess.canAdd();
  }

  protected canChangeProduct(product: ProductDto): boolean {
    return this.productAccess.canChange(product);
  }

  protected selectSoldAt(id: string): void {
    this.soldAt.set(this.soldAt() === id ? '' : id);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected clearSoldAt(): void {
    this.selectSoldAt('');
  }

  protected soldAtLabel(product: ProductDto): string | null {
    const ids = product.soldAtBranchIds;
    if (!ids || ids.length === 0) {
      return null;
    }

    if (ids.length === 1) {
      const branch = this.branchService.branches().find((b) => b.id === ids[0]);
      return branch ? `Only ${branch.name}` : '1 branch';
    }

    return `${ids.length} branches`;
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
    this.soldAt.set(state.soldAt ?? '');
    this.pageSize.set(isPageSizeOption(state.pageSize) ? (state.pageSize as number) : DEFAULT_PAGE_SIZE);
    this.sortColumn.set(state.sortColumn);
    this.sortDirection.set(state.sortDirection);
  }

  private saveState(): void {
    this.listState.save<ProductListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedTypes: this.selectedTypes(),
      selectedStatuses: this.selectedStatuses(),
      soldAt: this.soldAt(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
      pageSize: this.pageSize(),
    });
  }
}
