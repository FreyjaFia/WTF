import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-shop-unavailable',
  templateUrl: './shop-unavailable.html',
})
export class ShopUnavailableComponent {
  public readonly shopName = input.required<string>();
  public readonly phone = input<string | null>(null);
  public readonly retry = output<void>();

  protected tryAgain(): void {
    this.retry.emit();
  }
}
