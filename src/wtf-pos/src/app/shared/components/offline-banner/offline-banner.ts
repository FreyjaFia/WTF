import { Component, inject } from '@angular/core';
import { ConnectivityService } from '@core/services';
import { Icon } from '../icons/icon/icon';

@Component({
  selector: 'app-offline-banner',
  imports: [Icon],
  templateUrl: './offline-banner.html',
  standalone: true,
})
export class OfflineBannerComponent {
  protected readonly connectivity = inject(ConnectivityService);
}
