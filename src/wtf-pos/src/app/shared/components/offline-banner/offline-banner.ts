import { Component, inject } from '@angular/core';
import { ConnectivityService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';

@Component({
  selector: 'app-offline-banner',
  imports: [IconComponent],
  templateUrl: './offline-banner.html',
  standalone: true,
})
export class OfflineBannerComponent {
  protected readonly connectivity = inject(ConnectivityService);
}
