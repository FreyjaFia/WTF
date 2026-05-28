import { Component, effect, inject } from '@angular/core';
import {
  IsActiveMatchOptions,
  Router,
  isActive as routerIsActive,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-management',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './management.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ManagementComponent {
  private static readonly activeMatchOptions: IsActiveMatchOptions = {
    paths: 'subset',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  };

  private readonly router = inject(Router);
  protected readonly authService = inject(AuthService);
  protected readonly routes = AppRoutes;
  private readonly activeSignals = new Map<string, ReturnType<typeof routerIsActive>>();

  public constructor() {
    effect(() => {
      const activeRoute = this.getActiveManagementRoute();
      if (activeRoute) {
        this.scrollManagementTabIntoView(activeRoute);
      }
    });
  }

  protected isActive(route: string): boolean {
    let routeActiveSignal = this.activeSignals.get(route);
    if (!routeActiveSignal) {
      const routeTree = this.router.createUrlTree([AppRoutes.ManagementRoot, route]);
      routeActiveSignal = routerIsActive(
        routeTree,
        this.router,
        ManagementComponent.activeMatchOptions,
      );
      this.activeSignals.set(route, routeActiveSignal);
    }

    return routeActiveSignal();
  }

  protected canReadCustomers(): boolean {
    return this.authService.canReadCustomers();
  }

  protected canAccessAuditLogs(): boolean {
    return this.authService.canAccessAuditLogs();
  }

  protected canAccessReports(): boolean {
    return this.authService.canAccessReports();
  }

  protected canAccessSchemaScriptHistory(): boolean {
    return this.authService.canAccessSchemaScriptHistory();
  }

  protected scrollManagementTabIntoView(route: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.setTimeout(() => {
      const tab = document.querySelector(`[data-management-tab="${route}"]`);
      if (!(tab instanceof HTMLElement)) {
        return;
      }

      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }

  private getActiveManagementRoute(): string | null {
    for (const route of [
      'products',
      'customers',
      'users',
      'promotions',
      'reports',
      'audit-logs',
      'schema-scripts',
    ]) {
      if (this.isActive(route)) {
        return route;
      }
    }

    return null;
  }
}
