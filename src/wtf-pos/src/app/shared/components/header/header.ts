import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthService, ConnectivityService, ImageCacheService } from '@core/services';
import { appVersion } from '@environments/version';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { IconComponent } from '@shared/components/icons/icon/icon';

@Component({
  selector: 'app-header',
  imports: [CommonModule, AvatarComponent, IconComponent],
  templateUrl: './header.html',
})
export class HeaderComponent implements OnInit, OnDestroy {
  private static readonly ME_CACHE_KEY = 'wtf_me_cache';

  protected readonly authService = inject(AuthService);
  protected readonly router = inject(Router);
  private readonly connectivity = inject(ConnectivityService);
  private readonly imageCache = inject(ImageCacheService);

  protected imageUrl: string | null = null;
  protected userFullName = 'User';
  protected userRoleLabel = 'Unknown';
  protected readonly isLoadingMe = signal(true);
  protected readonly now = signal(new Date());
  protected readonly appVersion = appVersion;
  protected readonly isOnline = this.connectivity.isOnline;
  private clockIntervalId: ReturnType<typeof setInterval> | null = null;
  private routeSubscription?: { unsubscribe: () => void };
  private meRefreshSubscription?: { unsubscribe: () => void };

  public ngOnInit(): void {
    this.clockIntervalId = setInterval(() => {
      this.now.set(new Date());
    }, 1000);
    this.routeSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.closeDropdownFocus();
      }
    });
    this.meRefreshSubscription = this.authService.meRefresh$.subscribe(() => {
      this.loadMe();
    });

    this.loadMe();
  }

  public ngOnDestroy(): void {
    if (this.clockIntervalId) {
      clearInterval(this.clockIntervalId);
      this.clockIntervalId = null;
    }
    this.routeSubscription?.unsubscribe();
    this.meRefreshSubscription?.unsubscribe();
  }

  protected goToMyProfile(event?: Event): void {
    event?.preventDefault();
    this.closeDropdownFocus();
    this.router.navigateByUrl('/my-profile');
  }

  protected logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  private loadMe(): void {
    this.isLoadingMe.set(true);
    this.authService.getMe().subscribe({
      next: async (me) => {
        await this.applyProfile(me.imageUrl ?? null, me.firstName, me.lastName);
        localStorage.setItem(HeaderComponent.ME_CACHE_KEY, JSON.stringify(me));

        if (me.imageUrl) {
          this.imageCache.cacheUrl(me.imageUrl);
        }

        this.isLoadingMe.set(false);
      },
      error: async () => {
        await this.loadCachedProfile();
        this.isLoadingMe.set(false);
      },
    });
  }

  private async loadCachedProfile(): Promise<void> {
    try {
      const raw = localStorage.getItem(HeaderComponent.ME_CACHE_KEY);

      if (raw) {
        const me = JSON.parse(raw);
        await this.applyProfile(me.imageUrl ?? null, me.firstName, me.lastName);
        return;
      }
    } catch {
      // Corrupted cache — ignore
    }

    this.imageUrl = null;
    this.userFullName = 'User';
    this.userRoleLabel = this.authService.getCurrentRoleLabel();
  }

  private async applyProfile(
    imgUrl: string | null,
    firstName: string,
    lastName: string,
  ): Promise<void> {
    this.userFullName = `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'User';
    this.userRoleLabel = this.authService.getCurrentRoleLabel();
    this.imageUrl = imgUrl ? await this.imageCache.resolveUrl(imgUrl) : null;
  }

  private closeDropdownFocus(): void {
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement) {
      activeEl.blur();
    }
  }
}
