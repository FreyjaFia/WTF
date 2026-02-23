import { Component, inject } from '@angular/core';
import { AlertComponent } from '../alert/alert';
import { AlertService } from '@core/services';

@Component({
  selector: 'app-global-alert',
  imports: [AlertComponent],
  templateUrl: './global-alert.html',
  standalone: true,
})
export class GlobalAlertComponent {
  protected readonly alertService = inject(AlertService);
}
