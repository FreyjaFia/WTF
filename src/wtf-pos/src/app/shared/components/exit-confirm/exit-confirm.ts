import { Component, output, signal } from '@angular/core';
import { Icon } from '../icons/icon/icon';

@Component({
  selector: 'app-exit-confirm',
  imports: [Icon],
  templateUrl: './exit-confirm.html',
})
export class ExitConfirmComponent {
  public readonly confirmed = output<void>();
  public readonly cancelled = output<void>();

  protected readonly visible = signal(false);

  public open(): void {
    this.visible.set(true);
  }

  public close(): void {
    this.visible.set(false);
  }

  protected confirm(): void {
    this.close();
    this.confirmed.emit();
  }

  protected cancel(): void {
    this.close();
    this.cancelled.emit();
  }
}
