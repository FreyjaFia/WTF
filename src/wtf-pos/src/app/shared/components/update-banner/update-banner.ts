import { Component, inject } from '@angular/core';
import { UpdateService } from '@core/services';

@Component({
  selector: 'app-update-banner',
  standalone: true,
  templateUrl: './update-banner.html',
})
export class UpdateBannerComponent {
  protected readonly update = inject(UpdateService);

  protected onDownload(): void {
    void this.update.openDownload();
  }

  protected onDismiss(): void {
    this.update.dismiss();
  }
}
