import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConversationInboxService, ConversationService, SignalRService } from '@core/services';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { PublicOrderService } from '@core/services/public-order.service';
import { OrderChatDrawerComponent } from '@shared/components/order-chat-drawer/order-chat-drawer';
import { PublicChatComponent } from '@features/public-order/public-chat/public-chat';
import { DRAWER_SLIDE_MS } from '@shared/components/drawer-timing';
import { OrderConversationDto } from '@shared/models';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chat = (): OrderConversationDto => ({
  conversationId: 'c1',
  orderId: 'o1',
  orderNumber: 1042,
  title: 'Order #1042',
  canSend: true,
  closedReason: null,
  unreadCount: 0,
  messages: [{ id: '1', sender: 'customer', senderName: null, body: 'Is 5pm ok?', createdAt: '2026-10-12T09:00:00' }],
});

/**
 * How a chat panel opens and closes: the body is built while the panel is open and for the length of the slide out (so
 * it never turns into an empty white panel on the way), and the messages are drawn once the slide in has finished (so
 * building them does not stutter it).
 */
describe.each([
  {
    name: 'the staff panel',
    marker: '[data-order-chat]',
    create: () => {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: ConversationService,
            useValue: { getOrderConversation: vi.fn(() => of(chat())), markRead: vi.fn(() => of(undefined)) },
          },
          { provide: ConversationInboxService, useValue: { markOrderRead: vi.fn() } },
          {
            provide: SignalRService,
            useValue: { orderMessage: new Subject(), startStaffOrdersHub: vi.fn(), stopStaffOrdersHub: vi.fn() },
          },
        ],
      });
      return TestBed.createComponent(OrderChatDrawerComponent) as ComponentFixture<unknown>;
    },
  },
  {
    name: 'the customer panel',
    marker: '[data-public-chat]',
    create: () => {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: PublicOrderService,
            useValue: {
              getOrderConversation: vi.fn(() => of(chat())),
              markConversationRead: vi.fn(() => of(undefined)),
            },
          },
          { provide: PublicOrderHubService, useValue: { orderMessage: new Subject().asObservable() } },
        ],
      });
      const fixture = TestBed.createComponent(PublicChatComponent);
      fixture.componentRef.setInput('token', 'tok-1');
      return fixture as ComponentFixture<unknown>;
    },
  },
])('$name motion', ({ create, marker }) => {
  let fixture: ComponentFixture<unknown>;

  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => el().querySelectorAll('[data-message]').length;
  const body = () => el().querySelector('[data-chat-messages]');
  const set = (name: string, value: unknown) => fixture.componentRef.setInput(name, value);
  const settle = () => {
    vi.advanceTimersByTime(20);
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = create();
    set('orderId', 'o1');
    set('isOpen', false);
    fixture.detectChanges();
    settle(); // the panel is on the page and animations are on
  });

  afterEach(() => vi.useRealTimers());

  it('has the panel on the page but no chat body while closed', () => {
    expect(el().querySelector(marker)).not.toBeNull();
    expect(body()).toBeNull();
  });

  it('builds the body at once on opening, but draws the messages only after the slide', () => {
    set('isOpen', true);
    fixture.detectChanges();

    expect(body()).not.toBeNull();
    expect(rows()).toBe(0);
    expect(el().querySelector('.loading')).not.toBeNull();

    vi.advanceTimersByTime(DRAWER_SLIDE_MS);
    fixture.detectChanges();

    expect(rows()).toBe(1);
  });

  it('keeps the chat body while the panel slides out, then removes it', () => {
    set('isOpen', true);
    fixture.detectChanges();
    vi.advanceTimersByTime(DRAWER_SLIDE_MS);
    fixture.detectChanges();
    expect(rows()).toBe(1);

    set('isOpen', false);
    fixture.detectChanges();
    expect(body()).not.toBeNull();
    expect(rows()).toBe(1);

    vi.advanceTimersByTime(DRAWER_SLIDE_MS - 1);
    fixture.detectChanges();
    expect(body()).not.toBeNull();

    vi.advanceTimersByTime(2);
    fixture.detectChanges();
    expect(body()).toBeNull();
  });

  it('shows the messages straight away when reopened in the middle of sliding out', () => {
    set('isOpen', true);
    fixture.detectChanges();
    vi.advanceTimersByTime(DRAWER_SLIDE_MS);
    fixture.detectChanges();

    set('isOpen', false);
    fixture.detectChanges();
    vi.advanceTimersByTime(DRAWER_SLIDE_MS / 2);
    set('isOpen', true);
    fixture.detectChanges();

    expect(rows()).toBe(1);
    expect(el().querySelector('.loading')).toBeNull();
    vi.advanceTimersByTime(DRAWER_SLIDE_MS * 2);
    fixture.detectChanges();
    expect(body()).not.toBeNull();
  });

  it('lets the messages ease in', () => {
    set('isOpen', true);
    fixture.detectChanges();
    vi.advanceTimersByTime(DRAWER_SLIDE_MS);
    fixture.detectChanges();

    expect(el().querySelector('[data-message]')!.className).toContain('app-fade-in');
  });

  it('does nothing more once the page goes away mid-slide (its timer never fires)', () => {
    const panel = fixture.componentInstance as unknown as { contentReady: () => boolean; contentMounted: () => boolean };
    set('isOpen', true);
    fixture.detectChanges();
    expect(panel.contentMounted()).toBe(true);
    expect(panel.contentReady()).toBe(false);

    fixture.destroy();
    vi.advanceTimersByTime(DRAWER_SLIDE_MS * 3);

    // The slide-in timer would have marked the messages ready, and the slide-out timer would have removed the body.
    expect(panel.contentReady()).toBe(false);
    expect(panel.contentMounted()).toBe(true);
  });
});
