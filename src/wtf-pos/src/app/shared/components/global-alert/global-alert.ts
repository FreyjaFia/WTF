import { Component, inject } from '@angular/core';
import { AlertComponent } from '../alert/alert';
import { AlertService } from '@core/services';

@Component({
  selector: 'app-global-alert',
  imports: [AlertComponent],
  template: `
    @if (alertService.alert().visible) {
      <div class="fixed right-6 bottom-6 z-9999 w-full max-w-sm">
        <app-alert
          [type]="alertService.alert().type"
          [message]="alertService.alert().message"
          (dismissed)="alertService.dismiss()"
        />
      </div>
    }
  `,
  standalone: true,
})
export class GlobalAlertComponent {
  protected readonly alertService = inject(AlertService);
}
