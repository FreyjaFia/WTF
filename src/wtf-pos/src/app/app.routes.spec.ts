import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { authGuard } from '@core/guards/auth.guard';
import { loginGuard } from '@core/guards/login.guard';
import { roleGuard } from '@core/guards/role.guard';
import { unsavedChangesGuard } from '@core/guards/unsaved-changes.guard';
import { AuthService } from '@core/services';
import { NotFoundComponent } from '@features/not-found/not-found';
import { PublicOrderComponent } from '@features/public-order/public-order';
import { AppRoleGroups, AppRoles } from '@shared/constants/app-roles';
import { Permissions, SystemRolePermissions } from '@shared/permissions';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

interface FlatRoute {
  fullPath: string;
  route: Route;
  parent: Route | null;
}

function flatten(list: Route[], prefix = '', parent: Route | null = null): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const route of list) {
    const segment = route.path ?? '';
    const fullPath = [prefix, segment].filter(Boolean).join('/');
    out.push({ fullPath, route, parent });
    if (route.children) {
      out.push(...flatten(route.children, fullPath, route));
    }
  }
  return out;
}

const validRoles = new Set<string>(Object.values(AppRoles));
const validPermissions = new Set<string>(Object.values(Permissions));

function rolesAllowedBy(route: Route): string[] {
  const permission = route.data?.['permission'] as string | undefined;
  const roles = route.data?.['roles'] as string[] | undefined;

  return Object.values(AppRoles).filter(
    (role) =>
      (!permission || (SystemRolePermissions[role] as readonly string[]).includes(permission)) &&
      (!roles || roles.includes(role)),
  );
}
const flat = flatten(routes);

