import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthLoadingService, AuthService, BrandService, ImageCacheService } from '@core/services';
import { BranchSwitcherComponent } from '@shared/components/branch-switcher/branch-switcher';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { NeedsAttentionButtonComponent } from '@shared/components/needs-attention-button/needs-attention-button';
import { NotificationBellComponent } from '@shared/components/notification-bell/notification-bell';
import { ProfileMenuComponent } from '@shared/components/profile-menu/profile-menu';
import { StaffEnvelopeComponent } from '@shared/components/staff-envelope/staff-envelope';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-header',
  imports: [
    AvatarComponent,
    BranchSwitcherComponent,
    NeedsAttentionButtonComponent,
    NotificationBellComponent,
    ProfileMenuComponent,
    StaffEnvelopeComponent,
  ],
  templateUrl: './header.html',
})
export class HeaderComponent implements OnInit, OnDestroy {
  private static readonly ME_CACHE_KEY = 'wtf_me_cache';

  protected readonly authService = inject(AuthService);
  protected readonly brand = inject(BrandService);
  protected readonly router = inject(Router);
  protected readonly routes = AppRoutes;
  private readonly imageCache = inject(ImageCacheService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly authLoading = inject(AuthLoadingService);

  protected imageUrl: string | null = null;
  protected userFullName = 'User';
  protected userRoleLabel = 'Unknown';
  private routeSubscription?: { unsubscribe: () => void };
  private meRefreshSubscription?: { unsubscribe: () => void };

  public ngOnInit(): void {
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
    this.routeSubscription?.unsubscribe();
    this.meRefreshSubscription?.unsubscribe();
  }

  protected goToMyProfile(event?: Event): void {
    event?.preventDefault();
    this.closeDropdownFocus();
    this.router.navigateByUrl(this.routes.MyProfile);
  }

  protected logout(): void {
    this.authService.logout();
    this.router.navigateByUrl(this.routes.Login, { replaceUrl: true });
  }

  private loadMe(): void {
    this.authLoading.setLoadingProfile(true);
    this.authService.getMe().subscribe({
      next: async (me) => {
        await this.applyProfile(me.imageUrl ?? null, me.firstName, me.lastName);
        localStorage.setItem(HeaderComponent.ME_CACHE_KEY, JSON.stringify(me));

        if (me.imageUrl) {
          this.imageCache.cacheUrl(me.imageUrl);
        }

        this.authLoading.setLoadingProfile(false);
      },
      error: async () => {
        await this.loadCachedProfile();
        this.authLoading.setLoadingProfile(false);
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
    // The app is zoneless and these are plain fields, so tell Angular the view changed.
    this.changeDetector.markForCheck();
  }

  private closeDropdownFocus(): void {
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement) {
      activeEl.blur();
    }
  }
}
