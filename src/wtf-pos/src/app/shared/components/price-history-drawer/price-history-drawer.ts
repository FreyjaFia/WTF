import { CommonModule } from '@angular/common';
import { Component, effect, input, output, signal } from '@angular/core';
import { Icon } from '@shared/components';
import { ProductPriceHistoryDto } from '@shared/models';

@Component({
  selector: 'app-price-history-drawer',
  imports: [CommonModule, Icon],
  templateUrl: './price-history-drawer.html',
  styleUrl: './price-history-drawer.css',
})
export class PriceHistoryDrawerComponent {
  readonly isOpen = input(false);
  readonly priceHistory = input<ProductPriceHistoryDto[]>([]);
  readonly closed = output<void>();

  protected readonly hasBeenOpened = signal(false);

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.hasBeenOpened.set(true);
      }
    });
  }

  protected closeDrawer(): void {
    this.closed.emit();
  }
}