describe('app.routes', () => {
  it('redirects the empty path to login with full matching', () => {
    expect(routes[0]).toMatchObject({ path: '', redirectTo: 'login', pathMatch: 'full' });
  });

  it('guards login with loginGuard and the layout shell with authGuard', () => {
    const login = routes.find((r) => r.path === 'login');
    expect(login?.canActivate).toEqual([loginGuard]);
    const shell = routes.find((r) => r.path === '' && r.component);
    expect(shell?.canActivate).toEqual([authGuard]);
    expect(shell?.children?.length).toBeGreaterThan(0);
  });

  it('serves the public ordering page without any guard, between login and the layout shell', () => {
    const index = routes.findIndex((r) => r.path === 'shop/:token');
    expect(index).toBeGreaterThan(routes.findIndex((r) => r.path === 'login'));
    expect(index).toBeLessThan(routes.findIndex((r) => r.path === '' && r.component));
    const route = routes[index];
    expect(route.component).toBe(PublicOrderComponent);
    expect(route.children?.map((child) => child.path)).toEqual(['', 'orders', 'orders/:id']);
    expect(route.canActivate).toBeUndefined();
    expect(route.canActivate ?? []).not.toContain(authGuard);
  });

  it('keeps old /order links working by redirecting them to /shop', () => {
    const legacy = routes.find((r) => r.path === 'order/:token');
    expect(legacy?.redirectTo).toBe('shop/:token');
    expect(legacy?.canActivate).toBeUndefined();
  });

  it('ends with a wildcard route rendering NotFound', () => {
    const last = routes[routes.length - 1];
    expect(last.path).toBe('**');
    expect(last.component).toBe(NotFoundComponent);
  });

  it('has no duplicate sibling paths at any level', () => {
    const check = (list: Route[], where: string): void => {
      const seen = new Set<string>();
      for (const route of list) {
        const path = route.path ?? '';
        const key = route.component ? `${path}#component` : path;
        // Top-level '' appears twice (redirect + layout shell); distinguish by redirect.
        const id = route.redirectTo !== undefined ? `${path}#redirect` : key;
        expect(seen.has(id), `duplicate "${path}" under ${where}`).toBe(false);
        seen.add(id);
        if (route.children) {
          check(route.children, `${where}/${path}`);
        }
      }
    };
    check(routes, '');
  });

  it('gives every route either a component, a redirect or children', () => {
    for (const { fullPath, route } of flat) {
      const ok = !!route.component || route.redirectTo !== undefined || !!route.children;
      expect(ok, `route "${fullPath}" has no target`).toBe(true);
    }
  });

  it('uses full path matching on every redirect', () => {
    for (const { fullPath, route } of flat.filter((f) => f.route.redirectTo !== undefined)) {
      expect(route.pathMatch, `redirect "${fullPath}"`).toBe('full');
    }
  });

  it('only uses valid AppRoles and permission keys in route data, never an empty list', () => {
    const withRoles = flat.filter((f) => f.route.data?.['roles'] !== undefined);
    expect(withRoles.length).toBeGreaterThanOrEqual(2);
    for (const { fullPath, route } of withRoles) {
      const roles = route.data!['roles'] as string[];
      expect(roles.length, `roles of "${fullPath}"`).toBeGreaterThan(0);
      for (const role of roles) {
        expect(validRoles.has(role), `"${role}" on "${fullPath}"`).toBe(true);
      }
    }

    const withPermission = flat.filter((f) => f.route.data?.['permission'] !== undefined);
    expect(withPermission.length).toBeGreaterThan(10);
    for (const { fullPath, route } of withPermission) {
      expect(validPermissions.has(route.data!['permission'] as string), `permission on "${fullPath}"`).toBe(true);
    }
  });

  it('declares a permission or role list on every route that uses roleGuard', () => {
    const guarded = flat.filter((f) => f.route.canActivate?.includes(roleGuard));
    expect(guarded.length).toBeGreaterThan(10);
    for (const { fullPath, route } of guarded) {
      const roles = route.data?.['roles'] as string[] | undefined;
      const permission = route.data?.['permission'] as string | undefined;
      expect(!!permission || (roles?.length ?? 0) > 0, `roleGuard without access data on "${fullPath}"`).toBe(true);
    }
  });

  it('protects every editor route with unsavedChangesGuard and a write role guard', () => {
    const editors = flat.filter((f) => f.route.canDeactivate?.includes(unsavedChangesGuard));
    expect(editors.length).toBeGreaterThan(8);
    for (const { fullPath, route } of editors) {
      if (route.data?.['isProfile']) {
        continue;
      }
      expect(route.canActivate, `editor "${fullPath}"`).toContain(roleGuard);
    }
  });

  it('restricts every new/edit/editor route to roles that do not include read-only AdminViewer', () => {
    const writes = flat.filter(({ route }) =>
      /^(new|edit\/|editor|.*\/edit$)/.test(route.path ?? ''),
    );
    expect(writes.length).toBeGreaterThan(8);
    for (const { fullPath, route } of writes) {
      const permission = route.data?.['permission'] as string | undefined;
      expect(permission, `write route "${fullPath}"`).toBeDefined();
      expect(rolesAllowedBy(route), `write route "${fullPath}"`).not.toContain(AppRoles.AdminViewer);
    }
  });

  it('restricts audit logs and schema scripts to Owner only', () => {
    for (const path of ['audit-logs', 'schema-scripts']) {
      const entry = flat.find((f) => f.fullPath.endsWith(`management/${path}`));
      expect(entry && rolesAllowedBy(entry.route)).toEqual([AppRoles.Owner]);
    }
  });

  it('guards the whole Management section with ManagementMenu, on top of each area', () => {
    const section = flat.find((f) => f.fullPath === 'management' && f.route.component);
    expect(section?.route.canActivate).toEqual([roleGuard]);
    expect(section?.route.data?.['roles']).toEqual(AppRoleGroups.ManagementMenu);
    expect(AppRoleGroups.ManagementMenu).not.toContain(AppRoles.Cashier);
  });

  it('keeps the dashboard unavailable to cashiers', () => {
    const entry = flat.find((f) => f.fullPath === 'dashboard');
    expect(entry && rolesAllowedBy(entry.route)).not.toContain(AppRoles.Cashier);
  });

  it('marks my-profile as a profile editor reachable without a role restriction', () => {
    const entry = flat.find((f) => f.fullPath === 'my-profile');
    expect(entry?.route.data).toEqual({ isProfile: true });
    expect(entry?.route.canActivate).toBeUndefined();
  });

  it('redirects section roots to their default child', () => {
    const expectRedirect = (path: string, to: string): void => {
      const entry = flat.find((f) => f.fullPath === path && f.route.redirectTo !== undefined);
      expect(entry?.route.redirectTo).toBe(to);
    };
    expectRedirect('orders', 'list');
    expectRedirect('inventory', 'items');
  });

  it('sends the Management root to Products, or to Setup for a role without product access', () => {
    const entry = flat.find((f) => f.fullPath === 'management' && f.route.redirectTo !== undefined);
    const redirect = entry?.route.redirectTo as () => string;
    const resolve = (canReadProducts: boolean): string => {
      TestBed.configureTestingModule({
        providers: [{ provide: AuthService, useValue: { canReadProducts: () => canReadProducts } }],
      });
      return TestBed.runInInjectionContext(redirect);
    };

    expect(resolve(true)).toBe('products');
    TestBed.resetTestingModule();
    expect(resolve(false)).toBe('setup');
  });
});
