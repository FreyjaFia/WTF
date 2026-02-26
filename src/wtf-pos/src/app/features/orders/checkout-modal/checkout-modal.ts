import { CommonModule } from '@angular/common';
import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ModalStackService } from '@core/services';
import { AvatarComponent, IconComponent } from '@shared/components';
import { CartAddOnDto, CartItemDto, PaymentMethodEnum } from '@shared/models';
import { SortAddOnsPipe } from '@shared/pipes';

@Component({
  selector: 'app-checkout-modal',
  imports: [CommonModule, ReactiveFormsModule, IconComponent, AvatarComponent, SortAddOnsPipe],
  templateUrl: './checkout-modal.html',
  styleUrl: './checkout-modal.css',
})
export class CheckoutModal {
  private readonly modalStack = inject(ModalStackService);
  private readonly checkoutDialog = viewChild.required<ElementRef<HTMLDialogElement>>('checkoutDialog');

  private modalStackId: number | null = null;

  readonly cartItems = input<CartItemDto[]>([]);
  readonly totalPrice = input<number>(0);
  readonly selectedCustomerName = input<string>('Walk-in customer');
  readonly orderSpecialInstructions = input<string>('');

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
  protected readonly showSummary = signal<boolean>(false);
  private readonly selectedPaymentMethod = signal<PaymentMethodEnum>(PaymentMethodEnum.Cash);
  private readonly amountReceivedValue = signal<number | null>(null);
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
      return this.totalPrice();
    }
    return this.change() < 0 ? -this.change() : this.change();
  });

  // Helper for template add-on price calculation
  protected readonly addOnPriceReducer = (sum: number, ao: CartAddOnDto) => sum + ao.price;

  protected readonly isConfirmDisabled = computed(() => {
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

    this.paymentForm.get('tips')?.valueChanges.subscribe(() => {
      this.calculateChange();
    });
  }

  public triggerOpen(): void {
    this.resetForm();
    // Calculate initial change to show the amount owed
    this.calculateChange();
    this.checkoutDialog().nativeElement.showModal();
    this.modalStackId = this.modalStack.push(() => this.cancelCheckout());
  }

  protected toggleSummary(): void {
    this.showSummary.set(!this.showSummary());
  }

  protected calculateChange(): void {
    const paymentMethod = this.selectedPaymentMethod();
    const amountReceived = this.amountReceivedValue();

    if (paymentMethod === PaymentMethodEnum.Cash) {
      if (amountReceived !== null && amountReceived !== undefined) {
        const calculatedChange = amountReceived - this.totalPrice();
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

    if (paymentMethod === null || paymentMethod === undefined) {
      return;
    }

    // Close and immediately hide to prevent backdrop/focus artifacts during navigation
    const dialog = this.checkoutDialog().nativeElement;
    dialog.close();
    this.removeFromStack();

    this.orderConfirmed.emit({
      paymentMethod,
      amountReceived:
        paymentMethod === PaymentMethodEnum.Cash && amountReceived ? amountReceived : undefined,
      changeAmount: paymentMethod === PaymentMethodEnum.Cash ? this.change() : undefined,
      tips: tips ?? undefined,
    });
  }

  protected cancelCheckout(): void {
    this.checkoutDialog().nativeElement.close();
    this.removeFromStack();
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
    this.change.set(0);
    this.showSummary.set(false);
  }
}
