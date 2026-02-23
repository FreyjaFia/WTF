import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { ModalStackService } from '@core/services';
import { Icon } from '@shared/components';
import { ProductPriceHistoryDto } from '@shared/models';

@Component({
  selector: 'app-price-history-drawer',
  imports: [CommonModule, Icon],
  templateUrl: './price-history-drawer.html',
  styleUrl: './price-history-drawer.css',
})
export class PriceHistoryDrawerComponent {
  private readonly modalStack = inject(ModalStackService);

  readonly isOpen = input(false);
  readonly priceHistory = input<ProductPriceHistoryDto[]>([]);
  readonly closed = output<void>();

  protected readonly hasBeenOpened = signal(false);

  private modalStackId: number | null = null;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.hasBeenOpened.set(true);
        this.modalStackId = this.modalStack.push(() => this.closeDrawer());
      } else if (this.modalStackId !== null) {
        this.modalStack.remove(this.modalStackId);
        this.modalStackId = null;
      }
    });
  }

  protected closeDrawer(): void {
    this.closed.emit();
  }
}
