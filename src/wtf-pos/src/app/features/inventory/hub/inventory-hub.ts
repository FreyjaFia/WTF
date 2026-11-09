import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, StockAttentionService, StockWasteService } from '@core/services';
import { HubGroup, visibleGroups, inventoryGroups } from '@shared/navigation/hub-groups';

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

  protected readonly groups = computed<HubGroup[]>(() =>
    visibleGroups(inventoryGroups(this.authService, this.attention, this.stockWaste)),
  );
}
