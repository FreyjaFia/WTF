import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AlertService, AuthService, UserService } from '@core/services';
import { UserDto, UserRoleEnum } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeAlert,
  internals,
  Internals,
  stubRoute,
} from '../../../../testing/management-spec-helpers';
import { UserDetailsComponent } from './user-details';

const ACTIVE: UserDto = {
  id: 'u1',
  firstName: 'Ann',
  lastName: 'Lee',
  username: 'annlee',
  roleId: UserRoleEnum.ItemManager,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  createdBy: 'x',
  imageUrl: 'http://img/a.png',
};
const INACTIVE: UserDto = { ...ACTIVE, isActive: false, imageUrl: null };
const SUPER: UserDto = { ...ACTIVE, roleId: UserRoleEnum.SuperAdmin };

describe('UserDetailsComponent', () => {
  let fixture: ComponentFixture<UserDetailsComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(
    opts: {
      id?: string | null;
      canWrite?: boolean;
      superAdmin?: boolean;
      user?: UserDto;
      get?: unknown;
    } = {},
  ) {
    alert = fakeAlert();
    service = {
      getUserById: vi.fn(() => opts.get ?? of(opts.user ?? ACTIVE)),
      deleteUser: vi.fn(() => of(void 0)),
      restoreUser: vi.fn(() => of(void 0)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: UserService, useValue: service },
        { provide: AlertService, useValue: alert },
        {
          provide: AuthService,
          useValue: {
            canWriteUsers: () => opts.canWrite ?? true,
            isSuperAdmin: () => opts.superAdmin ?? false,
          },
        },
        { provide: ActivatedRoute, useValue: stubRoute(opts.id === null ? {} : { id: opts.id ?? 'u1' }) },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(UserDetailsComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('loads and renders the user with role label', () => {
    setup();
    expect(service['getUserById']).toHaveBeenCalledWith('u1');
    expect(c.user()).toEqual(ACTIVE);
    expect(c.currentImageUrl()).toBe('http://img/a.png');
    expect(text()).toContain('Ann Lee');
    expect(text()).toContain('Item Manager');
    expect(text()).toContain('Edit');
    expect(text()).toContain('Delete');
  });

  it('does not load without an id', () => {
    setup({ id: null });
    expect(service['getUserById']).not.toHaveBeenCalled();
  });

  it('shows a spinner while loading', () => {
    setup({ get: new Subject<UserDto>() });
    expect(c.isLoading()).toBe(true);
    expect(fixture.nativeElement.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('alerts on load error', () => {
    setup({ get: throwError(() => new Error('missing')) });
    expect(alert.error).toHaveBeenCalledWith('missing');
    expect(c.isLoading()).toBe(false);
  });

  it('hides actions without write permission', () => {
    setup({ canWrite: false });
    expect(text()).not.toContain('Delete');
    expect(text()).not.toContain('Edit');
  });

  it('hides actions for super admin profiles when not super admin', () => {
    setup({ user: SUPER });
    expect(text()).not.toContain('Delete');
  });

  it('shows actions for super admin profiles to super admins', () => {
    setup({ user: SUPER, superAdmin: true });
    expect(text()).toContain('Delete');
    expect(text()).toContain('Super Admin');
  });

  it('inactive users show Restore', () => {
    setup({ user: INACTIVE });
    expect(text()).toContain('Restore');
    expect(text()).toContain('Inactive');
  });

  it('role label falls back to Unknown', () => {
    setup();
    expect(c.getRoleLabel({ ...ACTIVE, roleId: 99 })).toBe('Unknown');
  });

  it('goBack and navigateToEdit navigate', () => {
    setup();
    c.goBack();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/management/users');
    c.navigateToEdit();
    expect(router.navigateByUrl).toHaveBeenLastCalledWith(expect.stringContaining('u1'));
  });

  it('navigateToEdit is blocked for unauthorized or missing user', () => {
    setup({ user: SUPER });
    c.navigateToEdit();
    expect(alert.errorUnauthorized).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  describe('delete', () => {
    it('opens, cancels, confirms and navigates back', () => {
      setup();
      c.deleteUser();
      fixture.detectChanges();
      expect(c.showDeleteModal()).toBe(true);
      expect(text()).toContain('Delete User?');
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(false);

      c.deleteUser();
      c.confirmDelete();
      expect(service['deleteUser']).toHaveBeenCalledWith('u1');
      expect(alert.successDeleted).toHaveBeenCalledWith('User');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/management/users');
    });

    it('alerts on failure', () => {
      setup();
      service['deleteUser'].mockReturnValue(throwError(() => new Error('in use')));
      c.deleteUser();
      c.confirmDelete();
      expect(alert.error).toHaveBeenCalledWith('in use');
      expect(c.isDeleting()).toBe(false);
    });

    it('ignores cancel/confirm while deleting', () => {
      setup();
      service['deleteUser'].mockReturnValue(new Subject<void>());
      c.deleteUser();
      c.confirmDelete();
      c.confirmDelete();
      c.cancelDelete();
      expect(service['deleteUser']).toHaveBeenCalledTimes(1);
      expect(c.showDeleteModal()).toBe(true);
    });

    it('is blocked without permission', () => {
      setup({ canWrite: false });
      c.deleteUser();
      c.confirmDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(alert.errorUnauthorized).toHaveBeenCalledTimes(2);
      expect(service['deleteUser']).not.toHaveBeenCalled();
    });

    it('is blocked when no user is loaded', () => {
      setup({ id: null });
      c.deleteUser();
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(c.showDeleteModal()).toBe(false);
    });
  });

  describe('restore', () => {
    it('restores and reloads', () => {
      setup({ user: INACTIVE });
      c.restoreUser();
      fixture.detectChanges();
      expect(text()).toContain('Restore User?');
      c.confirmRestore();
      expect(service['restoreUser']).toHaveBeenCalledWith('u1');
      expect(alert.successRestored).toHaveBeenCalledWith('User');
      expect(service['getUserById']).toHaveBeenCalledTimes(2);
      expect(c.showRestoreModal()).toBe(false);
    });

    it('cancel closes the modal', () => {
      setup({ user: INACTIVE });
      c.restoreUser();
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(false);
    });

    it('alerts on failure', () => {
      setup({ user: INACTIVE });
      service['restoreUser'].mockReturnValue(throwError(() => new Error('bad')));
      c.restoreUser();
      c.confirmRestore();
      expect(alert.error).toHaveBeenCalledWith('bad');
      expect(c.isRestoring()).toBe(false);
    });

    it('ignores cancel/confirm while restoring', () => {
      setup({ user: INACTIVE });
      service['restoreUser'].mockReturnValue(new Subject<void>());
      c.restoreUser();
      c.confirmRestore();
      c.confirmRestore();
      c.cancelRestore();
      expect(service['restoreUser']).toHaveBeenCalledTimes(1);
      expect(c.showRestoreModal()).toBe(true);
    });

    it('is blocked without permission', () => {
      setup({ canWrite: false, user: INACTIVE });
      c.restoreUser();
      c.confirmRestore();
      expect(alert.errorUnauthorized).toHaveBeenCalledTimes(2);
      expect(service['restoreUser']).not.toHaveBeenCalled();
    });
  });
});
