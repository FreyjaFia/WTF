import { Component, inject } from '@angular/core';
import { ConnectivityService } from '@core/services';
import { Icon } from '@shared/components';

@Component({
  selector: 'app-offline-banner',
  imports: [Icon],
  templateUrl: './offline-banner.html',
  standalone: true,
})
export class OfflineBannerComponent {
  protected readonly connectivity = inject(ConnectivityService);
}
