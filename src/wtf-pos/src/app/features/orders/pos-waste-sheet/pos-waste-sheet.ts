import { Component, computed, effect, inject, OnInit, output, signal, untracked } from '@angular/core';
import {
  AlertService,
  ConnectivityService,
  ModalStackService,
  StockWasteService,
} from '@core/services';
import { IconComponent } from '@shared/components';
import {
  RecordWasteDialogComponent,
  WasteItem,
} from '@shared/components/record-waste-dialog/record-waste-dialog';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { RecordStockWasteDto, StockWasteSource } from '@shared/models';

@Component({
  selector: 'app-pos-waste-sheet',
  imports: [IconComponent, SearchInputComponent, RecordWasteDialogComponent],
  templateUrl: './pos-waste-sheet.html',
})
export class PosWasteSheetComponent implements OnInit {
  private readonly stockWasteService = inject(StockWasteService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);

  public readonly closed = output<void>();

  protected readonly source = StockWasteSource.Pos;
  protected readonly items = signal<WasteItem[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly searchTerm = signal('');
  protected readonly selectedItem = signal<WasteItem | null>(null);
  protected readonly isSaving = signal(false);
  protected readonly isOnline = this.connectivity.isOnline;

  protected readonly filteredItems = computed<WasteItem[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const items = this.items();
    if (!term) {
      return items;
    }

    return items.filter((item) => item.name.toLowerCase().includes(term));
  });

  private modalStackId: number | null = null;

  private wasOnline = this.connectivity.isOnline();

  // A list that failed while offline is loaded again only when the connection comes back, never in a loop.
  private readonly reloadWhenOnline = effect(() => {
    const isOnline = this.isOnline();
    const cameBack = isOnline && !this.wasOnline;
    this.wasOnline = isOnline;
    if (cameBack && untracked(() => this.loadError() !== null && !this.isLoading())) {
      untracked(() => this.loadItems());
    }
  });

  public ngOnInit(): void {
    this.modalStackId = this.modalStack.push(() => this.close());
    this.loadItems();
  }

  protected unitOf(item: WasteItem): string {
    return getInventoryUnitAbbreviation(item.unitName);
  }

  protected selectItem(item: WasteItem): void {
    if (!this.isOnline()) {
      return;
    }

    this.selectedItem.set(item);
  }

  protected cancelWaste(): void {
    if (this.isSaving()) {
      return;
    }

    this.selectedItem.set(null);
  }

  protected confirmWaste(payload: RecordStockWasteDto): void {
    if (this.isSaving()) {
      return;
    }

    if (!this.isOnline()) {
      this.alertService.error('Recording waste needs a connection. Try again when you are back online.');
      return;
    }

    this.isSaving.set(true);
    this.stockWasteService.recordWaste(payload).subscribe({
      next: (waste) => {
        this.isSaving.set(false);
        this.alertService.success(
          waste.status === 'PendingReview'
            ? 'Waste recorded. It needs Admin review.'
            : 'Waste recorded.',
        );
        this.selectedItem.set(null);
        this.close();
      },
      error: (error: Error) => {
        this.isSaving.set(false);
        this.alertService.error(error.message);
      },
    });
  }

  protected close(): void {
    if (this.isSaving()) {
      return;
    }

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }

    this.closed.emit();
  }

  protected loadItems(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this.stockWasteService.getWasteItems().subscribe({
      next: (items) => {
        this.items.set(
          items
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