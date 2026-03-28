import { Component, inject } from '@angular/core';
import {
  IsActiveMatchOptions,
  Router,
  isActive as routerIsActive,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { AuthService } from '@core/services';
import { IconComponent } from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-management',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
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

}
