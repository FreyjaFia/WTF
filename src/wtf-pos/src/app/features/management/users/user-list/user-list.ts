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
  ListStateService,
  ModalStackService,
  RoleService,
  SubscriptionService,
  UserService,
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
import { UsersOverCapNoticeComponent } from '@shared/components/users-over-cap-notice/users-over-cap-notice';
import { AppRoutes } from '@shared/constants/app-routes';
import { UserDto, UserRoleEnum } from '@shared/models';
import { userRoleLabel } from '@shared/utils/user-role-label';
import { catchError, debounceTime, of, Subscription } from 'rxjs';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  isPageSizeOption,
} from '@shared/calculations/pagination';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';

type SortColumn = 'name' | 'role';
type SortDirection = 'asc' | 'desc';
interface UserListState {
  searchTerm: string;
  selectedRoles: number[];
  selectedStatuses: string[];
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
  pageSize?: number;
}

@Component({
  selector: 'app-user-list',
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
    UsersOverCapNoticeComponent,
    SideDrawerComponent,
    PaginationComponent,
  ],
  templateUrl: './user-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class UserListComponent implements OnInit {
  private readonly stateKey = 'management:user-list';
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly roleService = inject(RoleService);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly listState = inject(ListStateService);
  private readonly modalStack = inject(ModalStackService);
  private readonly subscription = inject(SubscriptionService);
  protected readonly routes = AppRoutes;

  protected readonly users = signal<UserDto[]>([]);
  protected readonly isReloading = signal(false);
  protected readonly page = signal(readPageParam(this.route));
  protected readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  protected readonly totalCount = signal(0);
  protected readonly facets = signal<Record<string, number>>({});
  protected readonly roleNames = signal<Record<number, string>>({});
  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  private loadRequest: Subscription | null = null;
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isFiltersOpen = signal(false);

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
  protected readonly showRestoreModal = signal(false);
  protected readonly userToRestore = signal<UserDto | null>(null);
  protected readonly isRestoring = signal(false);
  private modalStackId: number | null = null;

  protected readonly statusCounts = computed(() => ({
    active: this.facets()['active'] ?? 0,
    inactive: this.facets()['inactive'] ?? 0,
  }));

  protected readonly roleCounts = computed<Record<number, number>>(() => {
    const counts: Record<number, number> = {
      [UserRoleEnum.Owner]: 0,
      [UserRoleEnum.Admin]: 0,
      [UserRoleEnum.Cashier]: 0,
      [UserRoleEnum.AdminViewer]: 0,
      [UserRoleEnum.ItemManager]: 0,
      [UserRoleEnum.StockManager]: 0,
      [UserRoleEnum.Kitchen]: 0,
    };

    for (const [key, value] of Object.entries(this.facets())) {
      if (key.startsWith('role:')) {
        counts[Number(key.slice(5))] = value;
      }
    }

    return counts;
  });

  protected readonly roleOptions = computed<FilterOption[]>(() => {
    const counts = this.roleCounts();
    const countOf = (roleId: number): number => counts[roleId] ?? 0;
    const builtIn: FilterOption[] = [
      UserRoleEnum.Owner,
      UserRoleEnum.Admin,
      UserRoleEnum.Cashier,
      UserRoleEnum.AdminViewer,
      UserRoleEnum.ItemManager,
      UserRoleEnum.StockManager,
      UserRoleEnum.Kitchen,
    ].map((roleId) => ({
      id: roleId,
      label: userRoleLabel({ roleId }),
      count: countOf(roleId),
    }));

    const custom = new Map<number, string>();
    for (const roleId of Object.keys(counts).map(Number)) {
      if (UserRoleEnum[roleId] === undefined) {
        custom.set(roleId, userRoleLabel({ roleId, roleName: this.roleNames()[roleId] }));
      }
    }

    const customOptions: FilterOption[] = [...custom.entries()]
      .sort((x, y) => x[1].localeCompare(y[1]))
      .map(([roleId, label]) => ({ id: roleId, label, count: countOf(roleId) }));

    return [...builtIn, ...customOptions];
  });

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'active', label: 'Active', count: this.statusCounts().active },
    { id: 'inactive', label: 'Inactive', count: this.statusCounts().inactive },
  ]);

  public ngOnInit(): void {
    this.restoreState();
    this.subscription.refresh();
    this.loadRoleNames();
    this.loadUsers();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.reloadFromFirstPage();
      this.saveState();
    });
  }

  protected loadUsers(): void {
    const firstLoad = this.users().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.connectionFailed.set(false);
    this.loadRequest?.unsubscribe();

    this.loadRequest = this.userService
      .getUsersPaged({
        searchTerm: this.filterForm.controls.searchTerm.value,
        isActive: this.activeFilter(),
        roleIds: this.selectedRoles(),
        sortBy: this.sortColumn() ?? undefined,
        sortDirection: this.sortDirection(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.users.set(result.items);
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
    this.loadUsers();
  }

  protected changePageSize(size: number): void {
    this.pageSize.set(size);
    this.saveState();
    this.reloadFromFirstPage();
  }

  private reloadFromFirstPage(): void {
    this.page.set(1);
    writePageParam(this.router, this.route, 1);
    this.loadUsers();
  }

  // Both or neither status ticked means every user.
  private activeFilter(): boolean | undefined {
    const chosen = this.selectedStatuses();
    return chosen.length === 1 ? chosen[0] === 'active' : undefined;
  }

  // Custom role names for the role chips; a user who cannot read roles still sees the built-in ones.
  private loadRoleNames(): void {
    this.roleService
      .getRoles()
      .pipe(catchError(() => of([])))
      .subscribe((roles) =>
        this.roleNames.set(Object.fromEntries(roles.map((role) => [role.id, role.name]))),
      );
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadUsers();
  }

  /** How many filters are applied, shown on the Filters button. */
  protected readonly activeFilterCount = computed(
    () =>
      selectedFilterCount(this.selectedRoles().length, this.roleOptions().length) +
      selectedFilterCount(this.selectedStatuses().length, this.statusOptions().length),
  );

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected navigateToEditor(userId?: string): void {
    if (!this.canWriteUsers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (userId) {
      this.router.navigateByUrl(AppRoutes.ManagementUserEditById(userId));
    } else {
      this.router.navigateByUrl(AppRoutes.ManagementUsersNew);
    }
  }

  protected navigateToDetails(userId: string): void {
    this.router.navigateByUrl(AppRoutes.ManagementUserDetailsById(userId));
  }

  protected deleteUser(user: UserDto): void {
    if (!this.canWriteUsers()) {
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

  protected restoreUser(user: UserDto): void {
    if (!this.canWriteUsers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.userToRestore.set(user);
    this.showRestoreModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelRestore());
  }

  protected cancelRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    this.showRestoreModal.set(false);
    this.userToRestore.set(null);
    this.removeFromStack();
  }

  protected confirmRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    if (!this.canWriteUsers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const user = this.userToRestore();
    if (!user) {
      return;
    }

    this.isRestoring.set(true);
    this.userService.restoreUser(user.id).subscribe({
      next: () => {
        this.isRestoring.set(false);
        this.showRestoreModal.set(false);
        this.userToRestore.set(null);
        this.removeFromStack();
        this.alertService.successRestored('User');
        this.loadUsers();
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

    if (!this.canWriteUsers()) {
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
    this.reloadFromFirstPage();
  }

  protected onStatusFilterChange(selectedIds: (string | number)[]): void {
    this.selectedStatuses.set(selectedIds as string[]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected onRoleFilterChange(selectedIds: (string | number)[]): void {
    this.selectedRoles.set(selectedIds as number[]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected onRoleFilterReset(): void {
    this.selectedRoles.set([]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected onStatusFilterReset(): void {
    this.selectedStatuses.set([]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected isRoleSelected(roleId: number): boolean {
    return this.selectedRoles().includes(roleId);
  }

  protected toggleRoleSelection(roleId: number): void {
    const current = this.selectedRoles();
    const hasRole = current.includes(roleId);
    const next = hasRole ? current.filter((id) => id !== roleId) : [...current, roleId];

    this.selectedRoles.set(next);
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected clearRoleSelections(): void {
    this.selectedRoles.set([]);
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

  protected getRoleLabel(user: UserDto): string {
    return userRoleLabel(user);
  }

  protected canWriteUsers(): boolean {
    return this.authService.canWriteUsers();
  }

  protected canManageUserProfile(user: UserDto): boolean {
    if (user.roleId === UserRoleEnum.Owner) {
      return this.authService.isOwner();
    }

    return this.canWriteUsers();
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
    this.pageSize.set(isPageSizeOption(state.pageSize) ? (state.pageSize as number) : DEFAULT_PAGE_SIZE);
  }

  private saveState(): void {
    this.listState.save<UserListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedRoles: this.selectedRoles(),
      selectedStatuses: this.selectedStatuses(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
      pageSize: this.pageSize(),
    });
  }
}
