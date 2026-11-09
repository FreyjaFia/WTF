import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AlertService, ListStateService, RoleService } from '@core/services';
import { RoleDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAlert, fakeListState, internals, Internals } from '../../../../testing/management-spec-helpers';
import { RoleListComponent } from './role-list';

function role(id: number, name: string, isSystem: boolean, userCount: number, permissionCount: number): RoleDto {
  return { id, name, description: null, isSystem, userCount, permissionCount, permissions: [] };
}

const OWNER = role(4, 'Owner', true, 1, 34);
const CASHIER = role(2, 'Cashier', true, 3, 6);
const LEAD = role(100, 'Shift Lead', false, 0, 5);
const BARISTA = role(101, 'Barista', false, 2, 3);
const DATA = [OWNER, CASHIER, LEAD, BARISTA];

describe('RoleListComponent', () => {
  let fixture: ComponentFixture<RoleListComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(getRoles = vi.fn(() => of(DATA))) {
    alert = fakeAlert();
    service = {
      getRoles,
      deleteRole: vi.fn(() => of(void 0)),
      duplicateRole: vi.fn(() => of({ id: 102, name: 'Cashier copy', isSystem: false, userCount: 0, permissions: [] })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RoleService, useValue: service },
        { provide: AlertService, useValue: alert },
        { provide: ListStateService, useValue: fakeListState() },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(RoleListComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  const names = (): string[] => c.sortedRoles().map((r: RoleDto) => r.name);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads the roles and sorts them by name', () => {
    setup();
    expect(names()).toEqual(['Barista', 'Cashier', 'Owner', 'Shift Lead']);
    expect(c.isLoading()).toBe(false);
  });

  it('sorts by every column and flips the direction on a second click', () => {
    setup();
    c.toggleSort('users');
    expect(names()).toEqual(['Shift Lead', 'Owner', 'Barista', 'Cashier']);
    c.toggleSort('users');
    expect(names()).toEqual(['Cashier', 'Barista', 'Owner', 'Shift Lead']);
    c.toggleSort('permissions');
    expect(names()).toEqual(['Barista', 'Shift Lead', 'Cashier', 'Owner']);
    c.toggleSort('type');
    expect(names()).toEqual(['Cashier', 'Owner', 'Barista', 'Shift Lead']);
  });

  it('filters by type and by the search text, and counts the active filters', () => {
    setup();
    c.toggleType('custom');
    expect(names()).toEqual(['Barista', 'Shift Lead']);
    expect(c.activeFilterCount()).toBe(1);
    expect(c.typeOptions().map((o: { count: number }) => o.count)).toEqual([2, 2]);

    c.clearTypes();
    c.searchTerm.set('shift');
    expect(names()).toEqual(['Shift Lead']);
  });

  it('shows the server message when loading fails', () => {
    setup(vi.fn(() => throwError(() => new Error('nope'))));
    expect(alert.error).toHaveBeenCalledWith('nope');
    expect(c.isLoading()).toBe(false);
  });

  it('duplicates a role and opens the copy', () => {
    setup();
    c.duplicateRole(CASHIER);
    expect(service['duplicateRole']).toHaveBeenCalledWith(2);
    expect(alert.successCreated).toHaveBeenCalledWith('Role');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/management/roles/102');
  });

  it('asks before deleting, then deletes and reloads', () => {
    setup();
    c.deleteRole(LEAD);
    expect(c.roleToDelete()).toBe(LEAD);

    c.confirmDelete();
    expect(service['deleteRole']).toHaveBeenCalledWith(100);
    expect(alert.successDeleted).toHaveBeenCalledWith('Role');
    expect(c.roleToDelete()).toBeNull();
    expect(service['getRoles']).toHaveBeenCalledTimes(2);
  });

  it('shows the server reason when a delete is refused', () => {
    setup();
    service['deleteRole'].mockReturnValue(throwError(() => new Error('2 users have this role.')));
    c.deleteRole(BARISTA);
    c.confirmDelete();
    expect(alert.error).toHaveBeenCalledWith('2 users have this role.');
    expect(c.roleToDelete()).toBeNull();
  });

  it('renders a row per role with its type', () => {
    setup();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Shift Lead');
    expect(text).toContain('Built-in');
    expect(text).toContain('Custom');
  });
});
