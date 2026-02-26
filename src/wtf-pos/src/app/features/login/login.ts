import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertService, AuthService, ModalStackService, OfflineOrderService } from '@core/services';
import { appVersion } from '@environments/version';
import { IconComponent } from '@shared/components';
import { finalize, timeout } from 'rxjs/operators';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, IconComponent],
  templateUrl: './login.html',
})
export class Login implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly alertService = inject(AlertService);
  private readonly offlineOrderService = inject(OfflineOrderService);
  private readonly modalStack = inject(ModalStackService);

  protected loading = false;
  protected showPassword = false;
  protected readonly showPendingSyncModal = signal(false);
  protected readonly pendingSyncCount = signal(0);

  protected readonly currentYear = new Date().getFullYear();
  protected readonly appVersion = appVersion;
  protected readonly loginForm = new FormGroup({
    username: new FormControl('', Validators.required),
    password: new FormControl('', Validators.required),
  });

  private pendingSyncModalStackId: number | null = null;
  private pendingDefaultRoute = '/orders/editor';
  private checkingPendingAfterLogin = false;

  public ngOnInit(): void {
    this.checkExistingSession();
  }

  public ngOnDestroy(): void {
    this.closePendingSyncModal();
  }

  private checkExistingSession(): void {
    // Check if token is already valid
    if (this.auth.isTokenValid()) {
      void this.routeAfterSuccessfulAuth();
      return;
    }

    // Check if we have a refresh token and try to refresh
    const refreshToken = this.auth.getRefreshToken();

    if (refreshToken) {
      this.auth
        .refreshToken()
        .pipe(timeout(30000))
        .subscribe({
          next: (ok) => {
            if (ok) {
              // Token refreshed successfully
              void this.routeAfterSuccessfulAuth();
            }
          },
          error: () => {
            // Refresh failed or expired, stay on login
          },
        });
    }
  }

  protected login(): void {
    const { username, password } = this.loginForm.value;

    this.loading = true;

    this.auth
      .login(username!, password!)
      .pipe(
        timeout(30000),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: (ok) => {
          if (ok) {
            void this.routeAfterSuccessfulAuth();
          } else {
            this.alertService.error('Login failed. Invalid response from server.');
          }
        },
        error: (err) => {
          if (err.name === 'TimeoutError') {
            this.alertService.error('Login request timed out. Please try again.');
          } else {
            this.alertService.error(err.message || 'Login failed. Please try again.');
          }
        },
      });
  }

  protected togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  protected goToOrderList(): void {
    this.closePendingSyncModal();
    void this.router.navigateByUrl('/orders/list', { replaceUrl: true });
  }

  protected dismissPendingSyncReminder(): void {
    const defaultRoute = this.pendingDefaultRoute;
    this.closePendingSyncModal();
    void this.router.navigateByUrl(defaultRoute, { replaceUrl: true });
  }

  private async routeAfterSuccessfulAuth(): Promise<void> {
    if (this.checkingPendingAfterLogin) {
      return;
    }

    this.checkingPendingAfterLogin = true;

    try {
      const defaultRoute = this.getPostLoginRoute();
      this.pendingDefaultRoute = defaultRoute;
      const pendingCount = await this.offlineOrderService.getPendingSyncCount();

      if (pendingCount > 0) {
        this.pendingSyncCount.set(pendingCount);
        this.openPendingSyncModal();
        return;
      }

      await this.router.navigateByUrl(defaultRoute, { replaceUrl: true });
    } finally {
      this.checkingPendingAfterLogin = false;
    }
  }

  private openPendingSyncModal(): void {
    this.showPendingSyncModal.set(true);

    if (this.pendingSyncModalStackId === null) {
      this.pendingSyncModalStackId = this.modalStack.push(() => this.dismissPendingSyncReminder());
    }
  }

  private closePendingSyncModal(): void {
    this.showPendingSyncModal.set(false);

    if (this.pendingSyncModalStackId !== null) {
      this.modalStack.remove(this.pendingSyncModalStackId);
      this.pendingSyncModalStackId = null;
    }
  }

  private getPostLoginRoute(): string {
    return this.auth.canAccessManagement() ? '/dashboard' : '/orders/editor';
  }
}
