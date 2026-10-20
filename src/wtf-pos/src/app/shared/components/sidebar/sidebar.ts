import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  AuthLoadingService,
  AuthService,
  ConnectivityService,
  ImageCacheService,
  StockAlertService,
} from '@core/services';
import { appVersion } from '@environments/version';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { StaffEnvelopeComponent } from '@shared/components/staff-envelope/staff-envelope';
import { ThemeSwitcherComponent } from '@shared/components/theme-switcher/theme-switcher';
import { AppRoutes } from '@shared/constants/app-routes';
import { ordersNavSection } from '@shared/utils/orders-nav';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    AvatarComponent,
    IconComponent,
    ConfirmDialogComponent,
    StaffEnvelopeComponent,
    ThemeSwitcherComponent,
  ],
  templateUrl: './sidebar.html',
})
export class SidebarComponent implements OnInit, OnDestroy {
  private static readonly ME_CACHE_KEY = 'wtf_me_cache';

  protected readonly authService = inject(AuthService);
  protected readonly router = inject(Router);
  protected readonly routes = AppRoutes;
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** Orders stays lit while an order is open; New Order only for a blank editor. */
  protected readonly ordersSection = computed(() => ordersNavSection(this.currentUrl()));
  private readonly connectivity = inject(ConnectivityService);
  private readonly imageCache = inject(ImageCacheService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly authLoading = inject(AuthLoadingService);
  protected readonly stockAlerts = inject(StockAlertService);

  protected imageUrl: string | null = null;
  protected userFullName = 'User';
  protected userRoleLabel = 'Unknown';
  protected readonly now = signal(new Date());
  protected readonly appVersion = appVersion;
  protected readonly isOnline = this.connectivity.isOnline;
  protected readonly showManagement = signal(true);
  protected readonly showInventory = signal(true);
  protected readonly isCollapsed = signal(false);
  protected readonly showLogoutModal = signal(false);
  private clockIntervalId: ReturnType<typeof setInterval> | null = null;
  private routeSubscription?: { unsubscribe: () => void };
  private meRefreshSubscription?: { unsubscribe: () => void };

  public ngOnInit(): void {
    if (this.authService.canReadStockMovements()) {
      this.stockAlerts.refresh();
    }

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

  protected toggleManagement(): void {
    this.showManagement.update((open) => !open);
  }

  protected toggleInventory(): void {
    this.showInventory.update((open) => !open);
  }

  protected toggleSidebar(): void {
    this.isCollapsed.update((collapsed) => !collapsed);
  }

  protected goToMyProfile(event?: Event): void {
    event?.preventDefault();
    this.closeDropdownFocus();
    this.router.navigateByUrl(this.routes.MyProfile);
  }

  protected requestLogout(): void {
    this.showLogoutModal.set(true);
  }

  protected closeLogoutModal(): void {
    this.showLogoutModal.set(false);
  }

  protected confirmLogout(): void {
    this.showLogoutModal.set(false);
    this.authService.logout();
    this.router.navigateByUrl(this.routes.Login, { replaceUrl: true });
  }

  private loadMe(): void {
    this.authLoading.setLoadingProfile(true);
    this.authService.getMe().subscribe({
      next: async (me) => {
        await this.applyProfile(me.imageUrl ?? null, me.firstName, me.lastName);
        localStorage.setItem(SidebarComponent.ME_CACHE_KEY, JSON.stringify(me));

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
      const raw = localStorage.getItem(SidebarComponent.ME_CACHE_KEY);

      if (raw) {
        const me = JSON.parse(raw);
        await this.applyProfile(me.imageUrl ?? null, me.firstName, me.lastName);
        return;
      }
    } catch {
      // Corrupted cache - ignore
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
