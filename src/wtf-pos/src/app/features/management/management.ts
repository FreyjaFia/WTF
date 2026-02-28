import { Component, inject, OnInit, signal } from '@angular/core';
import {
  IsActiveMatchOptions,
  Router,
  isActive as routerIsActive,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { AuthService, ListStateService } from '@core/services';
import { IconComponent } from '@shared/components';

@Component({
  selector: 'app-management',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './management.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ManagementComponent implements OnInit {
  private static readonly activeMatchOptions: IsActiveMatchOptions = {
    paths: 'subset',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  };

  private readonly router = inject(Router);
  private readonly listState = inject(ListStateService);
  protected readonly authService = inject(AuthService);
  protected readonly isSidebarCollapsed = signal(false);
  private readonly activeSignals = new Map<string, ReturnType<typeof routerIsActive>>();

  public ngOnInit(): void {
    this.isSidebarCollapsed.set(
      this.listState.load<boolean>('management:sidebar-collapsed', false),
    );
  }

  protected isActive(route: string): boolean {
    let routeActiveSignal = this.activeSignals.get(route);
    if (!routeActiveSignal) {
      const routeTree = this.router.createUrlTree(['/management', route]);
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

  protected toggleSidebar() {
    const next = !this.isSidebarCollapsed();
    this.isSidebarCollapsed.set(next);
    this.listState.save('management:sidebar-collapsed', next);
  }
}
