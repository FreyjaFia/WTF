import { Component, input } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';

/** Shown in place of a list on the customer page while there is no connection, so no old list is left on screen. */
@Component({
  selector: 'app-public-offline-notice',
  imports: [IconComponent],
  template: `
    <div
      class="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center"
      role="status"
      data-offline-notice
    >
      <app-icon name="icon-cloud-off" [class]="'h-12 w-12 text-gray-400'" [fill]="'currentColor'" />
      <p class="text-base font-semibold text-gray-800">You're offline</p>
      <p class="text-sm text-gray-500">{{ message() }}</p>
    </div>
  `,
})
export class PublicOfflineNoticeComponent {
  public readonly message = input('Reconnect to see the latest.');
}
