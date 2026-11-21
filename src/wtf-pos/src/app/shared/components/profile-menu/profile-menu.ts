import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConnectivityService, ThemeService } from '@core/services';
import { appVersion } from '@environments/version';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-profile-menu',
  imports: [CommonModule, IconComponent],
  templateUrl: './profile-menu.html',
})
export class ProfileMenuComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly connectivity = inject(ConnectivityService);
  protected readonly themeService = inject(ThemeService);

  public readonly userFullName = input.required<string>();
  public readonly userRoleLabel = input.required<string>();
  public readonly align = input<'start' | 'end'>('end');
  public readonly logoutRequested = output<void>();

  protected readonly now = signal(new Date());
  protected readonly appVersion = appVersion;
  protected readonly isOnline = this.connectivity.isOnline;
  private clockIntervalId: ReturnType<typeof setInterval> | null = null;

  public ngOnInit(): void {
    this.clockIntervalId = setInterval(() => this.now.set(new Date()), 1000);
  }

  public ngOnDestroy(): void {
    if (this.clockIntervalId) {
      clearInterval(this.clockIntervalId);
      this.clockIntervalId = null;
    }
  }

  protected goToMyProfile(event?: Event): void {
    event?.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
    this.router.navigateByUrl(AppRoutes.MyProfile);
  }
}
