import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, SubscriptionService } from '@core/services';
import { AppRoleGroups } from '@shared/constants/app-roles';

@Component({
  selector: 'app-subscription-banner',
  imports: [DatePipe, RouterLink],
  templateUrl: './subscription-banner.html',
  standalone: true,
})
export class SubscriptionBannerComponent {
  protected readonly subscription = inject(SubscriptionService);
  private readonly auth = inject(AuthService);

  protected readonly canRenew = computed(() => this.auth.hasAnyRole(AppRoleGroups.SubscriptionBilling));

  protected readonly message = computed(() => {
    const days = this.subscription.daysLeft();

    switch (this.subscription.warning()) {
      case 'soon':
      case 'lastDays':
        return days <= 1 ? 'Your subscription ends tomorrow.' : `Your subscription ends in ${days} days.`;
      case 'grace':
        return 'Your subscription has ended. The app will lock soon.';
      default:
        return '';
    }
  });

  protected readonly isUrgent = computed(() => ['lastDays', 'grace'].includes(this.subscription.warning()));

  protected checkAgain(): void {
    this.subscription.refresh();
  }

  protected logOut(): void {
    this.auth.logout();
  }
}
