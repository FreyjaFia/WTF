import { TestBed } from '@angular/core/testing';
import { ConversationListDto, ConversationSummaryDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationInboxService } from './conversation-inbox.service';
import { ConversationService } from './conversation.service';
import { ChatChange, SignalRService } from './signalr.service';

const item = (orderId: string, unreadCount: number, over: Partial<ConversationSummaryDto> = {}): ConversationSummaryDto => ({
  id: 'c-' + orderId,
  orderId,
  orderNumber: 1,
  title: 'Order #1',
  customerName: 'Maria Cruz',
  lastMessage: 'hi',
  lastSender: 'customer',
  lastMessageAt: '2026-10-12T09:00:00Z',
  unreadCount,
  ...over,
});

describe('ConversationInboxService', () => {
  let service: ConversationInboxService;
  let api: { getConversations: ReturnType<typeof vi.fn> };
  let message$: Subject<ChatChange>;
  let read$: Subject<ChatChange>;
  let signalR: {
    startStaffOrdersHub: ReturnType<typeof vi.fn>;
    stopStaffOrdersHub: ReturnType<typeof vi.fn>;
    orderMessage: Subject<ChatChange>;
    conversationRead: Subject<ChatChange>;
  };

  const list = (items: ConversationSummaryDto[], unread = items.filter((i) => i.unreadCount > 0).length): ConversationListDto => ({
    unreadConversations: unread,
    items,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    message$ = new Subject<ChatChange>();
    read$ = new Subject<ChatChange>();
    api = { getConversations: vi.fn(() => of(list([item('o1', 2), item('o2', 0)]))) };
    signalR = {
      startStaffOrdersHub: vi.fn(),
      stopStaffOrdersHub: vi.fn(),
      orderMessage: message$,
      conversationRead: read$,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConversationService, useValue: api },
        { provide: SignalRService, useValue: signalR },
      ],
    });
    service = TestBed.inject(ConversationInboxService);
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it('starts listening and loads the list when the first screen starts it', () => {
    service.start();

    expect(signalR.startStaffOrdersHub).toHaveBeenCalledTimes(1);
    expect(api.getConversations).toHaveBeenCalledTimes(1);
    expect(service.items().length).toBe(2);
    expect(service.unreadConversations()).toBe(1);
  });

  it('shares one connection between screens and stops with the last', () => {
    service.start();
    service.start();
    expect(signalR.startStaffOrdersHub).toHaveBeenCalledTimes(1);
    expect(api.getConversations).toHaveBeenCalledTimes(1);

    service.stop();
    expect(signalR.stopStaffOrdersHub).not.toHaveBeenCalled();

    service.stop();
    expect(signalR.stopStaffOrdersHub).toHaveBeenCalledTimes(1);
  });

  it('does nothing when stopped without being started', () => {
    service.stop();

    expect(signalR.stopStaffOrdersHub).not.toHaveBeenCalled();
  });

  it('knows how many messages wait on one order', () => {
    service.start();

    expect(service.unreadFor('o1')).toBe(2);
    expect(service.unreadFor('o2')).toBe(0);
    expect(service.unreadFor('unknown')).toBe(0);
  });

  it('loads the list again after a message arrives, once for a burst', () => {
    service.start();
    api.getConversations.mockClear();

    message$.next({ conversationId: 'c', orderId: 'o1' });
    message$.next({ conversationId: 'c', orderId: 'o1' });
    message$.next({ conversationId: 'c', orderId: 'o2' });
    expect(api.getConversations).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(api.getConversations).toHaveBeenCalledTimes(1);
  });

  it('loads the list again when a chat is read on another screen', () => {
    service.start();
    api.getConversations.mockClear();

    read$.next({ conversationId: 'c', orderId: 'o1' });
    vi.advanceTimersByTime(300);

    expect(api.getConversations).toHaveBeenCalledTimes(1);
  });

  it('shows the new numbers after a refresh', () => {
    service.start();
    api.getConversations.mockReturnValue(of(list([item('o1', 0), item('o3', 5)])));

    message$.next({ conversationId: 'c', orderId: 'o3' });
    vi.advanceTimersByTime(300);

    expect(service.unreadFor('o3')).toBe(5);
    expect(service.unreadFor('o1')).toBe(0);
    expect(service.unreadConversations()).toBe(1);
  });

  it('refreshes by itself now and then, in case the live connection dropped', () => {
    service.start();
    api.getConversations.mockClear();

    vi.advanceTimersByTime(60_000);

    expect(api.getConversations).toHaveBeenCalledTimes(1);
  });

  it('keeps what it shows when a refresh fails, and says so', () => {
    service.start();
    api.getConversations.mockReturnValue(throwError(() => new Error('offline')));

    service.refresh();

    expect(service.items().length).toBe(2);
    expect(service.unreadConversations()).toBe(1);
    expect(service.failed()).toBe(true);
    expect(service.isLoading()).toBe(false);

    api.getConversations.mockReturnValue(of(list([])));
    service.refresh();
    expect(service.failed()).toBe(false);
  });

  it('clears one order at once when staff open its chat', () => {
    service.start();

    service.markOrderRead('o1');

    expect(service.unreadFor('o1')).toBe(0);
    expect(service.unreadConversations()).toBe(0);
  });

  it('leaves everything alone when the order had nothing unread or is not in the list', () => {
    service.start();

    service.markOrderRead('o2');
    service.markOrderRead('unknown');

    expect(service.unreadConversations()).toBe(1);
  });

  it('stops listening and its timers after the last stop', () => {
    service.start();
    service.stop();
    api.getConversations.mockClear();

    message$.next({ conversationId: 'c', orderId: 'o1' });
    vi.advanceTimersByTime(120_000);

    expect(api.getConversations).not.toHaveBeenCalled();
  });
});
