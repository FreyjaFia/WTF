import { DecimalPipe } from '@angular/common';
import { Component, computed, input, OnDestroy, OnInit, output, signal } from '@angular/core';
import { HoldButtonComponent } from '@shared/components/hold-button/hold-button';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { FulfillmentTypeEnum, PaymentMethodEnum } from '@shared/models';
import { addMoney, subtractMoney } from '@shared/calculations';

export const MAX_ADDRESS_LENGTH = 300;
export const MAX_CONTACT_LENGTH = 30;
export const MAX_ORDER_INSTRUCTIONS = 100;
export const MAX_CASH_AMOUNT = 1_000_000;
export const MAX_TIP = 100_000;
/** How long the "keep holding" message stays after the button was let go too early. */
export const HOLD_REMINDER_MS = 2000;

/** What the customer filled in. The page turns it, with the cart, into the order request. */
export interface PublicCheckoutForm {
  fulfillment: FulfillmentTypeEnum;
  deliveryAddress: string | null;
  contactNumber: string;
  paymentMethod: PaymentMethodEnum;
  /** What the customer will pay with, for cash only. It covers the total and the tip. */
  amountReceived: number | null;
  /** An optional tip for the shop, on top of the total. */
  tips: number | null;
  specialInstructions: string | null;
  /** The customer chose to keep a changed contact number as their number on file. */
  saveContactNumber: boolean;
  /** The customer chose to keep a changed delivery address as their address on file. */
  saveAddress: boolean;
}

/** How the cash amount compares with what is to be paid. */
export type CashStatus = 'due' | 'owed' | 'change';

// Digits, spaces, + ( ) and -, with at least 7 digits (the same rule the server applies).
const CONTACT_PATTERN = /^[0-9+()\-\s]+$/;

/**
 * The last step before an order is sent: how it is handed over, who to call, how the customer will pay. It checks
 * the same rules the server checks, so mistakes are caught early, but the server remains the one that decides.
 */
@Component({
  selector: 'app-public-checkout',
  imports: [DecimalPipe, HoldButtonComponent, IconComponent],
  templateUrl: './public-checkout.html',
})
export class PublicCheckoutComponent implements OnInit, OnDestroy {
  /** The order total the customer sees; the server works out its own and checks cash against that. */
  public readonly total = input.required<number>();
  /** The customer's address on file, offered for delivery. */
  public readonly defaultAddress = input<string | null>(null);
  /** The customer's contact number on file, offered as the contact number. */
  public readonly defaultContact = input<string | null>(null);
  public readonly isBusy = input(false);
  /** A message from the server about the last attempt (for example an item that is no longer sold). */
  public readonly serverError = input<string | null>(null);

  public readonly submitted = output<PublicCheckoutForm>();
  public readonly cancelled = output<void>();

  protected readonly Fulfillment = FulfillmentTypeEnum;
  protected readonly Payment = PaymentMethodEnum;
  protected readonly maxAddress = MAX_ADDRESS_LENGTH;
  protected readonly maxContact = MAX_CONTACT_LENGTH;
  protected readonly maxInstructions = MAX_ORDER_INSTRUCTIONS;

  protected readonly fulfillment = signal(FulfillmentTypeEnum.Pickup);
  protected readonly address = signal('');
  protected readonly contact = signal('');
  protected readonly payment = signal(PaymentMethodEnum.Cash);
  protected readonly amount = signal('');
  protected readonly tip = signal('');
  protected readonly instructions = signal('');
  /** One tick keeps whatever changed: the number, the address, or both. */
  protected readonly saveDetails = signal(false);
  /** Errors are shown only after the first attempt to place the order. */
  protected readonly attempted = signal(false);
  /** True for a moment after the Place Order button was let go before it filled. */
  protected readonly holdReminder = signal(false);
  private holdReminderTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly isDelivery = computed(
    () => this.fulfillment() === FulfillmentTypeEnum.Delivery,
  );
  protected readonly isCash = computed(() => this.payment() === PaymentMethodEnum.Cash);

  protected readonly amountValue = computed<number | null>(() => this.parseMoney(this.amount()));
  protected readonly tipValue = computed<number | null>(() => this.parseMoney(this.tip()));

  /** The tip that counts: none while the box is empty or not a usable number. */
  private readonly tipToAdd = computed(() => {
    const value = this.tipValue();
    return value !== null && Number.isFinite(value) && value > 0 ? value : 0;
  });

  /** The total plus the tip: what the customer has to hand over. */
  protected readonly toPay = computed(() => addMoney(this.total(), this.tipToAdd()));

  /** Where the cash amount stands against what is to be paid. */
  protected readonly cashStatus = computed<CashStatus>(() => {
    const value = this.amountValue();
    if (value === null || !Number.isFinite(value)) {
      return 'due';
    }

    return value < this.toPay() ? 'owed' : 'change';
  });

  /** What the shop will have to hand back, or what is still missing, shown while the customer types. */
  protected readonly cashDifference = computed(() => {
    const value = this.amountValue();
    if (value === null || !Number.isFinite(value)) {
      return this.toPay();
    }

    return Math.abs(subtractMoney(value, this.toPay()));
  });

  protected readonly change = computed<number | null>(() =>
    this.isCash() && this.cashStatus() === 'change' ? this.cashDifference() : null,
  );

