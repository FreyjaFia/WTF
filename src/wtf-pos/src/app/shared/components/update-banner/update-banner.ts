import { Component, inject } from '@angular/core';
import { UpdateService } from '@core/services';

@Component({
  selector: 'app-update-banner',
  standalone: true,
  templateUrl: './update-banner.html',
})
export class UpdateBannerComponent {
  protected readonly update = inject(UpdateService);

  protected onPrimaryAction(): void {
    void this.update.applyUpdate();
  }

  protected onDismiss(): void {
    this.update.dismiss();
  }

  protected getPrimaryActionLabel(): string {
    return this.update.shouldRefresh() ? 'Refresh' : 'Download';
  }
}
