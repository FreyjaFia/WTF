import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  AlertService,
  AuthService,
  ConnectivityService,
  ConversationInboxService,
  ConversationService,
  ListStateService,
  NeedsAttentionService,
  OrderService,
  SignalRService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { FulfillmentTypeEnum, OrderDto, OrderStatusEnum, PaymentMethodEnum } from '@shared/models';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AwaitingApproval } from './awaiting-approval';

const waiting = (id: string, over: Partial<OrderDto> = {}): OrderDto => ({
  id,
  orderNumber: Number(id.replace(/\D/g, '')) || 1,
  createdAt: '2026-10-11T09:00:00Z',
  createdBy: 'u',
  status: OrderStatusEnum.PendingApproval,
  customerName: 'Maria Cruz',
  totalAmount: 360,
  fulfillmentType: FulfillmentTypeEnum.Pickup,
  paymentMethod: PaymentMethodEnum.Cash,
  items: [{ id: 'i1', productId: 'p1', productName: 'Latte', quantity: 2, addOns: [] }],
  ...over,
});

describe('AwaitingApproval', () => {
  let fixture: ComponentFixture<AwaitingApproval>;
  let hub: Subject<string>;
  let canWrite: boolean;
  let alert: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; getLoadErrorMessage: ReturnType<typeof vi.fn> };
  let attention: { refresh: ReturnType<typeof vi.fn> };
  let orderService: {
    getAwaitingOrders: ReturnType<typeof vi.fn>;
    getOrder: ReturnType<typeof vi.fn>;
    approveOrder: ReturnType<typeof vi.fn>;
    rejectOrder: ReturnType<typeof vi.fn>;
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('[data-testid="awaiting-row"]')] as HTMLElement[];
  const buttons = (label: string) =>
    [...el().querySelectorAll('button')].filter((b) => b.textContent?.trim().startsWith(label)) as HTMLButtonElement[];
  const init = () => {
    fixture = TestBed.createComponent(AwaitingApproval);
    fixture.detectChanges();
  };

  beforeEach(() => {
    canWrite = true;
    hub = new Subject<string>();
    alert = { error: vi.fn(), success: vi.fn(), getLoadErrorMessage: vi.fn((e: string) => `Failed ${e}`) };
    attention = { refresh: vi.fn() };
    orderService = {
      getAwaitingOrders: vi.fn().mockReturnValue(of([])),
      getOrder: vi.fn(),
      approveOrder: vi.fn(),
      rejectOrder: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OrderService, useValue: orderService },
        { provide: AlertService, useValue: alert },
        { provide: NeedsAttentionService, useValue: attention },
        { provide: ListStateService, useValue: { load: vi.fn().mockReturnValue({}), save: vi.fn() } },
        { provide: ConnectivityService, useValue: { isOnline: signal(true) } },
        {
          provide: SignalRService,
          useValue: {
            startStaffOrdersHub: vi.fn(),
            stopStaffOrdersHub: vi.fn(),
            orderChanged: hub.asObservable(),
            orderMessage: new Subject<unknown>().asObservable(),
          },
        },
        {
          provide: AuthService,
          useValue: { canReadChat: () => true, canWriteChat: () => true, canWriteOrders: () => canWrite },
        },
        { provide: ConversationInboxService, useValue: { unreadFor: vi.fn(() => 0) } },
        {
          provide: ConversationService,
          useValue: {
            getOrderConversation: vi.fn(() =>
              of({ conversationId: null, orderId: 'o1', orderNumber: 1, title: 'Order #1', canSend: true, unreadCount: 0, messages: [] }),
            ),
          },
        },
      ],
    });
  });

  it('lists the waiting orders oldest first', () => {
    orderService.getAwaitingOrders.mockReturnValue(
      of([
        waiting('o2', { orderNumber: 2, createdAt: '2026-10-11T10:00:00Z' }),
        waiting('o1', { orderNumber: 1, createdAt: '2026-10-11T09:00:00Z' }),
      ]),
    );
    init();

    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('#1'), expect.stringContaining('#2')]);
  });

  it('says so when nothing is waiting', () => {
    init();

    expect(el().querySelector('[data-testid="awaiting-empty"]')).not.toBeNull();
  });

  it('puts a Chat button on every waiting order for staff who can read chat', () => {
    orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { orderNumber: 1 }), waiting('o2', { orderNumber: 2 })]));
    init();

    expect(el().querySelectorAll('[data-chat-button]').length).toBe(2);
  });

  it('accepts an order, takes it off the list, refreshes the count and says so', () => {
    orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { orderNumber: 7 })]));
    orderService.approveOrder.mockReturnValue(of(waiting('o1', { status: OrderStatusEnum.Pending })));
    init();

    buttons('Accept')[0].click();
    fixture.detectChanges();

    expect(orderService.approveOrder).toHaveBeenCalledWith('o1');
    expect(rows()).toHaveLength(0);
    expect(alert.success).toHaveBeenCalledWith('Order #7 accepted.');
    expect(attention.refresh).toHaveBeenCalled();
  });

  it('blocks both buttons while the answer is being sent', () => {
    orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
    orderService.approveOrder.mockReturnValue(new Subject());
    init();

    buttons('Accept')[0].click();
    fixture.detectChanges();

    expect(el().textContent).toContain('Accepting...');
    expect(buttons('Reject')[0].disabled).toBe(true);
    buttons('Accepting')[0].click();
    expect(orderService.approveOrder).toHaveBeenCalledTimes(1);
  });

  it('shows the error and reloads the list when an order cannot be accepted', () => {
    orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
    orderService.approveOrder.mockReturnValue(throwError(() => new Error('This order is no longer waiting for approval.')));
    init();
    orderService.getAwaitingOrders.mockClear();
    orderService.getAwaitingOrders.mockReturnValue(of([]));

    buttons('Accept')[0].click();
    fixture.detectChanges();

    expect(alert.error).toHaveBeenCalledWith('This order is no longer waiting for approval.');
    expect(orderService.getAwaitingOrders).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(0);
  });

  it('rejects with the reason typed in the dialog', () => {
    orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { orderNumber: 7 })]));
    orderService.rejectOrder.mockReturnValue(of(waiting('o1', { status: OrderStatusEnum.Cancelled })));
    init();

    buttons('Reject')[0].click();
    fixture.detectChanges();
    const area = el().querySelector('app-reject-order-dialog textarea') as HTMLTextAreaElement;
    area.value = 'We are closed today';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttons('Reject Order')[0].click();
    fixture.detectChanges();

    expect(orderService.rejectOrder).toHaveBeenCalledWith('o1', 'We are closed today');
    expect(rows()).toHaveLength(0);
    expect(alert.success).toHaveBeenCalledWith('Order #7 rejected.');
  });

  it('gives staff who cannot answer orders no Accept or Reject buttons', () => {
    canWrite = false;
    orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
    init();

    expect(buttons('Accept')).toHaveLength(0);
    expect(buttons('Reject')).toHaveLength(0);
  });

  it('adds an order that arrives live and drops one that someone else answered', () => {
    init();

    orderService.getOrder.mockReturnValue(of(waiting('o5', { orderNumber: 5 })));
    hub.next('o5');
    fixture.detectChanges();
    expect(rows()).toHaveLength(1);

    orderService.getOrder.mockReturnValue(of(waiting('o5', { orderNumber: 5, status: OrderStatusEnum.Pending })));
    hub.next('o5');
    fixture.detectChanges();
    expect(rows()).toHaveLength(0);
  });

  it('opens the order when its row is pressed', () => {
    orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    init();

    (rows()[0].querySelector('[role="button"]') as HTMLElement).click();

    expect(navigate).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('o1'));
  });
});
