import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, ConnectivityService, UnsyncedOrderService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';
import { UnsyncedOrderStatusEnum } from '@shared/models';

@Component({
  selector: 'app-unsynced-orders-banner',
  imports: [IconComponent, RouterLink],
  template: `
    @if (count() > 0) {
      <a
        class="mb-4 flex shrink-0 items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-left"
        data-unsynced-banner
        [routerLink]="unsyncedRoute"
      >
        <div
          class="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white"
        >
          {{ count() }}
        </div>
        <span class="text-sm font-semibold text-red-800">
          {{ count() === 1 ? 'unsynced order' : 'unsynced orders' }} could not be saved
        </span>
        <app-icon name="icon-chevron-down" [class]="'ml-auto h-4 w-4 -rotate-90 text-red-800'" [fill]="'currentColor'" />
      </a>
    }
  `,
})
export class UnsyncedOrdersBanner implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly unsynced = inject(UnsyncedOrderService);

  protected readonly unsyncedRoute = AppRoutes.OrdersUnsynced;
  protected readonly count = signal(0);

  public ngOnInit(): void {
    if (!this.auth.canOverrideOrders() || !this.connectivity.isOnline()) {
      return;
    }

    this.unsynced
      .getUnsyncedOrders({ status: UnsyncedOrderStatusEnum.Open, page: 1, pageSize: 1 })
      .subscribe({
        next: (result) => this.count.set(result.totalCount),
        error: () => this.count.set(0),
      });
  }
}
