import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthService } from '@core/services';
import { AvatarComponent } from '../avatar/avatar';
import { Icon } from '../icons/icon/icon';

@Component({
  selector: 'app-header',
  imports: [CommonModule, AvatarComponent, Icon],
  templateUrl: './header.html',
})
export class Header implements OnInit, OnDestroy {
  protected readonly authService = inject(AuthService);
  protected readonly router = inject(Router);

  protected imageUrl: string | null = null;
  protected userFullName = 'User';
  protected userRoleLabel = 'Unknown';
  protected readonly isLoadingMe = signal(true);
  protected readonly now = signal(new Date());
  protected readonly isOnline = signal(typeof navigator !== 'undefined' ? navigator.onLine : true);
  private clockIntervalId: ReturnType<typeof setInterval> | null = null;
  private routeSubscription?: { unsubscribe: () => void };
  private meRefreshSubscription?: { unsubscribe: () => void };
  private readonly onOnline = () => this.isOnline.set(true);
  private readonly onOffline = () => this.isOnline.set(false);

  public ngOnInit(): void {
    this.clockIntervalId = setInterval(() => {
      this.now.set(new Date());
    }, 1000);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
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
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
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
    this.router.navigateByUrl('/login');
  }

  private loadMe(): void {
    this.isLoadingMe.set(true);
    this.authService.getMe().subscribe({
      next: (me) => {
        this.imageUrl = me.imageUrl ?? null;
        this.userFullName = `${me.firstName ?? ''} ${me.lastName ?? ''}`.trim() || 'User';
        this.userRoleLabel = this.authService.getCurrentRoleLabel();
        this.isLoadingMe.set(false);
      },
      error: () => {
        this.imageUrl = null;
        this.userFullName = 'User';
        this.userRoleLabel = this.authService.getCurrentRoleLabel();
        this.isLoadingMe.set(false);
      },
    });
  }

  private closeDropdownFocus(): void {
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement) {
      activeEl.blur();
    }
  }
}
