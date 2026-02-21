import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, ListStateService } from '@core/services';
import { Icon } from '@shared/components';

@Component({
  selector: 'app-management',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './management.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ManagementComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly listState = inject(ListStateService);
  protected readonly authService = inject(AuthService);
  protected readonly isSidebarCollapsed = signal(false);

  public ngOnInit(): void {
    this.isSidebarCollapsed.set(this.listState.load<boolean>('management:sidebar-collapsed', false));
  }

  protected isActive(route: string): boolean {
    return this.router.url.includes(route);
  }

  protected canReadCustomers(): boolean {
    return this.authService.canReadCustomers();
  }

  protected toggleSidebar() {
    const next = !this.isSidebarCollapsed();
    this.isSidebarCollapsed.set(next);
    this.listState.save('management:sidebar-collapsed', next);
  }
}
