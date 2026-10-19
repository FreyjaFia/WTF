import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { BadgeComponent } from '@shared/components/badge/badge';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { LineBreakdownComponent } from '@shared/components/line-breakdown/line-breakdown';
import { PublicOrderDto } from '@shared/models';
import {
  publicStatusNote,
  publicStatusNoteClass,
  publicStatusVariant,
  publicTimeline,
} from '../public-order-status';
import { addMoney, buildLineBreakdown, LineBreakdown, subtractMoney } from '@shared/calculations';

/**
 * One of the customer's orders on the public page, laid out like the order details the shop staff see. It is its own
 * component, not shared with the staff screens, because the two show different things and change for different reasons.
 */
@Component({
  selector: 'app-public-order-details',
  imports: [AvatarComponent, BadgeComponent, DatePipe, DecimalPipe, IconComponent, LineBreakdownComponent],
  templateUrl: './public-order-details.html',
  host: { class: 'block' },
})
export class PublicOrderDetailsComponent {
  public readonly order = input.required<PublicOrderDto>();

  /** Messages from the shop that the customer has not read yet. */
  public readonly unread = input(0);

  public readonly back = output<void>();
  /** The customer wants to chat with the shop about this order. */
  public readonly chat = output<void>();

  protected readonly variant = publicStatusVariant;
  protected readonly note = computed(() => publicStatusNote(this.order()));
  protected readonly noteClass = computed(() => publicStatusNoteClass(this.order().statusKind));

  protected readonly timeline = computed(() => publicTimeline(this.order()));

  protected readonly itemCount = computed(() =>
    this.order().items.reduce((sum, item) => sum + item.quantity, 0),
  );

  /** What the customer owes: the order plus the tip they chose. */
  protected readonly amountDue = computed(() => addMoney(this.order().total, this.order().tips ?? 0));

  protected readonly change = computed(() => {
    const { amountReceived } = this.order();
    return amountReceived ? Math.max(0, subtractMoney(amountReceived, this.amountDue())) : null;
  });

  protected getBreakdown(item: PublicOrderDto['items'][number]): LineBreakdown {
    return buildLineBreakdown({
      qty: item.quantity,
      listUnitPrice: item.unitPrice,
      addOns: item.addOns.map((addOn, index) => ({
        addOnId: `${addOn.name}-${index}`,
        name: addOn.name,
        price: addOn.unitPrice,
        quantity: addOn.quantity,
      })),
    });
  }

  protected lineTotal(item: PublicOrderDto['items'][number]): number {
    return this.getBreakdown(item).total;
  }
}
