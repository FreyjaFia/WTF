import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { AuthLoadingService } from '@core/services';

@Component({
  selector: 'app-auth-loading-overlay',
  imports: [CommonModule],
  templateUrl: './auth-loading-overlay.html',
})
export class AuthLoadingOverlayComponent {
  private readonly authLoading = inject(AuthLoadingService);

  protected readonly isVisible = computed(
    () => this.authLoading.checkingSession() || this.authLoading.loadingProfile(),
  );

  protected readonly message = computed(() => {
    if (this.authLoading.checkingSession()) {
      return 'Checking session...';
    }

    if (this.authLoading.loadingProfile()) {
      return 'Loading profile...';
    }

    return '';
  });
}
