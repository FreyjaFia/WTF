import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  AlertService,
  AuthService,
  ListStateService,
  RoleService,
  UserService,
} from '@core/services';
import { PagedResultDto, UserDto, UserRoleEnum } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeAlert,
  fakeListState,
  internals,
  Internals,
} from '../../../../testing/management-spec-helpers';
import { UserListComponent } from './user-list';

function user(
  id: string,
  first: string,
  last: string,
  roleId: UserRoleEnum,
  isActive = true,
): UserDto {
  return {
    id,
    firstName: first,
    lastName: last,
    username: first.toLowerCase(),
    roleId,
    isActive,
    createdAt: '2024-01-01',
    createdBy: 'x',
  };
}

const BOB = user('1', 'Bob', 'Zed', UserRoleEnum.Cashier);
const ALICE = user('2', 'Alice', 'Smith', UserRoleEnum.Admin);
const CARL = user('3', 'Carl', 'Gone', UserRoleEnum.Admin, false);
const ROOT = user('4', 'Root', 'User', UserRoleEnum.Owner);
const DATA = [BOB, ALICE, CARL, ROOT];

const ids = (list: UserDto[]) => list.map((x) => x.id);

const paged = (
  items: UserDto[],
  page = 1,
  totalCount = items.length,
  facets?: Record<string, number>,
): PagedResultDto<UserDto> => ({ items, page, pageSize: 25, totalCount, facets });

