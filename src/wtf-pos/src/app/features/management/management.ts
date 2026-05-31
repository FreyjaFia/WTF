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

interface ManagementTab {
  label: string;
  route: string;
  path: string;
  ariaLabel: string;
  canShow?: () => boolean;
}

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
  protected readonly managementTabs: readonly ManagementTab[] = [
    {
      label: 'Products',
      route: 'products',
      path: AppRoutes.ManagementProducts,
      ariaLabel: 'Products',
    },
    {
      label: 'Customers',
      route: 'customers',
      path: AppRoutes.ManagementCustomers,
      ariaLabel: 'Customers',
      canShow: () => this.canReadCustomers(),
    },
    { label: 'Users', route: 'users', path: AppRoutes.ManagementUsers, ariaLabel: 'Users' },
    {
      label: 'Promos',
      route: 'promotions',
      path: AppRoutes.ManagementPromotions,
      ariaLabel: 'Promotions',
    },
    {
      label: 'Reports',
      route: 'reports',
      path: AppRoutes.ManagementReports,
      ariaLabel: 'Reports',
      canShow: () => this.canAccessReports(),
    },
    {
      label: 'Audit',
      route: 'audit-logs',
      path: AppRoutes.ManagementAuditLogs,
      ariaLabel: 'Audit Logs',
      canShow: () => this.canAccessAuditLogs(),
    },
    {
      label: 'Schema',
      route: 'schema-scripts',
      path: AppRoutes.ManagementSchemaScripts,
      ariaLabel: 'Schema Scripts',
      canShow: () => this.canAccessSchemaScriptHistory(),
    },
  ];
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
    for (const tab of this.managementTabs) {
      if (this.isActive(tab.route)) {
        return tab.route;
      }
    }

    return null;
  }
}
