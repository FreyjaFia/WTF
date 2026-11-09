import { HttpErrorMessages } from '@core/messages';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AlertService, ListStateService, ModalStackService, RoleService } from '@core/services';
import {
  BadgeComponent,
  ConnectionErrorComponent,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  SideDrawerComponent,
} from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { AppRoutes } from '@shared/constants/app-routes';
import { RoleDto } from '@shared/models';
import { selectedFilterCount } from '@shared/utils/filter-count';
import { debounceTime } from 'rxjs';

type SortColumn = 'name' | 'type' | 'users' | 'permissions';
type SortDirection = 'asc' | 'desc';

interface RoleListState {
  searchTerm: string;
  selectedTypes: string[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
}

@Component({
  selector: 'app-role-list',
  imports: [
    BadgeComponent,
    ConfirmDialogComponent,
    ConnectionErrorComponent,
    FilterButtonComponent,
    IconComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    RouterLink,
    SearchInputComponent,
    SideDrawerComponent,
    SortHeaderComponent,
  ],
  templateUrl: './role-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class RoleListComponent implements OnInit {
  private readonly stateKey = 'management:role-list';
  private readonly roleService = inject(RoleService);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);
  private readonly listState = inject(ListStateService);
  private readonly modalStack = inject(ModalStackService);
  protected readonly routes = AppRoutes;

  protected readonly rolesCache = signal<RoleDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isFiltersOpen = signal(false);
  protected readonly selectedTypes = signal<string[]>([]);
  protected readonly sortColumn = signal<SortColumn>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly roleToDelete = signal<RoleDto | null>(null);
  protected readonly isDeleting = signal(false);
  protected readonly isDuplicating = signal(false);
  private modalStackId: number | null = null;

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly searchTerm = signal('');

  protected readonly typeOptions = computed(() => [
    { id: 'system', label: 'Built-in', count: this.rolesCache().filter((r) => r.isSystem).length },
    { id: 'custom', label: 'Custom', count: this.rolesCache().filter((r) => !r.isSystem).length },
  ]);

  protected readonly activeFilterCount = computed(() =>
    selectedFilterCount(this.selectedTypes().length, this.typeOptions().length),
  );

  protected readonly sortedRoles = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const types = this.selectedTypes();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;

    const items = this.rolesCache().filter((role) => {
      if (types.length > 0 && !types.includes(role.isSystem ? 'system' : 'custom')) {
        return false;
      }

      return (
        !term ||
        role.name.toLowerCase().includes(term) ||
        (role.description ?? '').toLowerCase().includes(term)
      );
    });

    return items.sort((a, b) => {
      switch (this.sortColumn()) {
        case 'type':
          return (Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name)) * direction;
        case 'users':
          return (a.userCount - b.userCount || a.name.localeCompare(b.name)) * direction;
        case 'permissions':
          return (a.permissionCount - b.permissionCount || a.name.localeCompare(b.name)) * direction;
        default:
          return a.name.localeCompare(b.name) * direction;
      }
    });
  });

  public ngOnInit(): void {
    this.restoreState();
    this.loadRoles();

    this.filterForm.controls.searchTerm.valueChanges.pipe(debounceTime(300)).subscribe((value) => {
      this.searchTerm.set(value ?? '');
      this.saveState();
    });
  }

  protected loadRoles(): void {
    this.isLoading.set(true);
    this.connectionFailed.set(false);

    this.roleService.getRoles().subscribe({
      next: (roles) => {
        this.rolesCache.set(roles);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadRoles();
  }

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected isTypeSelected(typeId: string): boolean {
    return this.selectedTypes().includes(typeId);
  }

  protected toggleType(typeId: string): void {
    const current = this.selectedTypes();
    this.selectedTypes.set(
      current.includes(typeId) ? current.filter((id) => id !== typeId) : [...current, typeId],
    );
    this.saveState();
  }

  protected clearTypes(): void {
    this.selectedTypes.set([]);
    this.saveState();
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

  protected duplicateRole(role: RoleDto): void {
    if (this.isDuplicating()) {
      return;
    }

    this.isDuplicating.set(true);
    this.roleService.duplicateRole(role.id).subscribe({
      next: (copy) => {
        this.isDuplicating.set(false);
        this.alertService.successCreated('Role');
        this.router.navigateByUrl(AppRoutes.ManagementRoleById(copy.id));
      },
      error: (err: Error) => {
        this.isDuplicating.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected deleteRole(role: RoleDto): void {
    this.roleToDelete.set(role);
    this.modalStackId = this.modalStack.push(() => this.cancelDelete());
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.roleToDelete.set(null);
    this.removeFromStack();
  }

  protected confirmDelete(): void {
    const role = this.roleToDelete();
    if (!role) {
      return;
    }

    this.isDeleting.set(true);
    this.roleService.deleteRole(role.id).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.roleToDelete.set(null);
        this.removeFromStack();
        this.alertService.successDeleted('Role');
        this.loadRoles();
      },
      error: (err: Error) => {
        this.isDeleting.set(false);
        this.roleToDelete.set(null);
        this.removeFromStack();
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

  private restoreState(): void {
    const state = this.listState.load<RoleListState>(this.stateKey, {
      searchTerm: '',
      selectedTypes: [],
      sortColumn: 'name',
      sortDirection: 'asc',
    });

    this.filterForm.patchValue({ searchTerm: state.searchTerm }, { emitEvent: false });
    this.searchTerm.set(state.searchTerm);
    this.selectedTypes.set(state.selectedTypes);
    this.sortColumn.set(state.sortColumn);
    this.sortDirection.set(state.sortDirection);
  }

  private saveState(): void {
    this.listState.save<RoleListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedTypes: this.selectedTypes(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    });
  }
}
