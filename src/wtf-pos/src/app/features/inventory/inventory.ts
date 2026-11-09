import { Component, computed, DestroyRef, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService, StockAttentionService, StockWasteService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-inventory',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './inventory.html',
  host: { class: 'flex-1 min-h-0' },
})
export class InventoryComponent {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly attention = inject(StockAttentionService);
  private readonly stockWaste = inject(StockWasteService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly hubRoute = AppRoutes.InventoryRoot;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  // Only the top screen of a section gets the way back: deeper pages (editors, details) bring their own back arrow.
  protected readonly showBackToHub = computed(() => {
    const path = this.currentUrl().split(/[?#]/)[0].split('/').filter(Boolean);
    return path.length === 2 && path[0] === 'inventory';
  });

  public constructor() {
    if (this.authService.canReadStockMovements()) {
      this.attention.start();
      this.destroyRef.onDestroy(() => this.attention.stop());
    }

    if (this.authService.canReviewStockWaste()) {
      this.stockWaste.startPendingCount();
      this.destroyRef.onDestroy(() => this.stockWaste.stopPendingCount());
    }
  }
}
