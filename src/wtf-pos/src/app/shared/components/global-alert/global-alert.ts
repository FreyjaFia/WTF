import { Component, inject } from '@angular/core';
import { AlertComponent } from '../alert/alert';
import { AlertService } from '@core/services';

@Component({
  selector: 'app-global-alert',
  imports: [AlertComponent],
  template: `
    @if (alertService.alert().visible) {
      <div class="fixed inset-x-0 top-4 z-9999 mx-auto w-[calc(100%-2rem)] max-w-sm md:inset-x-auto md:top-auto md:right-6 md:bottom-6 md:mx-0 md:w-full">
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
