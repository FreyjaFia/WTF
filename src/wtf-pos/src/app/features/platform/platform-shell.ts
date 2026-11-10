import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PlatformService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ThemeSwitcherComponent } from '@shared/components/theme-switcher/theme-switcher';
import { AppRoutes } from '@shared/constants/app-routes';

interface PlatformNavItem {
  label: string;
  icon: string;
  link: string;
}

@Component({
  selector: 'app-platform-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, ThemeSwitcherComponent],
  templateUrl: './platform-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformShellComponent {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);

  protected readonly nav: PlatformNavItem[] = [
    { label: 'Overview', icon: 'icon-dashboard', link: AppRoutes.PlatformOverview },
    { label: 'Shops', icon: 'icon-coffee', link: AppRoutes.PlatformShops },
    { label: 'Plans', icon: 'icon-tag', link: AppRoutes.PlatformPlans },
    { label: 'Logs', icon: 'icon-audit-logs', link: AppRoutes.PlatformLog },
  ];

  protected signOut(): void {
    this.platform.logout();
    this.router.navigateByUrl(AppRoutes.PlatformLogin, { replaceUrl: true });
  }
}
