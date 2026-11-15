import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, ConnectivityService, StockWasteService } from '@core/services';
import { IconComponent } from '@shared/components';
import { WasteItem } from '@shared/components/record-waste-dialog/record-waste-dialog';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';

@Component({
  selector: 'app-record-waste',
  imports: [IconComponent, RouterLink, SearchInputComponent],
  templateUrl: './record-waste.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex-1 min-h-0' },
})
export class RecordWasteComponent implements OnInit {
  private readonly stockWaste = inject(StockWasteService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly auth = inject(AuthService);

  protected readonly routes = AppRoutes;
  protected readonly backLink = this.auth.canReadStockMovements() ? AppRoutes.InventoryWaste : AppRoutes.OrdersList;
  protected readonly isOnline = this.connectivity.isOnline;
  protected readonly items = signal<WasteItem[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly searchTerm = signal('');

  protected readonly filteredItems = computed<WasteItem[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const items = this.items();
    return term ? items.filter((item) => item.name.toLowerCase().includes(term)) : items;
  });

  public ngOnInit(): void {
    this.load();
  }

  protected unitOf(item: WasteItem): string {
    return getInventoryUnitAbbreviation(item.unitName);
  }

  protected load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this.stockWaste.getWasteItems().subscribe({
      next: (items) => {
        this.items.set(
          items
            .filter((item) => item.currentQuantity > 0)
            .map((item) => ({
              id: item.id,
              name: item.name,
              unitName: item.baseUnit,
              currentQuantity: item.currentQuantity,
              allowNegativeStock: item.allowNegativeStock,
              wasteApprovalLimit: item.wasteApprovalLimit ?? null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        this.isLoading.set(false);
      },
      error: (error: Error) => {
        this.loadError.set(error.message);
        this.isLoading.set(false);
      },
    });
  }
}
