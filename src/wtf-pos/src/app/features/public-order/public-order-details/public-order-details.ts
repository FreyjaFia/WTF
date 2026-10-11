import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { BadgeComponent } from '@shared/components/badge/badge';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { PublicOrderDto } from '@shared/models';
import {
  publicStatusNote,
  publicStatusNoteClass,
  publicStatusVariant,
  publicTimeline,
} from '../public-order-status';

/**
 * One of the customer's orders on the public page, laid out like the order details the shop staff see. It is its own
 * component, not shared with the staff screens, because the two show different things and change for different reasons.
 */
@Component({
  selector: 'app-public-order-details',
  imports: [AvatarComponent, BadgeComponent, DatePipe, DecimalPipe, IconComponent],
  templateUrl: './public-order-details.html',
  host: { class: 'block' },
})
export class PublicOrderDetailsComponent {
  public readonly order = input.required<PublicOrderDto>();

  public readonly back = output<void>();

  protected readonly variant = publicStatusVariant;
  protected readonly note = computed(() => publicStatusNote(this.order()));
  protected readonly noteClass = computed(() => publicStatusNoteClass(this.order().statusKind));

  protected readonly timeline = computed(() => publicTimeline(this.order()));

  protected readonly itemCount = computed(() =>
    this.order().items.reduce((sum, item) => sum + item.quantity, 0),
  );

  /** What the customer owes: the order plus the tip they chose. */
  protected readonly amountDue = computed(() => this.order().total + (this.order().tips ?? 0));

  protected readonly change = computed(() => {
    const { amountReceived } = this.order();
    return amountReceived ? Math.max(0, amountReceived - this.amountDue()) : null;
  });

  protected lineTotal(item: PublicOrderDto['items'][number]): number {
    const addOns = item.addOns.reduce((sum, a) => sum + a.unitPrice * a.quantity, 0);
    return (item.unitPrice + addOns) * item.quantity;
  }
}
