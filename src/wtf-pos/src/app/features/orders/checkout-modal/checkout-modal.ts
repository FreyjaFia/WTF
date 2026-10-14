import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ModalStackService } from '@core/services';
import { IconComponent } from '@shared/components';
import { PaymentMethodEnum } from '@shared/models';
import { amountDue, cashChange } from '@shared/calculations';

export interface CheckoutPrefill {
  paymentMethod?: PaymentMethodEnum | null;
  amountReceived?: number | null;
  tips?: number | null;
}

@Component({
  selector: 'app-checkout-modal',
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './checkout-modal.html',
  styleUrl: './checkout-modal.css',
})
export class CheckoutModal {
  private readonly modalStack = inject(ModalStackService);
  private readonly checkoutDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('checkoutDialog');

  private modalStackId: number | null = null;
  private wasBusy = false;

  readonly totalPrice = input<number>(0);
  readonly isBusy = input<boolean>(false);
  readonly busyLabel = input<string>('Processing Order...');

  readonly orderConfirmed = output<{
    paymentMethod: PaymentMethodEnum;
    amountReceived?: number;
    changeAmount?: number;
    tips?: number;
  }>();

  protected readonly paymentForm = new FormGroup({
    paymentMethod: new FormControl<PaymentMethodEnum>(PaymentMethodEnum.Cash, Validators.required),
    amountReceived: new FormControl<number | null>(null),
    tips: new FormControl<number | null>(null),
  });

  protected readonly PaymentMethodEnum = PaymentMethodEnum;
  protected readonly change = signal<number>(0);
  private readonly selectedPaymentMethod = signal<PaymentMethodEnum>(PaymentMethodEnum.Cash);
  private readonly amountReceivedValue = signal<number | null>(null);
  private readonly tipsValue = signal<number | null>(null);

  /** What the customer has to hand over: the total plus the tip. Change is worked out from this. */
  protected readonly amountDueValue = computed(() => amountDue(this.totalPrice(), this.tipsValue()));
  protected readonly isCash = computed(
    () => this.selectedPaymentMethod() === PaymentMethodEnum.Cash,
  );
  protected readonly hasAmountReceivedInput = computed(() => {
    const value = this.amountReceivedValue();
    return value !== null && value !== undefined;
  });
  protected readonly hasInsufficientCash = computed(() => {
    const paymentMethod = this.selectedPaymentMethod();
    return (
      paymentMethod === PaymentMethodEnum.Cash && this.hasAmountReceivedInput() && this.change() < 0
    );
  });
  protected readonly paymentStatusLabel = computed(() => {
    if (!this.hasAmountReceivedInput()) {
      return 'Amount Due:';
    }
    return this.change() < 0 ? 'Amount Owed:' : 'Change Due:';
  });
  protected readonly paymentStatusAmount = computed(() => {
    if (!this.hasAmountReceivedInput()) {
      return this.amountDueValue();
    }
    return this.change() < 0 ? -this.change() : this.change();
  });

  protected readonly isConfirmDisabled = computed(() => {
    if (this.isBusy()) {
      return true;
    }

    const paymentMethod = this.selectedPaymentMethod();

    // Disable if form is invalid
    if (this.paymentForm.invalid) {
      return true;
    }

    // For Cash payment, disable if change is negative (insufficient payment)
    if (paymentMethod === PaymentMethodEnum.Cash) {
      if (!this.hasAmountReceivedInput()) {
        return true;
      }
      return this.change() < 0;
    }

    return false;
  });

  constructor() {
    this.paymentForm.get('paymentMethod')?.valueChanges.subscribe((value) => {
      this.selectedPaymentMethod.set(value ?? PaymentMethodEnum.Cash);
      this.calculateChange();
    });

    this.paymentForm.get('amountReceived')?.valueChanges.subscribe((value) => {
      this.amountReceivedValue.set(value ?? null);
      this.calculateChange();
    });

    this.paymentForm.get('tips')?.valueChanges.subscribe((value) => {
      this.tipsValue.set(value ?? null);
      this.calculateChange();
    });

    // The dialog stays open while the order request runs, then closes once it settles.
    effect(() => {
      const busy = this.isBusy();
      if (this.wasBusy && !busy) {
        this.close();
      }
      this.wasBusy = busy;
    });
  }

  /**
   * Opens the dialog. `prefill` is for an order whose customer already chose how to pay (an order from their ordering
   * link), so the staff only check it instead of typing it again.
   */
  public triggerOpen(prefill?: CheckoutPrefill | null): void {
    this.resetForm();
    if (prefill?.paymentMethod !== undefined && prefill.paymentMethod !== null) {
      this.paymentForm.patchValue({
        paymentMethod: prefill.paymentMethod,
        amountReceived:
          prefill.paymentMethod === PaymentMethodEnum.Cash ? (prefill.amountReceived ?? null) : null,
        tips: prefill.tips ?? null,
      });
    }
    // Calculate initial change to show the amount owed
    this.calculateChange();
    this.checkoutDialog().nativeElement.showModal();
    this.modalStackId = this.modalStack.push(() => this.cancelCheckout());
  }

  public close(): void {
    this.checkoutDialog().nativeElement.close();
    this.removeFromStack();
  }

  protected choosePayment(method: PaymentMethodEnum): void {
    if (this.isBusy()) {
      return;
    }

    this.paymentForm.get('paymentMethod')?.setValue(method);
  }

  /** Fills in exactly what is due (the total and any tip), for a customer who pays the exact amount. */
  protected useExactAmount(): void {
    if (this.isBusy()) {
      return;
    }

    this.paymentForm.get('amountReceived')?.setValue(this.amountDueValue());
  }

  protected calculateChange(): void {
    const paymentMethod = this.selectedPaymentMethod();
    const amountReceived = this.amountReceivedValue();

    if (paymentMethod === PaymentMethodEnum.Cash) {
      if (amountReceived !== null && amountReceived !== undefined) {
        const calculatedChange = cashChange(amountReceived, this.totalPrice(), this.tipsValue());
        this.change.set(calculatedChange);
      } else {
        // Initial neutral state before user enters a cash amount
        this.change.set(0);
      }
    } else {
      this.change.set(0);
    }
  }

  protected confirmOrder(): void {
    const paymentMethod = this.paymentForm.get('paymentMethod')?.value;
    const amountReceived = this.paymentForm.get('amountReceived')?.value;
    const tips = this.paymentForm.get('tips')?.value;

    if (paymentMethod === null || paymentMethod === undefined || this.isBusy()) {
      return;
    }

    // The parent closes the dialog once the order request settles.
    this.orderConfirmed.emit({
      paymentMethod,
      amountReceived:
        paymentMethod === PaymentMethodEnum.Cash && amountReceived ? amountReceived : undefined,
      changeAmount: paymentMethod === PaymentMethodEnum.Cash ? this.change() : undefined,
      tips: tips ?? undefined,
    });
  }

  protected cancelCheckout(): void {
    if (this.isBusy()) {
      return;
    }
    this.close();
  }

  protected onDialogClosed(): void {
    this.removeFromStack();
  }

  protected onDialogCancel(event: Event): void {
    if (this.isBusy()) {
      event.preventDefault();
    }
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  private resetForm(): void {
    this.paymentForm.reset({
      paymentMethod: PaymentMethodEnum.Cash,
      amountReceived: null,
      tips: null,
    });
    this.selectedPaymentMethod.set(PaymentMethodEnum.Cash);
    this.amountReceivedValue.set(null);
    this.tipsValue.set(null);
    this.change.set(0);
  }
}
