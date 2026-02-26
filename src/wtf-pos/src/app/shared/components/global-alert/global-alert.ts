import { Component, inject } from '@angular/core';
import { AlertService } from '@core/services';
import { AlertComponent } from '@shared/components/alert/alert';

@Component({
  selector: 'app-global-alert',
  imports: [AlertComponent],
  templateUrl: './global-alert.html',
  standalone: true,
})
export class GlobalAlertComponent {
  protected readonly alertService = inject(AlertService);
}
