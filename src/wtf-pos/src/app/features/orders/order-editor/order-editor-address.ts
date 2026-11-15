import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';

export class OrderEditorAddress {
  public readonly control = new FormControl('', { nonNullable: true });
  public readonly value = toSignal(this.control.valueChanges, { initialValue: '' });

  public fillFromCustomer(customerAddress: string | null | undefined): void {
    if (this.control.dirty) {
      return;
    }

    this.set(customerAddress?.trim() ?? '', false);
  }

  public set(address: string, edited: boolean): void {
    this.control.setValue(address);
    if (edited) {
      this.control.markAsDirty();
    }
  }

  public currentFor(customerSelected: boolean): string | null {
    if (!customerSelected) {
      return null;
    }

    return this.value().trim() || null;
  }

  public setBusy(busy: boolean): void {
    if (busy) {
      this.control.disable({ emitEvent: false });
    } else {
      this.control.enable({ emitEvent: false });
    }
  }
}
