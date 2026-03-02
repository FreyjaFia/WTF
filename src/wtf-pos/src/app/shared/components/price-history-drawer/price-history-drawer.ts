import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { IconComponent, SideDrawerComponent } from '@shared/components';
import { ProductPriceHistoryDto } from '@shared/models';

@Component({
  selector: 'app-price-history-drawer',
  imports: [CommonModule, SideDrawerComponent, IconComponent],
  templateUrl: './price-history-drawer.html',
  styleUrl: './price-history-drawer.css',
})
export class PriceHistoryDrawerComponent {
  readonly isOpen = input(false);
  readonly priceHistory = input<ProductPriceHistoryDto[]>([]);
  readonly closed = output<void>();

  protected closeDrawer(): void {
    this.closed.emit();
  }
}
