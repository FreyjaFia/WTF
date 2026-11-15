import { HttpErrorMessages } from '@core/messages';
import { CommonModule } from '@angular/common';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { selectedFilterCount } from '@shared/utils/filter-count';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  AlertService,
  AuthService,
  CustomerService,
  ListStateService,
  ModalStackService,
} from '@core/services';
import {
  AvatarComponent,
  BadgeComponent,
  IconComponent,
  ConnectionErrorComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  SideDrawerComponent,
  type FilterOption,
} from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { CustomerDto } from '@shared/models';
import { debounceTime, Subscription } from 'rxjs';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  isPageSizeOption,
} from '@shared/calculations/pagination';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';

type SortColumn = 'name' | 'address';
type SortDirection = 'asc' | 'desc';
interface CustomerListState {
  searchTerm: string;
  selectedStatuses: string[];
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
  pageSize?: number;
}

@Component({
  selector: 'app-customer-list',
  imports: [
    SortHeaderComponent,
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
  templateUrl: './customer-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class CustomerListComponent implements OnInit {
  private readonly stateKey = 'management:customer-list';
  private readonly customerService = inject(CustomerService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly listState = inject(ListStateService);
  private readonly modalStack = inject(ModalStackService);
  protected readonly routes = AppRoutes;

  protected readonly customers = signal<CustomerDto[]>([]);
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

  protected readonly selectedStatuses = signal<string[]>(['active']);

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly sortColumn = signal<SortColumn | null>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly showDeleteModal = signal(false);
  protected readonly customerToDelete = signal<CustomerDto | null>(null);
  protected readonly isDeleting = signal(false);
  protected readonly showRestoreModal = signal(false);
  protected readonly customerToRestore = signal<CustomerDto | null>(null);
  protected readonly isRestoring = signal(false);
  private modalStackId: number | null = null;

  protected readonly statusCounts = computed(() => ({
    active: this.facets()['active'] ?? 0,
    inactive: this.facets()['inactive'] ?? 0,
  }));

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'active', label: 'Active', count: this.statusCounts().active },
    { id: 'inactive', label: 'Inactive', count: this.statusCounts().inactive },
  ]);

  public ngOnInit(): void {
    this.restoreState();
    this.loadCustomers();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.reloadFromFirstPage();
      this.saveState();
    });
  }

  protected loadCustomers(): void {
    const firstLoad = this.customers().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.connectionFailed.set(false);
    this.loadRequest?.unsubscribe();

    this.loadRequest = this.customerService
      .getCustomersPaged({
        searchTerm: this.filterForm.controls.searchTerm.value,
        isActive: this.activeFilter(),
        sortBy: this.sortColumn() ?? undefined,
        sortDirection: this.sortDirection(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.customers.set(result.items);
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
    this.loadCustomers();
  }

  protected changePageSize(size: number): void {
    this.pageSize.set(size);
    this.saveState();
    this.reloadFromFirstPage();
  }

  private reloadFromFirstPage(): void {
    this.page.set(1);
    writePageParam(this.router, this.route, 1);
    this.loadCustomers();
  }

  // Both or neither status ticked means every customer.
  private activeFilter(): boolean | undefined {
    const chosen = this.selectedStatuses();
    if (chosen.length === 1) {
      return chosen[0] === 'active';
    }

    return undefined;
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadCustomers();
  }

  /** How many filters are applied, shown on the Filters button. */
  protected readonly activeFilterCount = computed(() =>
    selectedFilterCount(this.selectedStatuses().length, this.statusOptions().length),
  );

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected navigateToEditor(customerId?: string): void {
    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (customerId) {
      this.router.navigateByUrl(AppRoutes.ManagementCustomerEditById(customerId));
    } else {
      this.router.navigateByUrl(AppRoutes.ManagementCustomersNew);
    }
  }

  protected navigateToDetails(customerId: string): void {
    this.router.navigateByUrl(AppRoutes.ManagementCustomerDetailsById(customerId));
  }

  protected deleteCustomer(customer: CustomerDto): void {
    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }
    this.customerToDelete.set(customer);
    this.showDeleteModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDelete());
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.customerToDelete.set(null);
    this.removeFromStack();
  }

  protected restoreCustomer(customer: CustomerDto): void {
    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.customerToRestore.set(customer);
    this.showRestoreModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelRestore());
  }

  protected cancelRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    this.showRestoreModal.set(false);
    this.customerToRestore.set(null);
    this.removeFromStack();
  }

  protected confirmRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const customer = this.customerToRestore();
    if (!customer) {
      return;
    }

    this.isRestoring.set(true);
    this.customerService.restoreCustomer(customer.id).subscribe({
      next: () => {
        this.isRestoring.set(false);
        this.showRestoreModal.set(false);
        this.customerToRestore.set(null);
        this.removeFromStack();
        this.alertService.successRestored('Customer');
        this.loadCustomers();
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

    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const customer = this.customerToDelete();

    if (!customer) {
      return;
    }

    this.isDeleting.set(true);

    this.customerService.deleteCustomer(customer.id).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.customerToDelete.set(null);
        this.removeFromStack();
        this.loadCustomers();
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

  protected canWriteCustomers(): boolean {
    return this.authService.canWriteCustomers();
  }

  private restoreState(): void {
    const state = this.listState.load<CustomerListState>(this.stateKey, {
      searchTerm: '',
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
    this.selectedStatuses.set(state.selectedStatuses);
    this.sortColumn.set(state.sortColumn);
    this.sortDirection.set(state.sortDirection);
    this.pageSize.set(isPageSizeOption(state.pageSize) ? (state.pageSize as number) : DEFAULT_PAGE_SIZE);
  }

  private saveState(): void {
    this.listState.save<CustomerListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedStatuses: this.selectedStatuses(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
      pageSize: this.pageSize(),
    });
  }
}
