import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

interface ShopCard {
  id: 'branding' | 'plan';
  label: string;
  description: string;
  route: string;
}

@Component({
  selector: 'app-shop',
  imports: [RouterLink],
  templateUrl: './shop.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ShopComponent {
  private readonly authService = inject(AuthService);

  protected readonly cards = computed<ShopCard[]>(() => {
    const cards: ShopCard[] = [];

    if (this.authService.canManageBrand()) {
      cards.push({
        id: 'branding',
        label: 'Branding',
        description: 'Name, logo, colour, contact details and receipt text.',
        route: AppRoutes.ManagementShopBranding,
      });
    }

    if (this.authService.canManageSubscription()) {
      cards.push({
        id: 'plan',
        label: 'Plan & billing',
        description: 'Your plan status, when it ends, and your invoices.',
        route: AppRoutes.ManagementShopPlan,
      });
    }

    return cards;
  });
}
