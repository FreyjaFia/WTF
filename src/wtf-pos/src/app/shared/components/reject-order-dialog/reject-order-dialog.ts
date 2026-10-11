import { Component, input, output, signal } from '@angular/core';
import { ServiceErrorMessages } from '@core/messages';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';

export const MAX_REJECT_REASON_LENGTH = 500;

/**
 * Asks staff why they are turning down an order a customer placed through their link. The reason is required and is
 * shown to the customer on their My orders page.
 */
@Component({
  selector: 'app-reject-order-dialog',
  imports: [ConfirmDialogComponent],
  templateUrl: './reject-order-dialog.html',
  host: { class: 'contents' },
})
export class RejectOrderDialogComponent {
  public readonly orderNumber = input.required<number>();
  public readonly isBusy = input(false);

  /** Emits the trimmed reason once it is not empty. */
  public readonly confirmed = output<string>();
  public readonly cancelled = output<void>();

  protected readonly maxLength = MAX_REJECT_REASON_LENGTH;
  protected readonly reason = signal('');
  protected readonly error = signal<string | null>(null);

  protected onInput(value: string): void {
    this.reason.set(value.slice(0, MAX_REJECT_REASON_LENGTH));

    if (this.error() && this.reason().trim()) {
      this.error.set(null);
    }
  }

  protected submit(): void {
    if (this.isBusy()) {
      return;
    }

    const reason = this.reason().trim();
    if (!reason) {
      this.error.set(ServiceErrorMessages.Order.RejectReasonRequired);
      return;
    }

    this.confirmed.emit(reason);
  }
}
