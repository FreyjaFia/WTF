import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AlertService, AuthService, ListStateService, ModalStackService, UserService } from '@core/services';
import {
    AvatarComponent,
    BadgeComponent,
    FilterDropdown,
    Icon,
    PullToRefreshComponent,
    type FilterOption,
} from '@shared/components';
import { UserDto, UserRoleEnum } from '@shared/models';
import { debounceTime } from 'rxjs';


type SortColumn = 'name' | 'role';
type SortDirection = 'asc' | 'desc';
interface UserListState {
  searchTerm: string;
  selectedRoles: number[];
  selectedStatuses: string[];
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
}

@Component({
  selector: 'app-user-list',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    Icon,
    FilterDropdown,
    BadgeComponent,
    AvatarComponent,
    PullToRefreshComponent,
  ],
  templateUrl: './user-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class UserListComponent implements OnInit {
  private readonly stateKey = 'management:user-list';
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly listState = inject(ListStateService);
  private readonly modalStack = inject(ModalStackService);

  protected readonly users = signal<UserDto[]>([]);
  protected readonly usersCache = signal<UserDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';

  protected readonly selectedRoles = signal<number[]>([]);
  protected readonly selectedStatuses = signal<string[]>(['active']);

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly sortColumn = signal<SortColumn | null>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly showDeleteModal = signal(false);
  protected readonly userToDelete = signal<UserDto | null>(null);
  protected readonly isDeleting = signal(false);
  private modalStackId: number | null = null;

  protected readonly statusCounts = computed(() => {
    const cache = this.usersCache();
    return {
      active: cache.filter((u) => u.isActive).length,
      inactive: cache.filter((u) => !u.isActive).length,
    };
  });

  protected readonly roleCounts = computed(() => {
    const cache = this.usersCache();
    return {
      [UserRoleEnum.Admin]: cache.filter((u) => u.roleId === UserRoleEnum.Admin).length,
      [UserRoleEnum.Cashier]: cache.filter((u) => u.roleId === UserRoleEnum.Cashier).length,
      [UserRoleEnum.AdminViewer]: cache.filter((u) => u.roleId === UserRoleEnum.AdminViewer).length,
    };
  });

  protected readonly roleOptions = computed<FilterOption[]>(() => [
    { id: UserRoleEnum.Admin, label: 'Admin', count: this.roleCounts()[UserRoleEnum.Admin] },
    {
      id: UserRoleEnum.Cashier,
      label: 'Cashier',
      count: this.roleCounts()[UserRoleEnum.Cashier],
    },
    {
      id: UserRoleEnum.AdminViewer,
      label: 'Admin Viewer',
      count: this.roleCounts()[UserRoleEnum.AdminViewer],
    },
  ]);

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'active', label: 'Active', count: this.statusCounts().active },
    { id: 'inactive', label: 'Inactive', count: this.statusCounts().inactive },
  ]);

  protected readonly sortedUsers = computed(() => {
    const users = [...this.users()];

    if (this.sortColumn() === 'name') {
      users.sort((a, b) => {
        const nameA = `${a.firstName} ${a.lastName}`;
        const nameB = `${b.firstName} ${b.lastName}`;
        const comparison = nameA.localeCompare(nameB);
        return this.sortDirection() === 'asc' ? comparison : -comparison;
      });
    } else if (this.sortColumn() === 'role') {
      users.sort((a, b) => {
        const comparison = this.getRoleLabel(a).localeCompare(this.getRoleLabel(b));
        return this.sortDirection() === 'asc' ? comparison : -comparison;
      });
    }

    return users;
  });

  public ngOnInit(): void {
    this.restoreState();
    this.loadUsers();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.applyFiltersToCache();
      this.saveState();
    });
  }

  protected loadUsers(): void {
    this.isLoading.set(true);

    this.userService.getUsers().subscribe({
      next: (data) => {
        this.usersCache.set(data);
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
    this.loadUsers();
  }

  private applyFiltersToCache(): void {
    const { searchTerm } = this.filterForm.value;
    let items = [...this.usersCache()];

    if (searchTerm && searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      items = items.filter(
        (u) =>
          u.firstName.toLowerCase().includes(lowerSearch) ||
          u.lastName.toLowerCase().includes(lowerSearch) ||
          `${u.firstName} ${u.lastName}`.toLowerCase().includes(lowerSearch),
      );
    }

    const selectedRoles = this.selectedRoles();
    if (selectedRoles.length > 0) {
      items = items.filter((u) => selectedRoles.includes(u.roleId));
    }

    const selectedStatuses = this.selectedStatuses();
    if (selectedStatuses.length > 0) {
      items = items.filter((u) => {
        if (selectedStatuses.includes('active') && u.isActive) {
          return true;
        }
        if (selectedStatuses.includes('inactive') && !u.isActive) {
          return true;
        }
        return false;
      });
    }

    this.users.set(items);
  }

  protected navigateToEditor(userId?: string): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (userId) {
      this.router.navigate(['/management/users/edit', userId]);
    } else {
      this.router.navigate(['/management/users/new']);
    }
  }

  protected navigateToDetails(userId: string): void {
    this.router.navigate(['/management/users/details', userId]);
  }

  protected deleteUser(user: UserDto): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.userToDelete.set(user);
    this.showDeleteModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDelete());
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.userToDelete.set(null);
    this.removeFromStack();
  }

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const user = this.userToDelete();

    if (!user) {
      return;
    }

    this.isDeleting.set(true);

    this.userService.deleteUser(user.id).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.userToDelete.set(null);
        this.removeFromStack();
        this.loadUsers();
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
  }

  protected onStatusFilterChange(selectedIds: (string | number)[]): void {
    this.selectedStatuses.set(selectedIds as string[]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onRoleFilterChange(selectedIds: (string | number)[]): void {
    this.selectedRoles.set(selectedIds as number[]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onRoleFilterReset(): void {
    this.selectedRoles.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onStatusFilterReset(): void {
    this.selectedStatuses.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected getRoleLabel(user: UserDto): string {
    const enumName = UserRoleEnum[user.roleId];
    if (!enumName || typeof enumName !== 'string') {
      return 'Unknown';
    }
    return enumName.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  }

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }

  private restoreState(): void {
    const state = this.listState.load<UserListState>(this.stateKey, {
      searchTerm: '',
      selectedRoles: [],
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
    this.selectedRoles.set(state.selectedRoles);
    this.selectedStatuses.set(state.selectedStatuses);
    this.sortColumn.set(state.sortColumn);
    this.sortDirection.set(state.sortDirection);
  }

  private saveState(): void {
    this.listState.save<UserListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedRoles: this.selectedRoles(),
      selectedStatuses: this.selectedStatuses(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    });
  }
}
