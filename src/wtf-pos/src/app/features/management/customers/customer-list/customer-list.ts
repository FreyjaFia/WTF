import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, CustomerService, ListStateService } from '@core/services';
import {
  AvatarComponent,
  BadgeComponent,
  FilterDropdown,
  Icon,
  type FilterOption,
} from '@shared/components';
import { CustomerDto } from '@shared/models';
import { debounceTime } from 'rxjs';


type SortColumn = 'name' | 'address';
type SortDirection = 'asc' | 'desc';
interface CustomerListState {
  searchTerm: string;
  selectedStatuses: string[];
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
}

@Component({
  selector: 'app-customer-list',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    Icon,
    FilterDropdown,
    BadgeComponent,
    AvatarComponent,
  ],
  templateUrl: './customer-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class CustomerListComponent implements OnInit {
  private readonly stateKey = 'management:customer-list';
  private readonly customerService = inject(CustomerService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);
  private readonly listState = inject(ListStateService);

  protected readonly customers = signal<CustomerDto[]>([]);
  protected readonly customersCache = signal<CustomerDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);

  protected readonly selectedStatuses = signal<string[]>(['active']);

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly sortColumn = signal<SortColumn | null>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly showDeleteModal = signal(false);
  protected readonly customerToDelete = signal<CustomerDto | null>(null);
  protected readonly isDeleting = signal(false);

  protected readonly statusCounts = computed(() => {
    const cache = this.customersCache();
    return {
      active: cache.filter((c) => c.isActive).length,
      inactive: cache.filter((c) => !c.isActive).length,
    };
  });

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'active', label: 'Active', count: this.statusCounts().active },
    { id: 'inactive', label: 'Inactive', count: this.statusCounts().inactive },
  ]);

  protected readonly sortedCustomers = computed(() => {
    const customers = [...this.customers()];

    if (this.sortColumn() === 'name') {
      customers.sort((a, b) => {
        const nameA = `${a.firstName} ${a.lastName}`;
        const nameB = `${b.firstName} ${b.lastName}`;
        const comparison = nameA.localeCompare(nameB);
        return this.sortDirection() === 'asc' ? comparison : -comparison;
      });
    } else if (this.sortColumn() === 'address') {
      customers.sort((a, b) => {
        const comparison = (a.address || '').localeCompare(b.address || '');
        return this.sortDirection() === 'asc' ? comparison : -comparison;
      });
    }

    return customers;
  });

  public ngOnInit(): void {
    this.restoreState();
    this.loadCustomers();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.applyFiltersToCache();
      this.saveState();
    });
  }

  protected loadCustomers(): void {
    this.isLoading.set(true);

    this.customerService.getCustomers().subscribe({
      next: (data) => {
        this.customersCache.set(data);
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
    this.loadCustomers();
  }

  private applyFiltersToCache(): void {
    const { searchTerm } = this.filterForm.value;
    let items = [...this.customersCache()];

    if (searchTerm && searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      items = items.filter(
        (c) =>
          c.firstName.toLowerCase().includes(lowerSearch) ||
          c.lastName.toLowerCase().includes(lowerSearch) ||
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(lowerSearch),
      );
    }

    const selectedStatuses = this.selectedStatuses();
    if (selectedStatuses.length > 0) {
      items = items.filter((c) => {
        if (selectedStatuses.includes('active') && c.isActive) {
          return true;
        }
        if (selectedStatuses.includes('inactive') && !c.isActive) {
          return true;
        }
        return false;
      });
    }

    this.customers.set(items);
  }

  protected navigateToEditor(customerId?: string): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (customerId) {
      this.router.navigate(['/management/customers/edit', customerId]);
    } else {
      this.router.navigate(['/management/customers/new']);
    }
  }

  protected navigateToDetails(customerId: string): void {
    this.router.navigate(['/management/customers/details', customerId]);
  }

  protected deleteCustomer(customer: CustomerDto): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }
    this.customerToDelete.set(customer);
    this.showDeleteModal.set(true);
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.customerToDelete.set(null);
  }

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canWriteManagement()) {
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
        this.loadCustomers();
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message);
      },
    });
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
  }

  private saveState(): void {
    this.listState.save<CustomerListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedStatuses: this.selectedStatuses(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    });
  }
}
