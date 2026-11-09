import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, StockAttentionService, StockWasteService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

interface HubCard {
  id: string;
  label: string;
  description: string;
  route: string;
  canShow: () => boolean;
  badge?: () => number;
  urgent?: () => boolean;
}

interface HubGroup {
  name: string;
  description: string;
  cards: HubCard[];
}

@Component({
  selector: 'app-inventory-hub',
  imports: [RouterLink],
  templateUrl: './inventory-hub.html',
  host: { class: 'flex-1 min-h-0' },
})
export class InventoryHubComponent {
  private readonly authService = inject(AuthService);
  private readonly attention = inject(StockAttentionService);
  private readonly stockWaste = inject(StockWasteService);

  protected readonly groups = computed<HubGroup[]>(() => {
    const all: HubGroup[] = [
      {
        name: 'Stock',
        description: 'What you have on the shelf and what happens to it.',
        cards: [
          {
            id: 'items',
            label: 'Items',
            description: 'Every item you stock, with its level and unit.',
            route: AppRoutes.InventoryItems,
            canShow: () => this.authService.canReadItems(),
          },
          {
            id: 'ingredients',
            label: 'Ingredients & Cost',
            description: 'What goes into each product, and what it costs.',
            route: AppRoutes.InventoryIngredients,
            canShow: () => this.authService.canReadItems(),
          },
          {
            id: 'attention',
            label: 'Needs Attention',
            description: 'Items that are low, critical or out of stock.',
            route: AppRoutes.InventoryAttention,
            canShow: () => this.authService.canReadStockMovements(),
            badge: () => this.attention.count(),
            urgent: () => this.attention.urgentCount() > 0,
          },
          {
            id: 'stock-in',
            label: 'Stock In',
            description: 'Record stock that came in.',
            route: AppRoutes.InventoryStockIn,
            canShow: () => this.authService.canReadStockMovements(),
          },
          {
            id: 'counts',
            label: 'Counts',
            description: 'Count the shelf and fix the differences.',
            route: AppRoutes.InventoryCounts,
            canShow: () => this.authService.canReadStockMovements(),
          },
          {
            id: 'waste',
            label: 'Waste',
            description: 'Wasted stock, and what is waiting for review.',
            route: AppRoutes.InventoryWaste,
            canShow: () => this.authService.canReadStockMovements(),
            badge: () =>
              this.authService.canReviewStockWaste() ? this.stockWaste.pendingCount() : 0,
            urgent: () => false,
          },
        ],
      },
      {
        name: 'Buying',
        description: 'Ordering from suppliers and receiving what arrives.',
        cards: [
          {
            id: 'purchase-orders',
            label: 'Purchasing',
            description: 'Suggested orders and purchase orders.',
            route: AppRoutes.InventoryPurchaseOrders,
            canShow: () => this.authService.canReadStockMovements(),
          },
          {
            id: 'receiving',
            label: 'Receiving',
            description: 'Deliveries received against purchase orders.',
            route: AppRoutes.InventoryReceiving,
            canShow: () => this.authService.canReadStockMovements(),
          },
        ],
      },
    ];

    return all
      .map((group) => ({ ...group, cards: group.cards.filter((card) => card.canShow()) }))
      .filter((group) => group.cards.length > 0);
  });
}
