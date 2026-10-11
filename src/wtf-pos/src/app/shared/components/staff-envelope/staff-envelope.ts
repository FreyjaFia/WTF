import { Component, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, ConversationInboxService } from '@core/services';
import { EnvelopeComponent } from '@shared/components/envelope/envelope';
import { OrderChatDrawerComponent } from '@shared/components/order-chat-drawer/order-chat-drawer';
import { AppRoutes } from '@shared/constants/app-routes';
import { ConversationSummaryDto } from '@shared/models';

/**
 * The envelope for staff: customers' conversations with the unread count. Everyone who can read orders has it. Pressing
 * a conversation opens its chat in place, with a button to go to the order. The header and the sidebar each have one; they share the same
 * list, which is loaded and kept up to date by <see cref="ConversationInboxService"/>.
 */
@Component({
  selector: 'app-staff-envelope',
  imports: [EnvelopeComponent, OrderChatDrawerComponent],
  templateUrl: './staff-envelope.html',
  host: { class: 'inline-block' },
})
export class StaffEnvelopeComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly inbox = inject(ConversationInboxService);
  private readonly router = inject(Router);

  public readonly align = input<'start' | 'end'>('end');

  protected readonly openChat = signal<ConversationSummaryDto | null>(null);

  private started = false;

  public ngOnInit(): void {
    if (this.auth.canReadOrders()) {
      this.inbox.start();
      this.started = true;
    }
  }

  public ngOnDestroy(): void {
    if (this.started) {
      this.inbox.stop();
      this.started = false;
    }
  }

  protected open(item: ConversationSummaryDto): void {
    if (!item.orderId) {
      return;
    }

    this.openChat.set(item);
  }

  protected goToOrder(): void {
    const orderId = this.openChat()?.orderId;
    this.openChat.set(null);
    if (orderId) {
      void this.router.navigate([AppRoutes.OrderDetailsById(orderId)]);
    }
  }
}