describe('UserListComponent', () => {
  let fixture: ComponentFixture<UserListComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let listState: ReturnType<typeof fakeListState>;
  let router: Router;
  const lastQuery = () => service['getUsersPaged'].mock.lastCall![0];

  function setup(
    opts: {
      saved?: unknown;
      canWrite?: boolean;
      owner?: boolean;
      getUsersPaged?: ReturnType<typeof vi.fn>;
      roles?: { id: number; name: string }[];
    } = {},
  ) {
    alert = fakeAlert();
    listState = fakeListState(opts.saved);
    const auth = {
      canWriteUsers: vi.fn(() => opts.canWrite ?? true),
      isOwner: vi.fn(() => opts.owner ?? false),
    };
    service = {
      getUsersPaged:
        opts.getUsersPaged ??
        vi.fn(() => of(paged([ALICE, BOB, ROOT], 1, 3, { active: 3, inactive: 1, 'role:1': 2, 'role:2': 1, 'role:4': 1 }))),
      deleteUser: vi.fn(() => of(void 0)),
      restoreUser: vi.fn(() => of(void 0)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: UserService, useValue: service },
        { provide: RoleService, useValue: { getRoles: vi.fn(() => of(opts.roles ?? [])) } },
        { provide: AlertService, useValue: alert },
        { provide: AuthService, useValue: auth },
        { provide: ListStateService, useValue: listState },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(UserListComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a filter option for each custom role the server counts, named from the roles list', () => {
    setup({
      getUsersPaged: vi.fn(() => of(paged([BOB], 1, 1, { active: 1, inactive: 0, 'role:2': 1, 'role:100': 4 }))),
      roles: [{ id: 100, name: 'Shift Lead' }],
    });
    const options = c.roleOptions() as { id: number; label: string; count: number }[];
    expect(options.slice(-1)).toEqual([{ id: 100, label: 'Shift Lead', count: 4 }]);
    expect(options).toHaveLength(7);
    expect(c.getRoleLabel({ ...BOB, roleId: 100, roleName: 'Shift Lead' })).toBe('Shift Lead');
  });

  it('loads the first page of active users sorted by name, with counts from the server', () => {
    setup();
    expect(service['getUsersPaged']).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 25,
        isActive: true,
        roleIds: [],
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    );
    expect(ids(c.users())).toEqual(['2', '1', '4']);
    expect(c.statusCounts()).toEqual({ active: 3, inactive: 1 });
    expect(c.roleCounts()[UserRoleEnum.Admin]).toBe(2);
    expect(c.roleCounts()[UserRoleEnum.Cashier]).toBe(1);
    expect(c.roleCounts()[UserRoleEnum.StockManager]).toBe(0);
    expect(c.roleOptions().length).toBe(6);
    expect(c.statusOptions().map((o: { count: number }) => o.count)).toEqual([3, 1]);
  });

  it('renders rows, the Add button and the pagination bar', () => {
    setup();
    expect(text()).toContain('Alice Smith');
    expect(text()).toContain('Add User');
    expect(text()).toContain('1 – 3 of 3');
    expect(text()).not.toContain('Carl Gone');
  });

  it('hides write UI without permission', () => {
    setup({ canWrite: false });
    expect(text()).not.toContain('Add User');
    expect(fixture.nativeElement.querySelector('[aria-label="User actions"]')).toBeNull();
  });

  it('shows the empty state', () => {
    setup({ getUsersPaged: vi.fn(() => of(paged([]))) });
    expect(text()).toContain('No users found');
  });

  it('alerts on load error and resets flags', () => {
    setup({ getUsersPaged: vi.fn(() => throwError(() => new Error('boom'))) });
    expect(alert.error).toHaveBeenCalledWith('boom');
    expect(c.isLoading()).toBe(false);
    expect(c.isRefreshing()).toBe(false);
  });

  it('shows the spinner while loading', () => {
    const subject = new Subject<PagedResultDto<UserDto>>();
    setup({ getUsersPaged: vi.fn(() => subject) });
    expect(c.isLoading()).toBe(true);
    expect(fixture.nativeElement.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('refresh reloads', () => {
    setup();
    c.refresh();
    expect(service['getUsersPaged']).toHaveBeenCalledTimes(2);
    expect(c.isRefreshing()).toBe(false);
  });

  it('restores persisted state, including the rows per page', () => {
    setup({
      saved: {
        searchTerm: 'x',
        selectedRoles: [UserRoleEnum.Admin],
        selectedStatuses: ['inactive'],
        sortColumn: 'role',
        sortDirection: 'desc',
        pageSize: 100,
      },
    });
    expect(c.filterForm.controls.searchTerm.value).toBe('x');
    expect(c.selectedRoles()).toEqual([UserRoleEnum.Admin]);
    expect(c.selectedStatuses()).toEqual(['inactive']);
    expect(c.sortColumn()).toBe('role');
    expect(c.sortDirection()).toBe('desc');
    expect(lastQuery()).toEqual(
      expect.objectContaining({ pageSize: 100, isActive: false, roleIds: [UserRoleEnum.Admin] }),
    );
  });

  describe('paging', () => {
    it('goes to a page and writes it to the address', () => {
      setup({ getUsersPaged: vi.fn((q: { page: number }) => of(paged(DATA, q.page, 120))) });
      c.goToPage(4);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 4 }));
      expect(vi.mocked(router.navigate).mock.lastCall![1]!.queryParams).toEqual({ page: 4 });
    });

    it('a new page size, role, status, sort or search returns to page one', () => {
      setup({ getUsersPaged: vi.fn((q: { page: number }) => of(paged(DATA, q.page, 120))) });
      c.goToPage(3);
      c.changePageSize(10);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, pageSize: 10 }));
      c.goToPage(3);
      c.toggleRoleSelection(UserRoleEnum.Admin);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, roleIds: [UserRoleEnum.Admin] }));
      c.goToPage(3);
      c.toggleStatusSelection('inactive');
      expect(lastQuery().page).toBe(1);
      c.goToPage(3);
      c.toggleSort('role');
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, sortBy: 'role' }));
    });
  });

  describe('filtering', () => {
    it('search is debounced and persists state', () => {
      setup();
      service['getUsersPaged'].mockClear();
      c.filterForm.controls.searchTerm.setValue('ALICE s');
      fixture.destroy();
      fixture.detectChanges();
      vi.advanceTimersByTime(299);
      expect(service['getUsersPaged']).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(lastQuery()).toEqual(expect.objectContaining({ searchTerm: 'ALICE s', page: 1 }));
      expect(listState.save).toHaveBeenCalledWith(
        'management:user-list',
        expect.objectContaining({ searchTerm: 'ALICE s' }),
      );
    });

    it('asks the server for the picked roles and statuses', () => {
      setup();
      c.toggleRoleSelection(UserRoleEnum.Admin);
      expect(lastQuery().roleIds).toEqual([UserRoleEnum.Admin]);
      expect(c.isRoleSelected(UserRoleEnum.Admin)).toBe(true);
      c.toggleStatusSelection('inactive');
      expect(lastQuery().isActive).toBeUndefined();
      c.toggleRoleSelection(UserRoleEnum.Admin);
      expect(c.isRoleSelected(UserRoleEnum.Admin)).toBe(false);
      expect(listState.save).toHaveBeenLastCalledWith(
        'management:user-list',
        expect.objectContaining({ selectedRoles: [], selectedStatuses: ['active', 'inactive'] }),
      );
    });

    it('clear/reset/change handlers update selections and reload', () => {
      setup();
      c.onRoleFilterChange([UserRoleEnum.Cashier]);
      expect(lastQuery().roleIds).toEqual([UserRoleEnum.Cashier]);
      c.onRoleFilterReset();
      expect(c.selectedRoles()).toEqual([]);
      c.toggleRoleSelection(UserRoleEnum.Cashier);
      c.clearRoleSelections();
      expect(lastQuery().roleIds).toEqual([]);

      c.onStatusFilterChange(['inactive']);
      expect(lastQuery().isActive).toBe(false);
      c.onStatusFilterReset();
      expect(lastQuery().isActive).toBeUndefined();
      c.toggleStatusSelection('active');
      c.clearStatusSelections();
      expect(c.selectedStatuses()).toEqual([]);
      expect(c.isStatusSelected('active')).toBe(false);
    });

    it('opens and closes the filters drawer', () => {
      setup();
      c.openFilters();
      expect(c.isFiltersOpen()).toBe(true);
      c.closeFilters();
      expect(c.isFiltersOpen()).toBe(false);
    });
  });

  describe('sorting and role labels', () => {
    it('toggles direction then switches column, on the server', () => {
      setup();
      c.toggleSort('name');
      expect(c.sortDirection()).toBe('desc');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'name', sortDirection: 'desc' }));
      c.toggleSort('role');
      expect(c.sortColumn()).toBe('role');
      expect(c.sortDirection()).toBe('asc');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'role', sortDirection: 'asc' }));
      c.toggleSort('role');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'role', sortDirection: 'desc' }));
    });

    it('formats role labels with spaces and falls back to Unknown', () => {
      setup();
      expect(c.getRoleLabel(ROOT)).toBe('Owner');
      expect(c.getRoleLabel(user('9', 'a', 'b', UserRoleEnum.StockManager))).toBe('Stock Manager');
      expect(c.getRoleLabel({ ...BOB, roleId: 99 })).toBe('Unknown');
    });
  });

  describe('permissions', () => {
    it('only owners can manage owner profiles', () => {
      setup({ owner: false });
      expect(c.canManageUserProfile(ROOT)).toBe(false);
      expect(c.canManageUserProfile(BOB)).toBe(true);
    });

    it('owners can manage everyone', () => {
      setup({ owner: true });
      expect(c.canManageUserProfile(ROOT)).toBe(true);
    });

    it('write-less users cannot manage regular profiles', () => {
      setup({ canWrite: false });
      expect(c.canManageUserProfile(BOB)).toBe(false);
    });
  });

  describe('navigation', () => {
    it('navigates to editor and details', () => {
      setup();
      c.navigateToEditor();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/management/users/new');
      c.navigateToEditor('7');
      expect(router.navigateByUrl).toHaveBeenLastCalledWith(expect.stringContaining('7'));
      c.navigateToDetails('9');
      expect(router.navigateByUrl).toHaveBeenLastCalledWith(expect.stringContaining('9'));
    });

    it('blocks editor navigation without permission', () => {
      setup({ canWrite: false });
      c.navigateToEditor('1');
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('delete flow', () => {
    it('opens, cancels and confirms deletion', () => {
      setup();
      c.deleteUser(BOB);
      fixture.detectChanges();
      expect(text()).toContain('Delete User?');
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(c.userToDelete()).toBeNull();

      c.deleteUser(BOB);
      c.confirmDelete();
      expect(service['deleteUser']).toHaveBeenCalledWith('1');
      expect(c.showDeleteModal()).toBe(false);
      expect(service['getUsersPaged']).toHaveBeenCalledTimes(2);
    });

    it('no-ops without a selection', () => {
      setup();
      c.confirmDelete();
      expect(service['deleteUser']).not.toHaveBeenCalled();
    });

    it('alerts on failure and keeps the modal open', () => {
      setup();
      service['deleteUser'].mockReturnValue(throwError(() => new Error('nope')));
      c.deleteUser(BOB);
      c.confirmDelete();
      expect(alert.error).toHaveBeenCalledWith('nope');
      expect(c.isDeleting()).toBe(false);
      expect(c.showDeleteModal()).toBe(true);
    });

    it('ignores cancel/re-confirm while deleting', () => {
      setup();
      service['deleteUser'].mockReturnValue(new Subject<void>());
      c.deleteUser(BOB);
      c.confirmDelete();
      c.confirmDelete();
      c.cancelDelete();
      expect(service['deleteUser']).toHaveBeenCalledTimes(1);
      expect(c.showDeleteModal()).toBe(true);
    });

    it('is blocked without permission', () => {
      setup({ canWrite: false });
      c.deleteUser(BOB);
      c.confirmDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(alert.errorUnauthorized).toHaveBeenCalledTimes(2);
      expect(service['deleteUser']).not.toHaveBeenCalled();
    });
  });

  describe('restore flow', () => {
    it('restores an inactive user and reloads', () => {
      setup();
      c.restoreUser(CARL);
      fixture.detectChanges();
      expect(text()).toContain('Restore User?');
      c.confirmRestore();
      expect(service['restoreUser']).toHaveBeenCalledWith('3');
      expect(alert.successRestored).toHaveBeenCalledWith('User');
      expect(c.showRestoreModal()).toBe(false);
      expect(service['getUsersPaged']).toHaveBeenCalledTimes(2);
    });

    it('cancel closes the modal', () => {
      setup();
      c.restoreUser(CARL);
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(false);
      expect(c.userToRestore()).toBeNull();
    });

    it('alerts on failure', () => {
      setup();
      service['restoreUser'].mockReturnValue(throwError(() => new Error('bad')));
      c.restoreUser(CARL);
      c.confirmRestore();
      expect(alert.error).toHaveBeenCalledWith('bad');
      expect(c.isRestoring()).toBe(false);
    });

    it('is blocked without permission', () => {
      setup({ canWrite: false });
      c.restoreUser(CARL);
      c.confirmRestore();
      expect(alert.errorUnauthorized).toHaveBeenCalledTimes(2);
      expect(service['restoreUser']).not.toHaveBeenCalled();
    });

    it('no-ops without a selection', () => {
      setup();
      c.confirmRestore();
      expect(service['restoreUser']).not.toHaveBeenCalled();
    });

    it('ignores cancel/re-confirm while restoring', () => {
      setup();
      service['restoreUser'].mockReturnValue(new Subject<void>());
      c.restoreUser(CARL);
      c.confirmRestore();
      c.confirmRestore();
      c.cancelRestore();
      expect(service['restoreUser']).toHaveBeenCalledTimes(1);
      expect(c.showRestoreModal()).toBe(true);
    });
  });
  describe('filter count on the Filters button', () => {
    it('adds the chosen roles to the chosen statuses', () => {
      setup();
      expect(c.activeFilterCount()).toBe(1);
      c.selectedRoles.set([c.roleOptions()[0].id]);
      expect(c.activeFilterCount()).toBe(2);
      c.selectedStatuses.set(['active', 'inactive']);
      expect(c.activeFilterCount()).toBe(1);
    });
  });
});
