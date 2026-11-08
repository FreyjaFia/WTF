import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-shop',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shop.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ShopComponent {
  protected readonly authService = inject(AuthService);
  protected readonly brandingRoute = AppRoutes.ManagementShopBranding;
  protected readonly planRoute = AppRoutes.ManagementShopPlan;
}
