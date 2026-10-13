import { Component } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';

/** Shown in place of a list that could not load because there is no connection to the server. */
@Component({
  selector: 'app-connection-error',
  imports: [IconComponent],
  template: `
    <div class="rounded-lg bg-white p-8 text-center shadow-lg" role="status" data-connection-error>
      <app-icon name="icon-cloud-off" [class]="'mx-auto mb-3 h-12 w-12 text-gray-400'" />
      <p class="text-lg font-semibold text-gray-700">
        Unable to connect to server. Please check your connection.
      </p>
      <p class="text-sm text-gray-500">Pull down to try again</p>
    </div>
  `,
})
export class ConnectionErrorComponent {}
