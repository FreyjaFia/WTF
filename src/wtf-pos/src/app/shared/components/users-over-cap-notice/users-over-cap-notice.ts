import { Component, computed, inject } from '@angular/core';
import { SubscriptionService } from '@core/services';

@Component({
  selector: 'app-users-over-cap-notice',
  templateUrl: './users-over-cap-notice.html',
})
export class UsersOverCapNoticeComponent {
  protected readonly subscription = inject(SubscriptionService);

  protected readonly message = computed(() => {
    const over = this.subscription.usersOverCap();
    const max = this.subscription.maxUsers();

    return `Your plan allows ${max} active user${max === 1 ? '' : 's'} and ${this.subscription.activeUsers()} are active. Deactivate ${over} user${over === 1 ? '' : 's'} or move to a bigger plan to add more.`;
  });
}
