import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { AppRoles } from '@shared/constants/app-roles';
import { Permissions, SystemRolePermissions } from '@shared/permissions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith } from '../../testing/service-testing';
import { AuthService } from './auth.service';
import { db } from './db';

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.sig`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const tokenFor = (roles: unknown, expiresInSeconds = 3600) =>
  makeToken({ exp: nowSeconds() + expiresInSeconds, role: roles });

describe('AuthService session', () => {
  const base = `${environment.apiUrl}/auth`;
  let http: HttpTestingController;

  function create(storedToken?: string, storedPermissions?: unknown): AuthService {
    localStorage.clear();
    if (storedToken) {
      localStorage.setItem('token', storedToken);
    }
    if (storedPermissions !== undefined) {
      localStorage.setItem('permissions', JSON.stringify(storedPermissions));
    }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(db.carts, 'clear').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('permissions from the server', () => {
    it('uses the plan-narrowed list the server sends instead of the role bundle', () => {
      const auth = create(tokenFor(AppRoles.Owner));
      expect(auth.can(Permissions.StockWrite)).toBe(true);

      auth.loadPermissions().subscribe();
      http.expectOne(`${base}/permissions`).flush(['orders.read', 'orders.write']);

      expect(auth.can(Permissions.OrdersWrite)).toBe(true);
      expect(auth.can(Permissions.StockWrite)).toBe(false);
      expect(JSON.parse(localStorage.getItem('permissions') ?? '[]')).toEqual(['orders.read', 'orders.write']);
    });

    it('keeps the stored list when the server cannot be reached, and clears it on logout', () => {
      const auth = create(tokenFor(AppRoles.Owner));
      auth.loadPermissions().subscribe();
      http.expectOne(`${base}/permissions`).flush(['orders.read']);

      const again = capture(auth.loadPermissions());
      failNetwork(http.expectOne(`${base}/permissions`));
      expect(again.value).toBe(false);
      expect(auth.can(Permissions.OrdersRead)).toBe(true);
      expect(auth.can(Permissions.StockWrite)).toBe(false);

      auth.logout();
      expect(localStorage.getItem('permissions')).toBeNull();
    });
  });

  describe('offline permission cache', () => {
    const customToken = makeToken({ exp: nowSeconds() + 3600, sub: 'user-1', role: 'Barista' });

    it('saves the list with the person it belongs to', () => {
      const auth = create(customToken);
      auth.loadPermissions().subscribe();
      http.expectOne(`${base}/permissions`).flush(['orders.read', 'orders.write']);

      const stored = JSON.parse(localStorage.getItem('permissions') ?? '{}');
      expect(stored.owner).toBe('user-1');
      expect(stored.keys).toEqual(['orders.read', 'orders.write']);
      expect(typeof stored.savedAt).toBe('string');
    });

    it('trusts the stored list at start-up with no connection, including for a custom role', () => {
      const stored = { owner: 'user-1', keys: ['orders.read', 'orders.write'], savedAt: new Date().toISOString() };
      const auth = create(customToken, stored);

      expect(auth.permissionsVersion()).toBe(1);
      expect(auth.can(Permissions.OrdersWrite)).toBe(true);
      expect(auth.can(Permissions.StockWrite)).toBe(false);
    });

    it('ignores a list stored for another person', () => {
      const stored = { owner: 'someone-else', keys: ['orders.read', 'orders.write'], savedAt: new Date().toISOString() };
      const auth = create(customToken, stored);

      expect(auth.permissionsVersion()).toBe(0);
      expect(auth.can(Permissions.OrdersWrite)).toBe(false);
    });

    it('replaces the stored list when the server answers with a changed role', () => {
      const stored = { owner: 'user-1', keys: ['orders.read', 'orders.write'], savedAt: new Date().toISOString() };
      const auth = create(customToken, stored);

      auth.loadPermissions().subscribe();
      http.expectOne(`${base}/permissions`).flush(['orders.read']);

      expect(auth.can(Permissions.OrdersWrite)).toBe(false);
      expect(JSON.parse(localStorage.getItem('permissions') ?? '{}').keys).toEqual(['orders.read']);
    });
  });

  describe('sign in as another person', () => {
    const signedInAs = (readOnly: boolean) =>
      makeToken({
        exp: nowSeconds() + 1800,
        sub: 'user-1',
        role: AppRoles.Owner,
        impersonated_by: 'admin-1',
        impersonation_read_only: readOnly ? '1' : '0',
      });

    it('keeps only the read keys of the role while the session is read-only', () => {
      const auth = create(signedInAs(true));

      expect(auth.can(Permissions.OrdersRead)).toBe(true);
      expect(auth.can(Permissions.OrdersWrite)).toBe(false);
      expect(auth.can(Permissions.RolesManage)).toBe(false);
      expect(auth.can(Permissions.UsersWrite)).toBe(false);
    });

    it('gives the whole role when writes are allowed', () => {
      const auth = create(signedInAs(false));

      expect(auth.can(Permissions.OrdersWrite)).toBe(true);
      expect(auth.can(Permissions.RolesManage)).toBe(true);
    });

    it('does not reuse a list stored for the same person outside the sign-in', () => {
      const stored = { owner: 'user-1', keys: ['orders.write'], savedAt: new Date().toISOString() };
      const auth = create(signedInAs(true), stored);

      expect(auth.can(Permissions.OrdersWrite)).toBe(false);
    });
  });

  describe('login', () => {
    it('loads the permission list before it reports success, so the landing page knows a custom role', () => {
      const auth = create();
      const result = capture(auth.login('al', 'pw'));
      http.expectOne(`${base}/login`).flush({ accessToken: makeToken({ exp: nowSeconds() + 3600, sub: 'u1', role: 'Barista' }), refreshToken: 'r1' });

      expect(result.value).toBeUndefined();
      http.expectOne(`${base}/permissions`).flush(['orders.read', 'orders.write']);

      expect(result.value).toBe(true);
      expect(auth.can(Permissions.OrdersWrite)).toBe(true);
    });

    it('still signs in when the permission list cannot be fetched', () => {
      const auth = create();
      const result = capture(auth.login('al', 'pw'));
      http.expectOne(`${base}/login`).flush({ accessToken: tokenFor(AppRoles.Cashier), refreshToken: 'r1' });
      failNetwork(http.expectOne(`${base}/permissions`));

      expect(result.value).toBe(true);
    });

    it.each([
      ['', 'pw'],
      ['user', ''],
    ])('rejects missing credentials (%j, %j) without calling the API', (user, pw) => {
      const auth = create();
      const result = capture(auth.login(user, pw));

      expect(result.error).toBe(ServiceErrorMessages.Auth.RequiredCredentials);
      http.expectNone(`${base}/login`);
    });

    it('stores tokens, flips state, loads roles and emits tokenRefreshed', () => {
      const auth = create();
      const refreshed = vi.fn();
      auth.tokenRefreshed$.subscribe(refreshed);
      const loggedIn: boolean[] = [];
      auth.isLoggedIn$.subscribe((v) => loggedIn.push(v));
      const roles: string[][] = [];
      auth.roles$.subscribe((r) => roles.push(r));
      const access = tokenFor(AppRoles.Cashier);

      const result = capture(auth.login('al', 'pw'));
      const req = http.expectOne(`${base}/login`);
      expect(req.request.body).toEqual({ username: 'al', password: 'pw' });
      req.flush({ accessToken: access, refreshToken: 'r1' });
      http.expectOne(`${base}/permissions`).flush(SystemRolePermissions[AppRoles.Cashier]);

      expect(result.value).toBe(true);
      expect(localStorage.getItem('token')).toBe(access);
      expect(localStorage.getItem('refreshToken')).toBe('r1');
      expect(loggedIn.at(-1)).toBe(true);
      expect(roles.at(-1)).toEqual([AppRoles.Cashier]);
      expect(refreshed).toHaveBeenCalledTimes(1);
    });

    it('clears the menu, images and cart when another shop signs in on the device, and remembers the new shop', () => {
      const clearCatalog = vi.spyOn(db.catalog, 'clear').mockResolvedValue(undefined as never);
      const clearImages = vi.spyOn(db.images, 'clear').mockResolvedValue(undefined as never);
      const auth = create();
      localStorage.setItem('wtf-device-tenant', 'aaaaaaaa-0000-0000-0000-000000000001');
      const access = makeToken({
        exp: nowSeconds() + 3600,
        role: AppRoles.Cashier,
        tenant_id: 'bbbbbbbb-0000-0000-0000-000000000002',
      });

      capture(auth.login('al', 'pw'));
      http.expectOne(`${base}/login`).flush({ accessToken: access, refreshToken: 'r1' });

      expect(db.carts.clear).toHaveBeenCalled();
      expect(clearCatalog).toHaveBeenCalled();
      expect(clearImages).toHaveBeenCalled();
      expect(localStorage.getItem('wtf-device-tenant')).toBe('bbbbbbbb-0000-0000-0000-000000000002');
    });

    it('keeps the local data when the same shop signs in again', () => {
      const clearCatalog = vi.spyOn(db.catalog, 'clear').mockResolvedValue(undefined as never);
      const auth = create();
      localStorage.setItem('wtf-device-tenant', 'bbbbbbbb-0000-0000-0000-000000000002');
      const access = makeToken({
        exp: nowSeconds() + 3600,
        role: AppRoles.Cashier,
        tenant_id: 'bbbbbbbb-0000-0000-0000-000000000002',
      });

      capture(auth.login('al', 'pw'));
      http.expectOne(`${base}/login`).flush({ accessToken: access, refreshToken: 'r1' });

      expect(clearCatalog).not.toHaveBeenCalled();
    });

    it('returns false when the response has no access token', () => {
      const auth = create();
      const result = capture(auth.login('al', 'pw'));

      http.expectOne(`${base}/login`).flush({});

      expect(result.value).toBe(false);
      expect(localStorage.getItem('token')).toBeNull();
    });

    it.each([
      [401, undefined, ServiceErrorMessages.Auth.InvalidCredentials],
      [400, undefined, ServiceErrorMessages.Auth.InvalidCredentials],
      [500, undefined, ServiceErrorMessages.Auth.ServerError],
      [503, undefined, ServiceErrorMessages.Auth.ServerError],
      [403, { message: 'Account disabled' }, 'Account disabled'],
      [403, undefined, ServiceErrorMessages.Auth.LoginFailed],
    ])('maps HTTP %i to the right message', (status, body, expected) => {
      const auth = create();
      const result = capture(auth.login('al', 'pw'));

      failWith(http.expectOne(`${base}/login`), status, body ?? null);

      expect(result.error).toBe(expected);
    });

    it('maps network loss', () => {
      const auth = create();
      const result = capture(auth.login('al', 'pw'));

      failNetwork(http.expectOne(`${base}/login`));

      expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
    });
  });

  describe('profile endpoints', () => {
    it('getMe maps 401, network loss and other failures', () => {
      const auth = create();
      const unauthorized = capture(auth.getMe());
      failWith(http.expectOne(`${base}/me`), 401);
      const network = capture(auth.getMe());
      failNetwork(http.expectOne(`${base}/me`));
      const other = capture(auth.getMe());
      failWith(http.expectOne(`${base}/me`), 500);

      expect(unauthorized.error).toBe(HttpErrorMessages.Unauthorized);
      expect(network.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(other.error).toBe(ServiceErrorMessages.Auth.FetchProfileFailed);
    });

    it('updateMe sends the password and maps errors', () => {
      const auth = create();
      auth.updateMe('new-pw', 'old-pw').subscribe();
      const ok = http.expectOne(`${base}/me`);
      expect(ok.request.method).toBe('PUT');
      expect(ok.request.body).toEqual({ password: 'new-pw', currentPassword: 'old-pw' });
      ok.flush(null);

      const unauthorized = capture(auth.updateMe('x', 'y'));
      failWith(http.expectOne(`${base}/me`), 401);
      const invalid = capture(auth.updateMe('x', 'y'));
      failWith(http.expectOne(`${base}/me`), 400);
      const network = capture(auth.updateMe('x', 'y'));
      failNetwork(http.expectOne(`${base}/me`));
      const other = capture(auth.updateMe('x', 'y'));
      failWith(http.expectOne(`${base}/me`), 500);

      expect(unauthorized.error).toBe(HttpErrorMessages.Unauthorized);
      expect(invalid.error).toBe(ServiceErrorMessages.Auth.InvalidPassword);
      expect(network.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(other.error).toBe(ServiceErrorMessages.Auth.UpdateProfileFailed);
    });

    it('uploadMeImage sends a multipart file and maps errors', () => {
      const auth = create();
      auth.uploadMeImage(new File(['x'], 'a.png')).subscribe();
      const ok = http.expectOne(`${base}/me/image`);
      expect(ok.request.method).toBe('PUT');
      expect((ok.request.body as FormData).get('file')).toBeInstanceOf(File);
      ok.flush({ imageUrl: 'u' });

      const file = new File(['x'], 'a.png');
      const bad = capture(auth.uploadMeImage(file));
      failWith(http.expectOne(`${base}/me/image`), 400);
      const unauthorized = capture(auth.uploadMeImage(file));
      failWith(http.expectOne(`${base}/me/image`), 401);
      const network = capture(auth.uploadMeImage(file));
      failNetwork(http.expectOne(`${base}/me/image`));
      const other = capture(auth.uploadMeImage(file));
      failWith(http.expectOne(`${base}/me/image`), 500);

      expect(bad.error).toBe(HttpErrorMessages.InvalidFile);
      expect(unauthorized.error).toBe(HttpErrorMessages.Unauthorized);
      expect(network.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(other.error).toBe(ServiceErrorMessages.Auth.UploadImageFailed);
    });

    it('notifyMeUpdated emits on meRefresh$', () => {
      const auth = create();
      const spy = vi.fn();
      auth.meRefresh$.subscribe(spy);

      auth.notifyMeUpdated();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('logout', () => {
    it('clears tokens, roles, login state and the persisted cart', () => {
      const auth = create(tokenFor(AppRoles.Admin));
      localStorage.setItem('refreshToken', 'r');
      const loggedIn: boolean[] = [];
      auth.isLoggedIn$.subscribe((v) => loggedIn.push(v));
      const roles: string[][] = [];
      auth.roles$.subscribe((r) => roles.push(r));

      auth.logout();

      expect(auth.getToken()).toBeNull();
      expect(auth.getRefreshToken()).toBeNull();
      expect(loggedIn.at(-1)).toBe(false);
      expect(roles.at(-1)).toEqual([]);
      expect(db.carts.clear).toHaveBeenCalled();
      expect(auth.isAuthenticated()).toBe(false);
    });
  });

  describe('token state', () => {
    it('is expired/invalid with no token', () => {
      const auth = create();

      expect(auth.isTokenExpired()).toBe(true);
      expect(auth.isTokenValid()).toBe(false);
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('a fresh token is valid and not expired', () => {
      const auth = create(tokenFor('Admin', 3600));

      expect(auth.isTokenValid()).toBe(true);
      expect(auth.isTokenExpired()).toBe(false);
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('treats a token inside the 5-minute window as expired but still valid', () => {
      const auth = create(tokenFor('Admin', 120));

      expect(auth.isTokenExpired()).toBe(true);
      expect(auth.isTokenValid()).toBe(true);
    });

    it('a past token is expired and invalid', () => {
      const auth = create(tokenFor('Admin', -10));

      expect(auth.isTokenExpired()).toBe(true);
      expect(auth.isTokenValid()).toBe(false);
    });

    it.each([
      ['garbage', 'not-a-jwt'],
      ['payload without exp', makeToken({ role: 'Admin' })],
      ['non-numeric exp', makeToken({ exp: 'soon' })],
    ])('%s is treated as invalid', (_label, token) => {
      const auth = create(token);

      expect(auth.isTokenExpired()).toBe(true);
      expect(auth.isTokenValid()).toBe(false);
    });
  });

  describe('refreshToken', () => {
    it('errors immediately when there is no refresh token', () => {
      const auth = create();
      const result = capture(auth.refreshToken());

      expect(result.error).toBe(ServiceErrorMessages.Auth.NoRefreshToken);
      http.expectNone(`${base}/refresh`);
    });

    it('logs out and reports failure when the refresh request fails', () => {
      const auth = create(tokenFor('Admin'));
      localStorage.setItem('refreshToken', 'r');
      const result = capture(auth.refreshToken());

      failWith(http.expectOne(`${base}/refresh`), 401);

      expect(result.error).toBe(ServiceErrorMessages.Auth.RefreshTokenFailed);
      expect(auth.getToken()).toBeNull();
    });

    it('allows a new refresh after the previous one completed', () => {
      const auth = create();
      localStorage.setItem('refreshToken', 'r');
      auth.refreshToken().subscribe();
      http.expectOne(`${base}/refresh`).flush({ accessToken: tokenFor('Admin') });

      auth.refreshToken().subscribe();

      http.expectOne(`${base}/refresh`).flush({ accessToken: tokenFor('Admin') });
    });

    it('reports false when the response has no access token', () => {
      const auth = create();
      localStorage.setItem('refreshToken', 'r');
      const result = capture(auth.refreshToken());

      http.expectOne(`${base}/refresh`).flush({});

      expect(result.value).toBe(false);
    });
  });

  describe('roles', () => {
    it.each([
      ['single string claim', 'Cashier', ['Cashier']],
      ['array claim', ['Admin', 'Cashier'], ['Admin', 'Cashier']],
      ['trims and drops blanks/non-strings', [' Admin ', '', 5, null], ['Admin']],
      ['dedupes', ['Admin', 'Admin'], ['Admin']],
    ])('reads %s', (_label, claim, expected) => {
      const auth = create(tokenFor(claim));
      let roles: string[] = [];
      auth.roles$.subscribe((r) => (roles = r));

      expect(roles).toEqual(expected);
    });

    it('reads the Microsoft role claim and the roles claim', () => {
      const token = makeToken({
        exp: nowSeconds() + 3600,
        roles: ['Cashier'],
        'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'Admin',
      });
      const auth = create(token);
      let roles: string[] = [];
      auth.roles$.subscribe((r) => (roles = r));

      expect(roles.sort()).toEqual(['Admin', 'Cashier']);
    });

    it('has no roles without a token or with a malformed one', () => {
      let roles: string[] = ['x'];
      create().roles$.subscribe((r) => (roles = r));
      expect(roles).toEqual([]);

      TestBed.resetTestingModule();
      create('garbage').roles$.subscribe((r) => (roles = r));
      expect(roles).toEqual([]);
    });

    it('matches roles case-insensitively and with spaced aliases', () => {
      expect(create(tokenFor('OWNER')).hasAnyRole([AppRoles.Owner])).toBe(true);
      TestBed.resetTestingModule();
      expect(create(tokenFor('owner')).hasAnyRole([AppRoles.Owner])).toBe(true);
      TestBed.resetTestingModule();
      expect(create(tokenFor('admin viewer')).hasAnyRole([AppRoles.AdminViewer])).toBe(true);
      TestBed.resetTestingModule();
      expect(create(tokenFor('Admin')).hasAnyRole([AppRoles.Cashier])).toBe(false);
    });

    it('hasAnyRole is false for an empty requirement', () => {
      expect(create(tokenFor('Admin')).hasAnyRole([])).toBe(false);
    });
  });

  describe('can and canAny', () => {
    it('answers from the permissions of the signed-in role', () => {
      const cashier = create(tokenFor('Cashier'));
      expect(cashier.can(Permissions.OrdersWrite)).toBe(true);
      expect(cashier.can(Permissions.ProductsRead)).toBe(false);
      expect(cashier.canAny([Permissions.ProductsRead, Permissions.OrdersWrite])).toBe(true);
      expect(cashier.canAny([Permissions.ProductsRead, Permissions.UsersRead])).toBe(false);
      expect(cashier.canAny([])).toBe(false);
    });

    it('no longer accepts the old SuperAdmin role name', () => {
      const legacy = create(tokenFor('SuperAdmin'));
      expect(legacy.can(Permissions.AuditRead)).toBe(false);
      expect(legacy.isOwner()).toBe(false);
    });

    it('gives nothing without a signed-in role', () => {
      expect(create('garbage').can(Permissions.OrdersRead)).toBe(false);
    });
  });

  describe('permission helpers', () => {
    type Check = (auth: AuthService) => boolean;
    const matrix: [string, Check, string[]][] = [
      ['canReadProducts', (a) => a.canReadProducts(), ['Owner', 'Admin', 'AdminViewer']],
      ['canWriteProducts', (a) => a.canWriteProducts(), ['Owner', 'Admin']],
      ['canReadUsers', (a) => a.canReadUsers(), ['Owner', 'Admin', 'AdminViewer']],
      ['canWriteUsers', (a) => a.canWriteUsers(), ['Owner', 'Admin']],
      ['canReadPromotions', (a) => a.canReadPromotions(), ['Owner', 'Admin', 'AdminViewer']],
      ['canWritePromotions', (a) => a.canWritePromotions(), ['Owner', 'Admin']],
      ['canReadCustomers', (a) => a.canReadCustomers(), ['Owner', 'Admin', 'AdminViewer']],
      ['canWriteCustomers', (a) => a.canWriteCustomers(), ['Owner', 'Admin', 'Cashier']],
      [
        'canCreateCustomerInOrder',
        (a) => a.canCreateCustomerInOrder(true),
        ['Owner', 'Admin', 'Cashier'],
      ],
      ['canAccessReports', (a) => a.canAccessReports(), ['Owner', 'Admin', 'AdminViewer']],
      ['canAccessAuditLogs', (a) => a.canAccessAuditLogs(), ['Owner']],
      ['isOwner', (a) => a.isOwner(), ['Owner']],
      ['canAccessSchemaScriptHistory', (a) => a.canAccessSchemaScriptHistory(), ['Owner']],
      [
        'canReadOrders',
        (a) => a.canReadOrders(),
        ['Owner', 'Admin', 'AdminViewer', 'Cashier'],
      ],
      ['canWriteOrders', (a) => a.canWriteOrders(), ['Owner', 'Admin', 'Cashier']],
      ['canOverrideOrders', (a) => a.canOverrideOrders(), ['Owner', 'Admin']],
      ['canGenerateReports', (a) => a.canGenerateReports(), ['Owner', 'Admin']],
      [
        'canReadItems',
        (a) => a.canReadItems(),
        ['Owner', 'Admin', 'AdminViewer', 'ItemManager', 'StockManager'],
      ],
      ['canWriteInventoryCosts', (a) => a.canWriteInventoryCosts(), ['Owner', 'Admin']],
      ['canWriteItems', (a) => a.canWriteItems(), ['Owner', 'Admin', 'ItemManager']],
      [
        'canReadStockMovements',
        (a) => a.canReadStockMovements(),
        ['Owner', 'Admin', 'AdminViewer', 'StockManager'],
      ],
      [
        'canWriteStockMovements',
        (a) => a.canWriteStockMovements(),
        ['Owner', 'Admin', 'StockManager'],
      ],
      [
        'canReadInventory',
        (a) => a.canReadInventory(),
        ['Owner', 'Admin', 'AdminViewer', 'ItemManager', 'StockManager'],
      ],
      [
        'canWriteInventory',
        (a) => a.canWriteInventory(),
        ['Owner', 'Admin', 'ItemManager', 'StockManager'],
      ],
      ['canReadManagement', (a) => a.canReadManagement(), ['Owner', 'Admin', 'AdminViewer']],
      ['canWriteManagement', (a) => a.canWriteManagement(), ['Owner', 'Admin', 'Cashier']],
    ];

    const allRoles = Object.values(AppRoles);

    it.each(matrix)('%s is granted exactly to its roles', (_name, check, allowed) => {
      for (const role of allRoles) {
        TestBed.resetTestingModule();
        const auth = create(tokenFor(role));
        expect(check(auth), `${role}`).toBe(allowed.includes(role));
      }
    });

    it('everything is denied without a token', () => {
      const auth = create();

      for (const [name, check] of matrix) {
        expect(check(auth), name).toBe(false);
      }
    });
  });

  describe('getCurrentRoleLabel', () => {
    it.each([
      [['Cashier', 'Admin'], 'Admin'],
      [['Admin', 'Owner'], 'Owner'],
      [['AdminViewer'], 'Admin Viewer'],
      [['ItemManager'], 'Item Manager'],
      [['StockManager'], 'Stock Manager'],
      [['Cashier'], 'Cashier'],
      [[], 'Unknown'],
      [['Stranger'], 'Unknown'],
    ])('roles %j -> %s', (roles, label) => {
      expect(create(tokenFor(roles)).getCurrentRoleLabel()).toBe(label);
    });
  });
});
