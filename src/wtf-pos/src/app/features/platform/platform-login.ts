import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { PlatformService } from '@core/services';
import { ThemeSwitcherComponent } from '@shared/components/theme-switcher/theme-switcher';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-platform-login',
  imports: [ReactiveFormsModule, ThemeSwitcherComponent],
  templateUrl: './platform-login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformLoginComponent {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected signIn(): void {
    if (this.form.invalid || this.loading()) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    const { username, password } = this.form.getRawValue();

    this.platform.login(username, password).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigateByUrl(AppRoutes.PlatformRoot, { replaceUrl: true });
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(
          PlatformService.messageOf(err, 'Wrong name or password, or too many tries. Wait a few minutes and try again.'),
        );
      },
    });
  }
}