  protected readonly addressError = computed<string | null>(() => {
    if (!this.isDelivery()) {
      return null;
    }

    return this.address().trim() ? null : 'Please enter your delivery address.';
  });

  protected readonly contactError = computed<string | null>(() => {
    const contact = this.contact().trim();
    if (!contact) {
      return 'Please enter a contact number.';
    }

    const digits = contact.replace(/\D/g, '').length;
    if (contact.length > MAX_CONTACT_LENGTH || !CONTACT_PATTERN.test(contact) || digits < 7) {
      return 'Please enter a valid contact number.';
    }

    return null;
  });

  /** A usable number that differs from the one on file: only then is the customer asked to keep it. */
  protected readonly contactChanged = computed(
    () =>
      !this.contactError() && this.contact().trim() !== (this.defaultContact() ?? '').trim(),
  );

  protected readonly addressChanged = computed(
    () =>
      this.isDelivery() &&
      !this.addressError() &&
      this.address().trim() !== (this.defaultAddress() ?? '').trim(),
  );

  protected readonly detailsChanged = computed(() => this.contactChanged() || this.addressChanged());

  /** What the tick box says it will keep. */
  protected readonly saveLabel = computed(() => {
    const what =
      this.contactChanged() && this.addressChanged()
        ? 'number and address'
        : this.addressChanged()
          ? 'address'
          : 'number';
    return `Save my new ${what} for next time`;
  });

  protected readonly tipError = computed<string | null>(() => {
    const value = this.tipValue();
    if (value === null) {
      return null;
    }

    if (Number.isNaN(value)) {
      return 'Please enter a valid tip.';
    }

    if (value < 0) {
      return 'The tip cannot be negative.';
    }

    return value > MAX_TIP ? 'That tip is too large.' : null;
  });

  protected readonly amountError = computed<string | null>(() => {
    if (!this.isCash()) {
      return null;
    }

    const value = this.amountValue();
    if (value === null) {
      return 'Please enter the amount you will pay in cash.';
    }

    if (Number.isNaN(value)) {
      return 'Please enter a valid amount.';
    }

    if (value < this.toPay()) {
      return `The amount must be at least ₱${this.toPay().toFixed(2)}.`;
    }

    if (value > MAX_CASH_AMOUNT) {
      return 'That amount is too large.';
    }

    return null;
  });

  /** The amount box turns red as soon as a typed amount is too small, not only after the first attempt. */
  protected readonly amountInvalid = computed(
    () =>
      this.isCash() &&
      this.amountError() !== null &&
      (this.attempted() || this.amountValue() !== null),
  );

  public ngOnInit(): void {
    this.address.set((this.defaultAddress() ?? '').slice(0, MAX_ADDRESS_LENGTH));
    this.contact.set((this.defaultContact() ?? '').slice(0, MAX_CONTACT_LENGTH));
  }

  public ngOnDestroy(): void {
    if (this.holdReminderTimer !== null) {
      clearTimeout(this.holdReminderTimer);
    }
  }

  protected chooseFulfillment(value: FulfillmentTypeEnum): void {
    this.fulfillment.set(value);
  }

  protected choosePayment(value: PaymentMethodEnum): void {
    this.payment.set(value);
  }

  /** Fills in exactly what is to be paid (the total and any tip). */
  protected useExactAmount(): void {
    this.amount.set(this.toPay().toFixed(2));
  }

  protected onAddress(value: string): void {
    this.address.set(value.slice(0, MAX_ADDRESS_LENGTH));
  }

  protected onContact(value: string): void {
    this.contact.set(value.slice(0, MAX_CONTACT_LENGTH));
  }

  protected onInstructions(value: string): void {
    this.instructions.set(value.slice(0, MAX_ORDER_INSTRUCTIONS));
  }

  /** The Place Order button was let go before it filled: say how it works, in the help line above it. */
  protected onHoldReleased(): void {
    if (this.holdReminderTimer !== null) {
      clearTimeout(this.holdReminderTimer);
    }

    this.holdReminder.set(true);
    this.holdReminderTimer = setTimeout(() => {
      this.holdReminder.set(false);
      this.holdReminderTimer = null;
    }, HOLD_REMINDER_MS);
  }

  protected submit(): void {
    if (this.isBusy()) {
      return;
    }

    this.attempted.set(true);
    if (this.addressError() || this.contactError() || this.tipError() || this.amountError()) {
      return;
    }

    const tip = this.tipToAdd();
    this.submitted.emit({
      fulfillment: this.fulfillment(),
      deliveryAddress: this.isDelivery() ? this.address().trim() : null,
      contactNumber: this.contact().trim(),
      paymentMethod: this.payment(),
      amountReceived: this.isCash() ? this.amountValue() : null,
      tips: tip > 0 ? tip : null,
      specialInstructions: this.instructions().trim() || null,
      saveContactNumber: this.contactChanged() && this.saveDetails(),
      saveAddress: this.addressChanged() && this.saveDetails(),
    });
  }

  /** An empty box is null, a number is itself, anything else is NaN. */
  private parseMoney(text: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    const value = Number(trimmed);
    return Number.isFinite(value) ? value : Number.NaN;
  }

}
