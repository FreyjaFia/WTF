import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterModule } from '@angular/router';
import { AuthService, StockAlertService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';
import { ordersNavSection } from '@shared/utils/orders-nav';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-dock',
  imports: [CommonModule, IconComponent, RouterLink, RouterModule],
  templateUrl: './dock.html',
})
export class DockComponent {
  protected readonly auth = inject(AuthService);
  protected readonly routes = AppRoutes;
  protected readonly stockAlerts = inject(StockAlertService);
  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** Orders stays lit while an order is open; New Order only for a blank editor. */
  protected readonly ordersSection = computed(() => ordersNavSection(this.currentUrl()));

  public constructor() {
    if (this.auth.canReadStockMovements()) {
      this.stockAlerts.refresh();
    }
  }
}
