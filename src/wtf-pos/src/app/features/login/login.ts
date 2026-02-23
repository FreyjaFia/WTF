import { Component, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertService, AuthService } from '@core/services';
import { finalize, timeout } from 'rxjs/operators';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
})
export class Login implements OnInit {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly alertService = inject(AlertService);
  protected loading = false;
  protected showPassword = false;

  protected readonly currentYear = new Date().getFullYear();
  protected readonly loginForm = new FormGroup({
    username: new FormControl('', Validators.required),
    password: new FormControl('', Validators.required),
  });

  public ngOnInit(): void {
    this.checkExistingSession();
  }

  /**
   * Check if user has a valid token or refresh token on page load
   * If valid, redirect to home. If expired, try to refresh and redirect.
   */
  private checkExistingSession(): void {
    // Check if token is already valid
    if (this.auth.isTokenValid()) {
      this.router.navigateByUrl(this.getPostLoginRoute(), { replaceUrl: true });
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
              // Token refreshed successfully, redirect to home
              this.router.navigateByUrl(this.getPostLoginRoute(), { replaceUrl: true });
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
            this.router.navigateByUrl(this.getPostLoginRoute(), { replaceUrl: true });
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

  private getPostLoginRoute(): string {
    return this.auth.canAccessManagement() ? '/dashboard' : '/orders/editor';
  }
}
