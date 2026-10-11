import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { AlertService } from '@core/services/alert.service';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { PublicLinkInvalidError, PublicOrderService } from '@core/services/public-order.service';
import {
  PublicAddOnGroupDto,
  PublicOrderDto,
  PublicOrderLinkDto,
  PublicProductDto,
} from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import type { ConversationListDto } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { internals, Internals, stubRoute } from '../../testing/management-spec-helpers';
import {
  MENU_STALE_AFTER_MS,
  ORDERS_POLL_MS,
  PROGRAMMATIC_SCROLL_MS,
  PublicOrderComponent,
} from './public-order';

const product = (id: string, name: string, price: number, category = 1): PublicProductDto => ({
  id,
  name,
  description: `${name} desc`,
  price,
  category,
  addOnCount: 0,
});

const SIZE: PublicAddOnGroupDto = {
  type: 1,
  displayName: 'Size',
  options: [product('s-l', 'Large', 30), product('s-r', 'Regular', 0)],
};

function link(over: Partial<PublicOrderLinkDto['catalog']> = {}): PublicOrderLinkDto {
  return {
    firstName: 'Maria',
    address: '12 Main St',
    catalog: {
      products: [
        product('latte', 'Latte', 150, 1),
        product('croissant', 'Croissant', 120, 2),
        product('cake', 'Cake', 200, 3),
      ],
      addOnsByProductId: { latte: [SIZE] },
      ...over,
    },
  };
}

const order = (
  id: string,
  createdAt: string,
  over: Partial<PublicOrderDto> = {},
): PublicOrderDto => ({
  id,
  orderNumber: 1001,
  createdAt,
  statusLabel: 'Waiting for confirmation',
  statusKind: 'waiting',
  items: [
    {
      name: 'Latte',
      quantity: 2,
      unitPrice: 150,
      addOns: [{ name: 'Large', quantity: 1, unitPrice: 30 }],
      specialInstructions: 'less ice',
    },
  ],
  total: 360,
  fulfillmentType: 'Delivery',
  deliveryAddress: '5 Side St',
  paymentMethod: 'Cash',
  amountReceived: 500,
  ...over,
});

describe('PublicOrderComponent', () => {
  let fixture: ComponentFixture<PublicOrderComponent>;
  let c: Internals;
  let service: {
    getLink: ReturnType<typeof vi.fn>;
    getOrders: ReturnType<typeof vi.fn>;
    createOrder: ReturnType<typeof vi.fn>;
    getConversations: ReturnType<typeof vi.fn>;
    getOrderConversation: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    markConversationRead: ReturnType<typeof vi.fn>;
  };

  function setup(opts: { link?: unknown; orders?: unknown; token?: string; conversations?: ConversationListDto } = {}) {
    alerts = { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() };
    service = {
      getLink: vi.fn(() => opts.link ?? of(link())),
      getOrders: vi.fn(
        () => opts.orders ?? of({ items: [], page: 1, pageSize: 50, totalCount: 0 }),
      ),
      createOrder: vi.fn(),
      getConversations: vi.fn(() => of(opts.conversations ?? { unreadConversations: 0, items: [] })),
      getOrderConversation: vi.fn(() =>
        of({ conversationId: null, orderId: 'o1', orderNumber: 1, title: 'Order #1', canSend: true, unreadCount: 0, messages: [] }),
      ),
      sendMessage: vi.fn(),
      markConversationRead: vi.fn(() => of(undefined)),
    };
    live = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      orderMessage$: new Subject<{ conversationId: string; orderId: string }>(),
      conversationRead$: new Subject<{ conversationId: string; orderId: string }>(),
      orderStatusChanged$: new Subject<string>(),
      linkRevoked$: new Subject<void>(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PublicOrderService, useValue: service },
        { provide: AlertService, useValue: alerts },
        {
          provide: PublicOrderHubService,
          useValue: {
            connect: live.connect,
            disconnect: live.disconnect,
            orderMessage: live.orderMessage$.asObservable(),
            conversationRead: live.conversationRead$.asObservable(),
            orderStatusChanged: live.orderStatusChanged$.asObservable(),
            linkRevoked: live.linkRevoked$.asObservable(),
          },
        },
        { provide: ActivatedRoute, useValue: stubRoute({ token: opts.token ?? 'tok-1' }) },
      ],
    });
    fixture = TestBed.createComponent(PublicOrderComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  /** Adds the croissant (no add-ons): the picker always opens, so confirm it like a customer would. */
  function addCroissant() {
    c.openProduct(c.products()[1]);
    c.onPicked({ addOns: [], quantity: 1, specialInstructions: null });
  }

  let alerts: { success: Mock; warning: Mock; info: Mock; error: Mock };
  let live: {
    connect: Mock;
    disconnect: Mock;
    orderMessage$: Subject<{ conversationId: string; orderId: string }>;
    conversationRead$: Subject<{ conversationId: string; orderId: string }>;
    orderStatusChanged$: Subject<string>;
    linkRevoked$: Subject<void>;
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';

  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('keeping the order on reload', () => {
    const KEY = 'wtf.public-cart.tok-1';
    const savedLine = (productId: string, over: Record<string, unknown> = {}) => ({
      key: productId + '||',
      productId,
      name: 'Old name',
      price: 1,
      quantity: 2,
      addOns: [],
      specialInstructions: null,
      ...over,
    });

    it('saves the choices as the cart changes, and forgets them when the cart is emptied', () => {
      setup();
      addCroissant();
      fixture.detectChanges();
      const saved = JSON.parse(sessionStorage.getItem(KEY)!);
      expect(saved.lines.length).toBe(1);
      expect(saved.lines[0].productId).toBe(c.products()[1].id);

      c.clearCart();
      fixture.detectChanges();
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it('brings the saved cart back after a reload, with names and prices from the fresh menu', () => {
      const croissant = link().catalog.products[1];
      sessionStorage.setItem(
        KEY,
        JSON.stringify({ savedAt: Date.now(), lines: [savedLine(croissant.id)] }),
      );

      setup();

      expect(c.cart().length).toBe(1);
      expect(c.cart()[0].quantity).toBe(2);
      expect(c.cart()[0].name).toBe(croissant.name);
      expect(c.cart()[0].price).toBe(croissant.price);
      expect(alerts.warning).toHaveBeenCalledWith(expect.stringContaining('prices have changed'));
    });

    it('drops saved items the menu no longer sells and says so', () => {
      const croissant = link().catalog.products[1];
      sessionStorage.setItem(
        KEY,
        JSON.stringify({
          savedAt: Date.now(),
          lines: [savedLine(croissant.id), savedLine('gone', { key: 'gone||' })],
        }),
      );

      setup();

      expect(c.cart().map((l: { productId: string }) => l.productId)).toEqual([croissant.id]);
      expect(alerts.warning).toHaveBeenCalledWith(expect.stringContaining('no longer available'));
    });

    it('ignores a cart saved more than a day ago', () => {
      const croissant = link().catalog.products[1];
      sessionStorage.setItem(
        KEY,
        JSON.stringify({ savedAt: Date.now() - 25 * 60 * 60 * 1000, lines: [savedLine(croissant.id)] }),
      );

      setup();

      expect(c.cart()).toEqual([]);
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it('ignores saved data that is not a cart', () => {
      sessionStorage.setItem(KEY, '{not json');
      setup();
      expect(c.cart()).toEqual([]);

      sessionStorage.setItem(
        KEY,
        JSON.stringify({ savedAt: Date.now(), lines: [{ productId: 5, quantity: 'many' }, null] }),
      );
      TestBed.resetTestingModule();
      setup();
      expect(c.cart()).toEqual([]);
    });

    it('keeps the cart of each link apart', () => {
      const croissant = link().catalog.products[1];
      sessionStorage.setItem(
        'wtf.public-cart.other',
        JSON.stringify({ savedAt: Date.now(), lines: [savedLine(croissant.id)] }),
      );

      setup();

      expect(c.cart()).toEqual([]);
    });
  });

  describe('chat with the shop', () => {
    const list = (unread: number, items: Record<string, unknown>[] = []) =>
      ({
        unreadConversations: unread,
        items: items.map((item, i) => ({
          id: 'c' + i,
          orderId: 'o' + i,
          orderNumber: 1000 + i,
          title: 'Order #' + (1000 + i),
          customerName: null,
          lastMessage: 'Ready at 5',
          lastSender: 'staff',
          lastMessageAt: new Date().toISOString(),
          unreadCount: 1,
          ...item,
        })),
      }) as ConversationListDto;
    const badges = () => [...el().querySelectorAll('[data-envelope-badge]')].map((b) => b.textContent!.trim());
    const panel = () => el().querySelector('[data-public-chat]') as HTMLElement;

    it('listens for the shops news once the page opens, with the link token', () => {
      setup();

      expect(live.connect).toHaveBeenCalledTimes(1);
      expect(live.connect).toHaveBeenCalledWith('tok-1');
    });

    it('does not listen at all without a token', () => {
      setup({ token: '' });

      expect(live.connect).not.toHaveBeenCalled();
    });

    it('loads my conversations once the menu is in', () => {
      setup();

      expect(service.getConversations).toHaveBeenCalledWith('tok-1');
    });

    it('shows the envelope with the number of unread chats, in the side bar and the top bar', () => {
      setup({ conversations: list(2) });

      expect(el().querySelectorAll('[data-envelope]').length).toBe(2);
      expect(badges()).toEqual(['2', '2']);
    });

    it('shows no number when nothing is unread', () => {
      setup({ conversations: list(0) });

      expect(badges()).toEqual([]);
    });

    it('shows no badge on the orders list: the envelope has the unread count', () => {
      setup({
        orders: of({
          items: [order('o0', '2026-01-11T09:00:00', { orderNumber: 1000 }), order('o9', '2026-01-10T09:00:00', { orderNumber: 1009 })],
          page: 1,
          pageSize: 50,
          totalCount: 2,
        }),
        conversations: list(1, [{ orderId: 'o0', unreadCount: 3 }]),
      });
      c.selectTab('orders');
      fixture.detectChanges();

      expect(el().querySelector('[data-row-unread]')).toBeNull();
    });

    describe('live news', () => {
      it('loads my conversations again when a message arrives', () => {
        setup();
        service.getConversations.mockClear();

        live.orderMessage$.next({ conversationId: 'c1', orderId: 'o1' });

        expect(service.getConversations).toHaveBeenCalledTimes(1);
      });

      it('loads them again when a chat was read on another screen', () => {
        setup();
        service.getConversations.mockClear();

        live.conversationRead$.next({ conversationId: 'c1', orderId: 'o1' });

        expect(service.getConversations).toHaveBeenCalledTimes(1);
      });

      it('shows the new number after a message', () => {
        setup({ conversations: list(0) });
        service.getConversations.mockReturnValue(of(list(1, [{}])));

        live.orderMessage$.next({ conversationId: 'c1', orderId: 'o1' });
        fixture.detectChanges();

        expect(badges()).toEqual(['1', '1']);
      });

      it('refreshes my orders and chats at once when an order changes', () => {
        setup();
        service.getOrders.mockClear();
        service.getConversations.mockClear();

        live.orderStatusChanged$.next('o1');

        expect(service.getOrders).toHaveBeenCalledTimes(1);
        expect(service.getConversations).toHaveBeenCalledTimes(1);
      });

      it('shows the invalid link page when the link is revoked while the page is open', () => {
        setup();

        live.linkRevoked$.next();
        fixture.detectChanges();

        expect(c.state()).toBe('invalid');
      });

      it('stops listening when the page goes away', () => {
        setup();

        fixture.destroy();
        service.getConversations.mockClear();
        live.orderMessage$.next({ conversationId: 'c1', orderId: 'o1' });

        expect(live.disconnect).toHaveBeenCalledTimes(1);
        expect(service.getConversations).not.toHaveBeenCalled();
      });
    });

    describe('the envelope list', () => {
      it('loads the list again each time it is opened', () => {
        setup({ conversations: list(0) });
        service.getConversations.mockClear();

        (el().querySelector('[data-envelope]') as HTMLElement).click();

        expect(service.getConversations).toHaveBeenCalledTimes(1);
      });

      it('opens the chat in place when a conversation is pressed', () => {
        setup({
          orders: of({
            items: [order('o0', '2026-01-11T09:00:00', { orderNumber: 1000 })],
            page: 1,
            pageSize: 50,
            totalCount: 1,
          }),
          conversations: list(1, [{ orderId: 'o0', orderNumber: 1000 }]),
        });
        (el().querySelector('[data-envelope]') as HTMLElement).click();
        fixture.detectChanges();

        (el().querySelector('[data-envelope-item]') as HTMLElement).click();
        fixture.detectChanges();

        expect(c.tab()).toBe('menu');
        expect(panel().className).toContain('translate-y-0');
        expect(service.getOrderConversation).toHaveBeenCalledWith('tok-1', 'o0');
        expect(el().querySelector('[data-chat-title]')!.textContent).toContain('Order #');
      });

      it('goes to the order from the chat when the button beside the title is pressed', () => {
        setup({
          orders: of({
            items: [order('o0', '2026-01-11T09:00:00', { orderNumber: 1000 })],
            page: 1,
            pageSize: 50,
            totalCount: 1,
          }),
          conversations: list(1, [{ orderId: 'o0', orderNumber: 1000 }]),
        });
        (el().querySelector('[data-envelope]') as HTMLElement).click();
        fixture.detectChanges();
        (el().querySelector('[data-envelope-item]') as HTMLElement).click();
        fixture.detectChanges();

        (el().querySelector('[data-chat-go-to-order]') as HTMLElement).click();
        fixture.detectChanges();

        expect(c.tab()).toBe('orders');
        expect(el().querySelector('[data-order-details]')).not.toBeNull();
        expect(panel().className).toContain('translate-y-full');
      });

      it('does nothing for a conversation that is not about an order', () => {
        setup({ conversations: list(1, [{ orderId: null }]) });
        (el().querySelector('[data-envelope]') as HTMLElement).click();
        fixture.detectChanges();

        (el().querySelector('[data-envelope-item]') as HTMLElement).click();
        fixture.detectChanges();

        expect(c.tab()).toBe('menu');
        expect(panel().className).toContain('translate-y-full');
      });
    });

    describe('the chat panel', () => {
      const PAGE = {
        items: [order('o2', '2026-01-11T09:00:00', { orderNumber: 1002 })],
        page: 1,
        pageSize: 50,
        totalCount: 1,
      };

      it('opens from the Chat button of an order, and closes', () => {
        setup({ orders: of(PAGE) });
        service.getOrderConversation.mockReturnValue(
          of({ conversationId: 'c', orderId: 'o2', orderNumber: 1002, title: 'Order #1002', canSend: true, unreadCount: 0, messages: [] }),
        );
        c.selectTab('orders');
        c.openOrder('o2');
        fixture.detectChanges();
        expect(panel().className).toContain('translate-y-full');

        (el().querySelector('[data-chat-button]') as HTMLElement).click();
        fixture.detectChanges();

        expect(panel().className).toContain('translate-y-0');
        expect(service.getOrderConversation).toHaveBeenCalledWith('tok-1', 'o2');
        expect(el().querySelector('[data-chat-title]')!.textContent).toContain('Order #1002');

        (el().querySelector('[data-chat-close]') as HTMLElement).click();
        fixture.detectChanges();
        expect(panel().className).toContain('translate-y-full');
      });

      it('refreshes the badges when the shops replies were read', () => {
        setup({ orders: of(PAGE) });
        service.getOrderConversation.mockReturnValue(
          of({ conversationId: 'c', orderId: 'o2', orderNumber: 1002, title: 'Order #1002', canSend: true, unreadCount: 2, messages: [] }),
        );
        service.getConversations.mockClear();
        c.selectTab('orders');
        c.openOrder('o2');
        fixture.detectChanges();

        (el().querySelector('[data-chat-button]') as HTMLElement).click();
        fixture.detectChanges();

        expect(service.markConversationRead).toHaveBeenCalledWith('tok-1', 'o2');
        expect(service.getConversations).toHaveBeenCalled();
      });

      it('shows the invalid link page when the link stopped working during the chat', () => {
        setup({ orders: of(PAGE) });
        service.getOrderConversation.mockReturnValue(throwError(() => new PublicLinkInvalidError()));
        c.selectTab('orders');
        c.openOrder('o2');
        fixture.detectChanges();

        (el().querySelector('[data-chat-button]') as HTMLElement).click();
        fixture.detectChanges();

        expect(c.state()).toBe('invalid');
      });
    });

    describe('problems loading conversations', () => {
      it('shows the invalid link page if the link no longer works', () => {
        setup();
        service.getConversations.mockReturnValue(throwError(() => new PublicLinkInvalidError()));

        c.loadConversations();

        expect(c.state()).toBe('invalid');
      });

      it('keeps the envelope as it was on any other failure', () => {
        setup({ conversations: list(2) });
        service.getConversations.mockReturnValue(throwError(() => new Error('offline')));

        c.loadConversations();
        fixture.detectChanges();

        expect(c.state()).toBe('ready');
        expect(badges()).toEqual(['2', '2']);
      });

      it('does not ask once the page has shown the invalid link', () => {
        setup({ link: throwError(() => new PublicLinkInvalidError()) });
        service.getConversations.mockClear();

        c.loadConversations();

        expect(service.getConversations).not.toHaveBeenCalled();
      });
    });
  });

  describe('loading', () => {
    it('loads the menu for the token in the address and greets the customer', () => {
      setup();
      expect(service.getLink).toHaveBeenCalledWith('tok-1');
      expect(c.state()).toBe('ready');
      expect(text()).toContain('Ordering as');
      expect(text()).toContain('Maria');
      expect(text()).toContain('Latte');
      expect(text()).toContain('150.00');
    });

    it('shows a spinner while loading', () => {
      setup({ link: new Subject() });
      expect(c.state()).toBe('loading');
      expect(el().querySelector('.loading-spinner')).not.toBeNull();
    });

    it('shows the invalid link page for an unknown, expired or revoked link', () => {
      setup({ link: throwError(() => new PublicLinkInvalidError()) });
      expect(c.state()).toBe('invalid');
      expect(text()).toContain('This link is no longer valid');
      expect(el().querySelector('app-link-invalid')).not.toBeNull();
    });

    it('shows the message and a retry button for other failures', () => {
      setup({ link: throwError(() => new Error('Unable to connect to server.')) });
      expect(c.state()).toBe('error');
      expect(text()).toContain('Unable to connect to server.');

      service.getLink.mockReturnValue(of(link()));
      (el().querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(c.state()).toBe('ready');
    });

    it('keeps the menu on screen but warns when a background refresh fails', () => {
      setup();
      service.getLink.mockReturnValue(throwError(() => new Error('Unable to connect.')));
      c.loadMenu(true);
      expect(c.state()).toBe('ready');
      expect(alerts.warning).toHaveBeenCalledWith(expect.stringContaining('may be out of date'));
    });

    it('turns into the invalid page when the link is revoked during a refresh', () => {
      setup();
      service.getLink.mockReturnValue(throwError(() => new PublicLinkInvalidError()));
      c.loadMenu(true);
      expect(c.state()).toBe('invalid');
    });
  });

  describe('menu', () => {
    it('filters by search text on the name and description', () => {
      setup();
      c.onSearch('crois');
      expect(c.filteredProducts().map((p: PublicProductDto) => p.name)).toEqual(['Croissant']);
      c.onSearch('CAKE desc');
      expect(c.filteredProducts().map((p: PublicProductDto) => p.name)).toEqual(['Cake']);
      c.onSearch('nothing');
      fixture.detectChanges();
      expect(text()).toContain('Nothing matches your search.');
    });

    it('says so when the menu is empty', () => {
      setup({ link: of(link({ products: [], addOnsByProductId: {} })) });
      expect(text()).toContain('The menu is empty right now');
    });

    it('reloads a fresh menu every time the customer comes back to the Menu tab', () => {
      setup();
      expect(service.getLink).toHaveBeenCalledTimes(1);
      c.selectTab('orders');
      c.selectTab('menu');
      expect(service.getLink).toHaveBeenCalledTimes(2);
      c.selectTab('menu');
      expect(service.getLink).toHaveBeenCalledTimes(2);
    });
  });

  describe('category tabs and sections (same as the shop screen)', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView as never;
    });

    const tabs = () => [...el().querySelectorAll('[role="tab"][data-menu-tab]')] as HTMLElement[];

    it('has one underlined tab and one titled section per category that has products', () => {
      setup();
      expect(tabs().map((t) => t.textContent?.trim())).toEqual(['Drinks', 'Food', 'Desserts']);
      expect(c.sections().map((x: { label: string }) => x.label)).toEqual([
        'Drinks',
        'Food',
        'Desserts',
      ]);
      expect(el().querySelector('#category-1 h3')?.textContent).toContain('Drinks');
      expect(el().querySelector('#category-2 h3')?.textContent).toContain('Food');
      expect(
        el().querySelector('[aria-label="Menu categories"]')!.parentElement!.className,
      ).toContain('border-b');
    });

    it('highlights the first tab to begin with', () => {
      setup();
      expect(c.highlightedCategory()).toBe(1);
      expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
      expect(tabs()[1].getAttribute('aria-selected')).toBe('false');
    });

    it('shows a single category as a single section and tab', () => {
      setup({
        link: of(link({ products: [product('a', 'A', 10, 1), product('b', 'B', 10, 1)] })),
      });
      expect(c.sections().length).toBe(1);
      expect(tabs().length).toBe(1);
    });

    it('drops tabs and sections that have no match for the search', () => {
      setup();
      c.onSearch('crois');
      fixture.detectChanges();
      expect(c.sections().map((x: { id: number }) => x.id)).toEqual([2]);
      expect(tabs().length).toBe(1);
      expect(c.highlightedCategory()).toBe(2);
    });

    it('scrolls to the section and highlights the tab when a tab is clicked', () => {
      vi.useFakeTimers();
      setup();
      tabs()[1].click();
      fixture.detectChanges();

      expect(c.activeCategory()).toBe(2);
      expect(c.highlightedCategory()).toBe(2);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
      expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    });

    it('ignores scroll events while it glides to a clicked section, then follows the scroll again', () => {
      vi.useFakeTimers();
      setup();
      const container = el().querySelector('[data-menu-scroll]') as HTMLElement;
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        bottom: 500,
        height: 500,
      } as DOMRect);
      const sectionRects: Record<string, { top: number; bottom: number }> = {
        'category-1': { top: -600, bottom: -100 },
        'category-2': { top: -80, bottom: 300 },
        'category-3': { top: 300, bottom: 700 },
      };
      for (const [id, rect] of Object.entries(sectionRects)) {
        vi.spyOn(document.getElementById(id)!, 'getBoundingClientRect').mockReturnValue(
          rect as DOMRect,
        );
      }

      c.selectCategoryTab(3);
      container.dispatchEvent(new Event('scroll'));
      expect(c.highlightedCategory()).toBe(3);

      vi.advanceTimersByTime(PROGRAMMATIC_SCROLL_MS + 1);
      container.dispatchEvent(new Event('scroll'));
      expect(c.highlightedCategory()).toBe(2);
    });

    it('highlights the last category when scrolled to the bottom', () => {
      setup();
      const container = el().querySelector('[data-menu-scroll]') as HTMLElement;
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(container, 'scrollTop', { value: 600, configurable: true });

      container.dispatchEvent(new Event('scroll'));

      expect(c.highlightedCategory()).toBe(3);
    });

    it('moves the highlight to the category in view while scrolling', () => {
      setup();
      const container = el().querySelector('[data-menu-scroll]') as HTMLElement;
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        bottom: 500,
        height: 500,
      } as DOMRect);
      vi.spyOn(document.getElementById('category-1')!, 'getBoundingClientRect').mockReturnValue({
        top: -400,
        bottom: 50,
      } as DOMRect);
      vi.spyOn(document.getElementById('category-2')!, 'getBoundingClientRect').mockReturnValue({
        top: 50,
        bottom: 400,
      } as DOMRect);
      vi.spyOn(document.getElementById('category-3')!, 'getBoundingClientRect').mockReturnValue({
        top: 400,
        bottom: 800,
      } as DOMRect);

      container.dispatchEvent(new Event('scroll'));
      expect(c.highlightedCategory()).toBe(2);
    });
  });

  describe('page layout (same shell as the signed-in app)', () => {
    const sidebar = () => el().querySelector('aside.border-r') as HTMLElement;
    const dock = () => el().querySelector('.dock') as HTMLElement;
    const dockButtons = () => [...dock().querySelectorAll('button')] as HTMLButtonElement[];
    const cartAside = () => el().querySelector('aside.xl\\:flex') as HTMLElement;

    it('uses the same frame: full height, no page scroll, sidebar beside the content on wide screens', () => {
      setup();
      const frame = el().firstElementChild as HTMLElement;
      expect(frame.className).toContain('flex-col');
      expect(frame.className).toContain('overflow-hidden');
      expect(frame.firstElementChild!.className).toContain('sm:flex-row');
    });

    it('shows a side navigation bar on wide screens with the shop name, the customer and the pages', () => {
      setup();
      expect(sidebar().parentElement!.className).toContain('hidden');
      expect(sidebar().parentElement!.className).toContain('sm:flex');
      expect(sidebar().className).toContain('w-60');
      expect(sidebar().textContent).toContain('WTF');
      expect(sidebar().textContent).toContain('Maria');
      const items = [...sidebar().querySelectorAll('nav button')].map((b) => b.textContent?.trim());
      expect(items).toEqual(['Menu', 'My orders']);
    });

    it('marks the open page in the side bar and switches pages from it', () => {
      setup();
      const [menu, orders] = [...sidebar().querySelectorAll('nav button')] as HTMLButtonElement[];
      expect(menu.className).toContain('sidebar-active');
      expect(orders.className).not.toContain('sidebar-active');

      orders.click();
      fixture.detectChanges();
      expect(c.tab()).toBe('orders');
      expect(orders.className).toContain('sidebar-active');
      expect(menu.className).not.toContain('sidebar-active');
    });

    it('collapses the side bar to icons and expands it again', () => {
      setup();
      const toggle = sidebar().querySelector(
        '[aria-label="Collapse sidebar"]',
      ) as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();
      expect(sidebar().className).toContain('w-21');
      expect(sidebar().className).toContain('sidebar-collapsed');
      expect(sidebar().querySelector('[aria-label="Expand sidebar"]')).not.toBeNull();

      (sidebar().querySelector('[aria-label="Expand sidebar"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(sidebar().className).toContain('w-60');
    });

    describe('profile picture', () => {
      const withPicture = () => ({ ...link(), imageUrl: 'https://cdn.example.com/maria.png' });
      const pictures = () =>
        [...el().querySelectorAll('img[alt="Your profile picture"]')] as HTMLImageElement[];

      it("shows the customer's picture in the side bar and in the phone header", () => {
        setup({ link: of(withPicture()) });
        expect(pictures().length).toBe(2);
        for (const picture of pictures()) {
          expect(picture.getAttribute('src')).toBe('https://cdn.example.com/maria.png');
        }
        expect(sidebar().querySelector('img[alt="Your profile picture"]')).not.toBeNull();
        expect(el().querySelector('.navbar img[alt="Your profile picture"]')).not.toBeNull();
      });

      it('shows the initials when the customer has no picture', () => {
        setup();
        expect(pictures().length).toBe(0);
        expect(sidebar().querySelector('app-avatar')).not.toBeNull();
        expect(el().querySelector('.navbar app-avatar')).not.toBeNull();
        expect(c.profileImage()).toBeNull();
      });

      it('falls back to the initials when the picture cannot be loaded', () => {
        setup({ link: of(withPicture()) });
        pictures()[0].dispatchEvent(new Event('error'));
        fixture.detectChanges();

        expect(c.imageFailed()).toBe(true);
        expect(pictures().length).toBe(0);
        expect(sidebar().querySelector('app-avatar')).not.toBeNull();
        expect(el().querySelector('.navbar app-avatar')).not.toBeNull();
      });

      it('tries again when a refreshed menu brings a different picture', () => {
        setup({ link: of(withPicture()) });
        c.imageFailed.set(true);

        service.getLink.mockReturnValue(
          of({ ...link(), imageUrl: 'https://cdn.example.com/maria-new.png' }),
        );
        c.loadMenu(true);
        fixture.detectChanges();

        expect(c.imageFailed()).toBe(false);
        expect(pictures()[0].getAttribute('src')).toBe('https://cdn.example.com/maria-new.png');
      });

      it('keeps showing initials after a refresh that returns the same broken picture', () => {
        setup({ link: of(withPicture()) });
        c.imageFailed.set(true);

        c.loadMenu(true);
        fixture.detectChanges();

        expect(c.imageFailed()).toBe(true);
        expect(pictures().length).toBe(0);
      });
    });

    it('shows a header and a bottom dock with the two pages on phones only', () => {
      setup();
      const header = el().querySelector('.navbar') as HTMLElement;
      expect(header.className).toContain('sm:hidden');
      expect(header.textContent).toContain('WTF');
      expect(header.textContent).toContain('Maria');

      expect(dock().className).toContain('dock-md');
      expect(dock().className).toContain('sm:hidden');
      expect(dock().className).toContain('pb-[env(safe-area-inset-bottom)]');
      expect(dockButtons().map((b) => b.textContent?.trim())).toEqual(['Menu', 'My orders']);
      expect(dockButtons().every((b) => b.getAttribute('type') === 'button')).toBe(true);
    });

    it('highlights the open page in the dock and switches pages from it', () => {
      setup();
      expect(dockButtons()[0].className).toContain('dock-active');
      expect(dockButtons()[1].className).not.toContain('dock-active');

      dockButtons()[1].click();
      fixture.detectChanges();
      expect(c.tab()).toBe('orders');
      expect(dockButtons()[1].className).toContain('dock-active');
      expect(dockButtons()[0].className).not.toContain('dock-active');
      expect(service.getOrders).toHaveBeenCalled();
    });

    it('pads the content like the signed-in screens, so the View Order button is the same width', () => {
      setup();
      addCroissant();
      fixture.detectChanges();
      const button = [...el().querySelectorAll('button')].find((b) =>
        b.textContent?.includes('View Order'),
      ) as HTMLButtonElement;
      expect(button.className).toContain('inset-x-0');
      expect(button.className).not.toContain('inset-x-4');
      expect(button.className).toContain('bottom-4');

      // The button sits in the same wrapper the order screen uses, inside the same padded area.
      const wrapper = button.parentElement as HTMLElement;
      expect(wrapper.className).toContain('relative');
      expect(wrapper.className).toContain('h-full');
      expect(wrapper.className).toContain('xl:flex-row');
      const padded = wrapper.parentElement as HTMLElement;
      expect(padded.className).toContain('px-4');
      expect(padded.className).toContain('py-4');
      expect(padded.className).toContain('md:px-6');
      expect(padded.className).toContain('md:py-6');
    });

    it('has a collapsible cart panel on wide screens like the shop cart', () => {
      setup();
      expect(cartAside().className).toContain('xl:w-[336px]');
      expect(c.isCartCollapsed()).toBe(false);

      const rail = cartAside().querySelector('[aria-label="Collapse cart"]') as HTMLButtonElement;
      expect(rail.className).toContain('hidden');
      expect(rail.className).toContain('xl:block');
      rail.click();
      fixture.detectChanges();

      expect(c.isCartCollapsed()).toBe(true);
      expect(cartAside().className).toContain('xl:w-[88px]');
      expect(cartAside().querySelector('[aria-label="Expand cart"]')).not.toBeNull();

      (cartAside().querySelector('[aria-label="Expand cart"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(cartAside().className).toContain('xl:w-[336px]');
    });

    it('shows the item count and total in the collapsed cart', () => {
      setup();
      addCroissant();
      addCroissant();
      c.toggleCartCollapse();
      fixture.detectChanges();

      const collapsed = [...cartAside().querySelectorAll('div')].find((d) =>
        d.className.includes('[writing-mode:vertical-rl]'),
      ) as HTMLElement;
      expect(collapsed.textContent).toContain('240.00');
      expect(cartAside().textContent).toContain('2');
    });

    it('hides the cart panel, the drawer and the View Order button on My orders', () => {
      setup();
      addCroissant();
      c.selectTab('orders');
      fixture.detectChanges();

      expect(cartAside()).toBeNull();
      expect(el().querySelector('app-cart-drawer')).toBeNull();
      expect(text()).not.toContain('View Order');
    });

    it('expands a collapsed cart when it is opened on a phone', () => {
      setup();
      c.toggleCartCollapse();
      c.openCart();
      expect(c.isCartCollapsed()).toBe(false);
      expect(c.cartOpen()).toBe(true);
    });

    it('tells the cart sheet how wide the side bar is, and clears it when the page goes away', () => {
      const original = window.ResizeObserver;
      const observers: { cb: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
      window.ResizeObserver = class {
        public disconnect = vi.fn();
        public constructor(public cb: () => void) {
          observers.push(this);
        }
        public observe(): void {
          /* nothing to do */
        }
        public unobserve(): void {
          /* nothing to do */
        }
      } as never;

      try {
        setup();
        const host = el().querySelector('aside.border-r')!.parentElement as HTMLElement;
        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ width: 240 } as DOMRect);
        observers[observers.length - 1].cb();
        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('240px');

        fixture.destroy();
        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('0px');
        expect(observers.some((o) => o.disconnect.mock.calls.length > 0)).toBe(true);
      } finally {
        window.ResizeObserver = original;
      }
    });
  });

  describe('toolbar and cards (same look as the shop screens)', () => {
    it('uses the shop search box style', () => {
      setup();
      const box = el().querySelector('app-search-input')!.parentElement!;
      expect(box.className).toContain('bg-gray-50');
      expect(box.className).toContain('rounded-lg');
      expect(box.className).toContain('md:max-w-104');
      expect(el().querySelector('input[type="search"]')).not.toBeNull();
    });

    it('searches as the customer types', () => {
      setup();
      const input = el().querySelector('input[type="search"]') as HTMLInputElement;
      input.value = 'crois';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(c.search()).toBe('crois');
      expect(c.filteredProducts().length).toBe(1);
    });

    it('puts a ghost refresh icon at the far right of the full-width toolbar and reloads the menu', () => {
      setup();
      const refresh = el().querySelector('[aria-label="Refresh menu"]') as HTMLButtonElement;
      expect(refresh.className).toContain('app-btn-ghost');
      expect(refresh.className).toContain('ml-auto');
      expect(refresh.textContent?.trim()).toBe('');
      expect(refresh.closest('[class*="max-w-"]')).toBeNull();

      refresh.click();
      expect(service.getLink).toHaveBeenCalledTimes(2);
    });

    it('spins and disables the refresh icon while the menu reloads', () => {
      setup();
      service.getLink.mockReturnValue(new Subject());
      c.loadMenu(true);
      fixture.detectChanges();
      const refresh = el().querySelector('[aria-label="Refresh menu"]') as HTMLButtonElement;
      expect(refresh.disabled).toBe(true);
      expect(refresh.querySelector('.animate-spin')).not.toBeNull();
    });

    it('shows the price in the same bottom spot whether or not a product has a description', () => {
      setup({
        link: of(
          link({
            products: [
              { ...product('a', 'With text', 10), description: 'A long description' },
              { ...product('b', 'Without text', 20), description: null },
            ],
            addOnsByProductId: {},
          }),
        ),
      });

      const cards = [...el().querySelectorAll('[role="button"].card')] as HTMLElement[];
      expect(cards.length).toBe(2);
      for (const card of cards) {
        expect(card.className).toContain('min-h-60');
        const price = card.querySelector('.card-actions');
        expect(price).not.toBeNull();
        expect(price!.className).toContain('mt-auto');
        expect(price!.closest('.card-body')!.className).toContain('justify-between');
      }
      expect(cards[0].textContent).toContain('A long description');
      expect(cards[1].textContent).not.toContain('A long description');
    });

    it('opens the picker from a card by click or keyboard', () => {
      setup();
      const card = el().querySelector('[role="button"].card') as HTMLElement;
      card.click();
      expect(c.pickerProduct()?.id).toBe('latte');
      c.closePicker();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(c.pickerProduct()?.id).toBe('latte');
    });

    it('puts the same refresh icon at the far right of My orders', () => {
      setup();
      c.selectTab('orders');
      fixture.detectChanges();
      const refresh = el().querySelector('[aria-label="Refresh orders"]') as HTMLButtonElement;
      expect(refresh.className).toContain('app-btn-ghost');
      expect(refresh.parentElement!.className).toContain('ml-auto');
      expect(refresh.closest('[class*="max-w-"]')).toBeNull();

      refresh.click();
      expect(service.getOrders).toHaveBeenCalledTimes(2);
    });

    it('spins and disables the orders refresh icon while loading', () => {
      setup({ orders: new Subject() });
      c.selectTab('orders');
      fixture.detectChanges();
      const refresh = el().querySelector('[aria-label="Refresh orders"]') as HTMLButtonElement;
      expect(refresh.disabled).toBe(true);
      expect(refresh.querySelector('.animate-spin')).not.toBeNull();
    });
  });

  describe('cart', () => {
    it('opens the picker even for a product with no add-ons, then adds it', () => {
      setup();
      c.openProduct(c.products()[1]);
      expect(c.pickerProduct()?.id).toBe('croissant');
      expect(c.pickerGroups()).toEqual([]);
      expect(c.cart().length).toBe(0);

      c.onPicked({ addOns: [], quantity: 3, specialInstructions: null });

      expect(c.pickerProduct()).toBeNull();
      expect(c.cart()[0]).toMatchObject({ productId: 'croissant', price: 120, quantity: 3 });
      expect(c.cartCount()).toBe(3);
      expect(c.cartTotal()).toBe(360);
    });

    it('opens the picker for a product that has add-ons and adds the chosen result', () => {
      setup();
      c.openProduct(c.products()[0]);
      expect(c.pickerProduct()?.id).toBe('latte');
      expect(c.pickerGroups()).toEqual([SIZE]);

      c.onPicked({
        addOns: [{ id: 's-l', name: 'Large', price: 30, quantity: 1 }],
        quantity: 2,
        specialInstructions: 'less ice',
      });

      expect(c.pickerProduct()).toBeNull();
      expect(c.cart()[0].quantity).toBe(2);
      expect(c.cartTotal()).toBe((150 + 30) * 2);
    });

    it('can cancel the picker without adding anything', () => {
      setup();
      c.openProduct(c.products()[0]);
      c.closePicker();
      expect(c.pickerProduct()).toBeNull();
      expect(c.cart().length).toBe(0);
    });

    it('merges identical lines and keeps different choices separate', () => {
      setup();
      const croissant = c.products()[1];
      addCroissant();
      addCroissant();
      expect(c.cart().length).toBe(1);
      expect(c.cart()[0].quantity).toBe(2);

      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [{ id: 's-r', name: 'Regular', price: 0, quantity: 1 }],
        quantity: 1,
        specialInstructions: null,
      });
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [{ id: 's-l', name: 'Large', price: 30, quantity: 1 }],
        quantity: 1,
        specialInstructions: null,
      });
      expect(c.cart().length).toBe(3);
    });

    it('prices add-ons by their quantity, shows the count in the cart and keeps different counts apart', () => {
      setup();
      const extra = { id: 'e-1', name: 'Extra shot', price: 40 };
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [
          { id: 's-r', name: 'Regular', price: 0, quantity: 1 },
          { ...extra, quantity: 2 },
        ],
        quantity: 2,
        specialInstructions: null,
      });
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [
          { id: 's-r', name: 'Regular', price: 0, quantity: 1 },
          { ...extra, quantity: 3 },
        ],
        quantity: 1,
        specialInstructions: null,
      });

      expect(c.cart().length).toBe(2);
      expect(c.unitPrice(c.cart()[0])).toBe(150 + 80);
      expect(c.cartTotal()).toBe((150 + 80) * 2 + (150 + 120));
      c.openCart();
      fixture.detectChanges();
      expect(text()).toContain('2x Extra shot (per unit)');
      expect(text()).toContain('3x Extra shot (per unit)');
    });

    it('has a drag handle so the bottom sheet can be dragged down, only below the wide layout', () => {
      setup();
      const handles = [...el().querySelectorAll('[data-cart-drag-handle]')] as HTMLElement[];
      expect(handles.length).toBeGreaterThan(0);
      for (const handle of handles) {
        expect(handle.className).toContain('cursor-grab');
        expect(handle.className).toContain('touch-none');
        expect(handle.className).toContain('xl:hidden');
      }
    });

    it('lays the order out like the shop cart: empty state, count, card per item and a total footer', () => {
      setup();
      c.openCart();
      fixture.detectChanges();
      expect(text()).toContain('Your Order');
      expect(text()).toContain('Your cart is empty');
      expect(text()).toContain('Add items to get started');

      addCroissant();
      fixture.detectChanges();
      expect(text()).toContain('1 item');
      expect(text()).not.toContain('Your cart is empty');
      const card = el().querySelector('[aria-label="Edit Croissant"]') as HTMLElement;
      expect(card.className).toContain('rounded-lg');
      expect(card.className).toContain('bg-gray-50');
      expect(card.textContent).toContain('120.00');
      expect(el().querySelector('.sticky.bottom-0')!.textContent).toContain('Total');
    });

    it('lists add-ons under the item with their prices and a per unit subtotal', () => {
      setup();
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [
          { id: 's-l', name: 'Large', price: 30, quantity: 1 },
          { id: 'e-1', name: 'Extra shot', price: 40, quantity: 2 },
        ],
        quantity: 1,
        specialInstructions: 'less ice',
      });
      c.openCart();
      fixture.detectChanges();

      const card = el().querySelector('[aria-label="Edit Latte"]') as HTMLElement;
      expect(card.textContent).toContain('Large');
      expect(card.textContent).toContain('2x Extra shot (per unit)');
      expect(card.textContent).toContain('80.00');
      expect(card.textContent).toContain('less ice');
      expect(card.textContent).toContain('260.00 / unit');
    });

    it('shows a no-cost add-on in the cart as +0.00, like the shop cart, and a paid one with its price', () => {
      setup();
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [
          { id: 's-r', name: 'Regular', price: 0, quantity: 1 },
          { id: 'e-1', name: 'Extra shot', price: 40, quantity: 1 },
        ],
        quantity: 1,
        specialInstructions: null,
      });
      c.openCart();
      fixture.detectChanges();

      const rows = [
        ...(el().querySelector('[aria-label="Edit Latte"]') as HTMLElement).querySelectorAll(
          '.border-t > div',
        ),
      ];
      const regular = rows.find((r) => r.textContent?.includes('Regular')) as HTMLElement;
      const shot = rows.find((r) => r.textContent?.includes('Extra shot')) as HTMLElement;
      expect(regular.textContent).toContain('+');
      expect(regular.textContent).toContain('0.00');
      expect(regular.textContent).not.toContain('Free');
      expect(shot.textContent).toContain('40.00');
      expect(shot.textContent).not.toContain('Free');
      expect(shot.textContent).toContain('+');
    });

    it('does not open the editor when a quantity button is pressed', () => {
      setup();
      addCroissant();
      c.openCart();
      fixture.detectChanges();
      (el().querySelector('[aria-label="Increase quantity"]') as HTMLButtonElement).click();
      expect(c.cart()[0].quantity).toBe(2);
      expect(c.pickerProduct()).toBeNull();
    });

    it('reopens the picker with the current choices when a cart item is tapped, and updates it', () => {
      setup();
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [{ id: 's-r', name: 'Regular', price: 0, quantity: 1 }],
        quantity: 2,
        specialInstructions: 'less ice',
      });
      c.openCart();
      fixture.detectChanges();

      (el().querySelector('[aria-label="Edit Latte"]') as HTMLElement).click();
      fixture.detectChanges();

      expect(c.pickerProduct()?.id).toBe('latte');
      expect(c.pickerInitial()).toMatchObject({ quantity: 2, specialInstructions: 'less ice' });
      expect(text()).toContain('Update Item');

      c.onPicked({
        addOns: [{ id: 's-l', name: 'Large', price: 30, quantity: 1 }],
        quantity: 3,
        specialInstructions: null,
      });

      expect(c.editingKey()).toBeNull();
      expect(c.cart().length).toBe(1);
      expect(c.cart()[0]).toMatchObject({ quantity: 3 });
      expect(c.cart()[0].addOns[0].id).toBe('s-l');
    });

    it('cancelling an edit leaves the item as it was', () => {
      setup();
      addCroissant();
      c.editLine(c.cart()[0]);
      c.closePicker();
      expect(c.editingKey()).toBeNull();
      expect(c.cart().length).toBe(1);
    });

    it('merges an edited item into another line with the same choices', () => {
      setup();
      addCroissant();
      c.openProduct(c.products()[1]);
      c.onPicked({ addOns: [], quantity: 1, specialInstructions: 'warm' });
      expect(c.cart().length).toBe(2);

      c.editLine(c.cart()[1]);
      c.onPicked({ addOns: [], quantity: 2, specialInstructions: null });

      expect(c.cart().length).toBe(1);
      expect(c.cart()[0].quantity).toBe(3);
    });

    it('drops an item from the cart when editing it and it is no longer on the menu', () => {
      setup();
      addCroissant();
      const line = c.cart()[0];
      service.getLink.mockReturnValue(of(link({ products: [product('latte', 'Latte', 150, 1)] })));
      c.loadMenu(true);
      c.cart.set([line]);

      c.editLine(line);

      expect(c.cart().length).toBe(0);
      expect(alerts.warning).toHaveBeenCalledWith(expect.stringContaining('no longer available'));
    });

    it('caps a line at 99', () => {
      setup();
      addCroissant();
      c.changeQuantity(c.cart()[0].key, 500);
      expect(c.cart()[0].quantity).toBe(99);
    });

    it('removes a line when its quantity reaches zero, and on Remove and Clear', () => {
      setup();
      addCroissant();
      c.changeQuantity(c.cart()[0].key, -1);
      expect(c.cart().length).toBe(0);

      addCroissant();
      c.removeLine(c.cart()[0].key);
      expect(c.cart().length).toBe(0);

      addCroissant();
      c.openCart();
      c.clearCart();
      expect(c.cart().length).toBe(0);
      expect(c.cartOpen()).toBe(false);
    });

    it('shows the same green floating View Order button as the shop screen once something is in the cart', () => {
      setup();
      expect(text()).not.toContain('View Order');
      addCroissant();
      addCroissant();
      fixture.detectChanges();

      const button = [...el().querySelectorAll('button')].find((b) =>
        b.textContent?.includes('View Order'),
      ) as HTMLButtonElement;
      expect(button).toBeDefined();
      expect(button.className).toContain('bg-[#047857]');
      expect(button.className).toContain('absolute');
      expect(button.className).toContain('rounded-2xl');
      expect(button.className).toContain('xl:hidden');
      expect(button.textContent).toContain('2');
      expect(button.textContent).toContain('240.00');

      button.click();
      expect(c.cartOpen()).toBe(true);
    });

    it('never saves the menu on the device, only the cart choices for this tab', () => {
      setup();
      addCroissant();
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [{ id: 's-l', name: 'Large', price: 30, quantity: 1 }],
        quantity: 1,
        specialInstructions: null,
      });
      fixture.detectChanges();
      const keys = (Storage.prototype.setItem as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0],
      );
      expect(keys.every((key: string) => key.startsWith('wtf.public-cart.'))).toBe(true);
      expect(localStorage.length).toBe(0);
      expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('catalog');
    });
  });

  describe('checkout', () => {
    const form = (over: Record<string, unknown> = {}) => ({
      fulfillment: 0,
      deliveryAddress: null,
      contactNumber: '0917 123 4567',
      paymentMethod: 1,
      amountReceived: 500,
      specialInstructions: null,
      ...over,
    });
    const placed = (over: Record<string, unknown> = {}) => ({
      id: 'o1',
      orderNumber: 1042,
      statusKind: 'waiting',
      ...over,
    });
    const checkout = () => el().querySelector('app-public-checkout') as HTMLElement | null;
    const checkoutButton = () =>
      [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Checkout') as
        | HTMLButtonElement
        | undefined;

    function fillCart() {
      addCroissant();
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [{ id: 's-l', name: 'Large', price: 30, quantity: 1 }],
        quantity: 2,
        specialInstructions: 'less ice',
      });
    }

    it('has a Checkout button in the cart that is off while the cart is empty', () => {
      setup();
      c.openCart();
      fixture.detectChanges();
      expect(checkoutButton()).toBeDefined();
      expect(checkoutButton()!.disabled).toBe(true);
      expect(checkoutButton()!.className).toContain('app-btn-primary');

      addCroissant();
      fixture.detectChanges();
      expect(checkoutButton()!.disabled).toBe(false);
    });

    it('no longer says that placing orders is coming soon', () => {
      setup();
      c.openCart();
      fixture.detectChanges();
      expect(text()).not.toContain('coming soon');
    });

    it('opens the checkout with the cart total and keeps the cart sheet open behind it', () => {
      setup();
      fillCart();
      c.openCart();
      fixture.detectChanges();

      checkoutButton()!.click();
      fixture.detectChanges();

      expect(c.checkoutOpen()).toBe(true);
      expect(c.cartOpen()).toBe(true);
      expect(checkout()).not.toBeNull();
      expect(checkout()!.textContent).toContain('Checkout');
      expect(checkout()!.textContent).toContain(String((120 + (150 + 30) * 2).toFixed(2)));
    });

    it('offers the address on file for a delivery', () => {
      setup();
      addCroissant();
      c.openCheckout();
      fixture.detectChanges();

      const buttons = [...checkout()!.querySelectorAll('button')];
      (buttons.find((b) => b.textContent?.trim() === 'Delivery') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect((checkout()!.querySelector('#checkout-address') as HTMLTextAreaElement).value).toBe(
        '12 Main St',
      );
    });

    it('does not open with an empty cart', () => {
      setup();
      c.openCheckout();
      expect(c.checkoutOpen()).toBe(false);
    });

    it('goes back to the cart from the checkout', () => {
      setup();
      addCroissant();
      c.openCheckout();
      c.closeCheckout();
      expect(c.checkoutOpen()).toBe(false);
      expect(c.cart().length).toBe(1);
    });

    it('leaves the cart sheet open behind the checkout instead of sliding it away', () => {
      setup();
      addCroissant();
      c.openCart();

      c.openCheckout();

      expect(c.checkoutOpen()).toBe(true);
      expect(c.cartOpen()).toBe(true);

      c.closeCheckout();

      expect(c.cartOpen()).toBe(true);
    });

    describe('the order request', () => {
      it('sends the tip with the order', () => {
        setup();
        addCroissant();

        expect(c.buildOrderRequest(form({ tips: 20 })).tips).toBe(20);
        expect(c.buildOrderRequest(form({ tips: null })).tips).toBeNull();
      });

      it('lists the items with add-on quantities and instructions, and no prices', () => {
        setup();
        fillCart();

        const request = c.buildOrderRequest(
          form({ fulfillment: 1, deliveryAddress: '5 Side St', specialInstructions: 'Ring' }),
        );

        expect(request).toEqual({
          items: [
            { productId: 'croissant', quantity: 1, addOns: [], specialInstructions: null },
            {
              productId: 'latte',
              quantity: 2,
              addOns: [{ productId: 's-l', quantity: 1 }],
              specialInstructions: 'less ice',
            },
          ],
          fulfillment: 1,
          deliveryAddress: '5 Side St',
          contactNumber: '0917 123 4567',
          paymentMethod: 1,
          amountReceived: 500,
          specialInstructions: 'Ring',
        });
        expect(JSON.stringify(request)).not.toMatch(/price|total/i);
      });
    });

    describe('placing the order', () => {
      it('sends it to the link in the address and shows it waiting on My orders', () => {
        setup();
        fillCart();
        c.openCheckout();
        service.createOrder.mockReturnValue(of(placed()));
        service.getOrders.mockReturnValue(
          of({
            items: [
              placed({
                statusLabel: 'Waiting for confirmation',
                items: [],
                total: 480,
                createdAt: '2026-10-11T09:00:00',
              }),
            ],
            page: 1,
            pageSize: 50,
            totalCount: 1,
          }),
        );

        c.placeOrder(form());
        fixture.detectChanges();

        expect(service.createOrder).toHaveBeenCalledWith(
          'tok-1',
          expect.objectContaining({ contactNumber: '0917 123 4567' }),
        );
        expect(c.checkoutOpen()).toBe(false);
        expect(c.cart()).toEqual([]);
        expect(c.cartOpen()).toBe(false);
        expect(c.tab()).toBe('orders');
        expect(service.getOrders).toHaveBeenCalled();
        expect(alerts.success).toHaveBeenCalledWith(
          'Your order #1042 was sent. The shop will confirm it shortly.',
        );
        expect(text()).toContain('#1042');
      });

      it('locks the checkout while it is being sent and ignores repeats', () => {
        setup();
        addCroissant();
        c.openCheckout();
        service.createOrder.mockReturnValue(new Subject());

        c.placeOrder(form());
        c.placeOrder(form());
        c.closeCheckout();

        expect(service.createOrder).toHaveBeenCalledTimes(1);
        expect(c.isPlacingOrder()).toBe(true);
        expect(c.checkoutOpen()).toBe(true);
      });

      it('sends nothing for an empty cart', () => {
        setup();
        c.placeOrder(form());
        expect(service.createOrder).not.toHaveBeenCalled();
      });

      it('keeps the cart and the checkout open and shows the reason when the shop refuses it', () => {
        setup();
        addCroissant();
        c.openCheckout();
        service.createOrder.mockReturnValue(
          throwError(
            () => new Error('The cash amount must be at least the order total of PHP 120.00.'),
          ),
        );

        c.placeOrder(form({ amountReceived: 50 }));
        fixture.detectChanges();

        expect(c.checkoutOpen()).toBe(true);
        expect(c.cart().length).toBe(1);
        expect(c.isPlacingOrder()).toBe(false);
        expect(c.checkoutError()).toContain('at least the order total');
        expect(checkout()!.textContent).toContain('at least the order total');
        expect(service.getLink).toHaveBeenCalledTimes(1);
      });

      it('refreshes the menu underneath when an item is no longer sold', () => {
        setup();
        addCroissant();
        c.openCheckout();
        service.createOrder.mockReturnValue(
          throwError(
            () =>
              new Error(
                'Some items are no longer available. Please refresh the menu and try again.',
              ),
          ),
        );
        service.getLink.mockReturnValue(
          of(link({ products: [product('latte', 'Latte', 150, 1)] })),
        );

        c.placeOrder(form());

        expect(service.getLink).toHaveBeenCalledTimes(2);
        expect(c.cart()).toEqual([]);
        expect(c.checkoutOpen()).toBe(true);
        expect(c.checkoutError()).toContain('no longer available');
      });

      it('clears the error when the checkout is closed and opened again', () => {
        setup();
        addCroissant();
        c.openCheckout();
        service.createOrder.mockReturnValue(throwError(() => new Error('nope')));
        c.placeOrder(form());
        expect(c.checkoutError()).toBe('nope');

        c.closeCheckout();
        c.openCheckout();
        expect(c.checkoutError()).toBeNull();
      });

      it('switches to the invalid link page and keeps nothing when the link stopped working', () => {
        setup();
        fillCart();
        c.openCheckout();
        service.createOrder.mockReturnValue(throwError(() => new PublicLinkInvalidError()));

        c.placeOrder(form());
        fixture.detectChanges();

        expect(c.state()).toBe('invalid');
        expect(c.checkoutOpen()).toBe(false);
        expect(c.cart()).toEqual([]);
        expect(c.isPlacingOrder()).toBe(false);
        expect(text()).toContain('This link is no longer valid');
        expect(checkout()).toBeNull();
      });
    });
  });

  describe('keeping the cart in line with the current menu', () => {
    function fill() {
      addCroissant();
      c.openProduct(c.products()[0]);
      c.onPicked({
        addOns: [{ id: 's-l', name: 'Large', price: 30, quantity: 1 }],
        quantity: 1,
        specialInstructions: null,
      });
    }

    it('removes items that are no longer sold and says so', () => {
      setup();
      fill();
      service.getLink.mockReturnValue(of(link({ products: [product('latte', 'Latte', 150, 1)] })));
      c.loadMenu(true);
      expect(c.cart().map((l: { productId: string }) => l.productId)).toEqual(['latte']);
      expect(alerts.warning).toHaveBeenCalledWith(expect.stringContaining('no longer available'));
    });

    it('removes a line whose add-on was withdrawn', () => {
      setup();
      fill();
      service.getLink.mockReturnValue(
        of(link({ addOnsByProductId: { latte: [{ ...SIZE, options: [SIZE.options[1]] }] } })),
      );
      c.loadMenu(true);
      expect(c.cart().map((l: { productId: string }) => l.productId)).toEqual(['croissant']);
    });

    it('updates changed prices and says so', () => {
      setup();
      fill();
      service.getLink.mockReturnValue(
        of(
          link({
            products: [
              product('latte', 'Latte', 175, 1),
              product('croissant', 'Croissant', 120, 2),
            ],
            addOnsByProductId: {
              latte: [{ ...SIZE, options: [product('s-l', 'Large', 40), SIZE.options[1]] }],
            },
          }),
        ),
      );
      c.loadMenu(true);
      const latte = c.cart().find((l: { productId: string }) => l.productId === 'latte');
      expect(latte.price).toBe(175);
      expect(latte.addOns[0].price).toBe(40);
      expect(c.cartTotal()).toBe(175 + 40 + 120);
      expect(alerts.warning).toHaveBeenCalledWith(expect.stringContaining('prices have changed'));
    });

    it('stays quiet when nothing changed', () => {
      setup();
      fill();
      c.loadMenu(true);
      expect(c.cart().length).toBe(2);
      expect(alerts.warning).not.toHaveBeenCalled();
    });
  });

  describe('my orders', () => {
    const PAGE = {
      items: [
        order('o2', '2026-10-11T09:00:00', {
          orderNumber: 1002,
          statusLabel: 'Accepted',
          statusKind: 'accepted',
        }),
        order('o1', '2026-10-10T09:00:00', {
          statusLabel: 'Rejected',
          statusKind: 'rejected',
          rejectionReason: 'Closed today',
        }),
      ],
      page: 1,
      pageSize: 50,
      totalCount: 2,
    };

    it('loads the orders when the tab opens and groups them by day', () => {
      setup({ orders: of(PAGE) });
      c.selectTab('orders');
      fixture.detectChanges();
      expect(service.getOrders).toHaveBeenCalledWith('tok-1', 1, 50);
      expect(el().querySelectorAll('[data-order-row]').length).toBe(2);
      expect(text()).toContain('#1002');
      expect(text()).toContain('Accepted');
      expect(text()).toContain('Rejected');
      expect(text()).not.toContain('Closed today');
    });

    it('keeps My orders lit in the side bar and dock while an order is open', () => {
      setup({ orders: of(PAGE) });
      c.selectTab('orders');
      c.openOrder('o2');
      fixture.detectChanges();

      expect(el().querySelector('[data-order-details]')).not.toBeNull();
      const current = [...el().querySelectorAll('[aria-current="page"]')].map((n) =>
        n.textContent!.replace(/s+/g, ' ').trim(),
      );
      expect(current.length).toBeGreaterThan(0);
      expect(current.every((label) => label.includes('My order'))).toBe(true);
    });

    it('shows the menu again from the New Order button on My orders', () => {
      setup({ orders: of(PAGE) });
      c.selectTab('orders');
      fixture.detectChanges();

      (el().querySelector('[data-new-order]') as HTMLElement).click();
      fixture.detectChanges();

      expect(c.tab()).toBe('menu');
      expect(el().querySelector('[data-new-order]')).toBeNull();
    });

    it('says so when there are no orders yet', () => {
      setup();
      c.selectTab('orders');
      fixture.detectChanges();
      expect(text()).toContain('You have not placed any orders yet.');
    });

    it('opens an order on its own page with items, add-ons and details, and goes back to the list', () => {
      setup({ orders: of(PAGE) });
      c.selectTab('orders');
      fixture.detectChanges();
      expect(el().querySelector('[data-order-details]')).toBeNull();

      (el().querySelectorAll('[data-order-row]')[1] as HTMLElement).click();
      fixture.detectChanges();
      expect(el().querySelector('[data-order-details]')).not.toBeNull();
      expect(text()).toContain('2× Latte');
      expect(text()).toContain('+ Large');
      expect(text()).toContain('less ice');
      expect(text()).toContain('360.00');
      expect(text()).toContain('Delivery');
      expect(text()).toContain('5 Side St');
      expect(text()).toContain('Cash');
      (el().querySelector('[aria-label="Back to my orders"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(el().querySelector('[data-order-details]')).toBeNull();
      expect(text()).not.toContain('5 Side St');
      expect(text()).toContain('#1002');
    });

    it('explains where the order stands in a plain sentence', () => {
      setup({
        orders: of({
          items: [
            order('w', '2026-10-11T10:00:00', { statusKind: 'waiting', statusLabel: 'Waiting for confirmation' }),
            order('r', '2026-10-11T09:00:00', {
              statusKind: 'rejected',
              statusLabel: 'Rejected',
              rejectionReason: 'Closed today',
            }),
          ],
          page: 1,
          pageSize: 50,
          totalCount: 2,
        }),
      });
      c.selectTab('orders');

      c.openOrder('w');
      fixture.detectChanges();
      expect(el().querySelector('[data-status-note]')!.textContent).toContain('Waiting for the shop');

      c.openOrder('r');
      fixture.detectChanges();
      expect(el().querySelector('[data-status-note]')!.textContent).toContain(
        'could not take this order. Reason: Closed today',
      );
    });

    it('shows the new status on an open order when the list refreshes', () => {
      setup({ orders: of(PAGE) });
      c.selectTab('orders');
      c.openOrder('o1');
      const items = PAGE.items.map((o: { id: string }) =>
        o.id === 'o1' ? { ...o, statusKind: 'completed', statusLabel: 'Completed', rejectionReason: null } : o,
      );
      service.getOrders.mockReturnValue(of({ ...PAGE, items }));
      c.loadOrders(true);
      fixture.detectChanges();

      expect(el().querySelector('[data-status-note]')!.textContent).toContain('complete');
    });

    it('goes back to the list when the open order is no longer there, or the tab is left', () => {
      setup({ orders: of(PAGE) });
      c.selectTab('orders');
      c.openOrder('missing');
      expect(c.selectedOrder()).toBeNull();

      c.openOrder('o1');
      c.selectTab('menu');
      c.selectTab('orders');
      expect(c.selectedOrderId()).toBeNull();
    });

    it('shows an error when the orders cannot be loaded', () => {
      setup({ orders: throwError(() => new Error('Failed to load your orders.')) });
      c.selectTab('orders');
      fixture.detectChanges();
      expect(c.ordersState()).toBe('error');
      expect(text()).toContain('Failed to load your orders.');
    });

    it('keeps the list when only a background refresh fails', () => {
      setup({ orders: of(PAGE) });
      c.selectTab('orders');
      service.getOrders.mockReturnValue(throwError(() => new Error('offline')));
      c.loadOrders(true);
      expect(c.ordersState()).toBe('ready');
      expect(c.orders().length).toBe(2);
    });

    it('turns into the invalid page if the link is revoked while viewing orders', () => {
      setup();
      c.selectTab('orders');
      service.getOrders.mockReturnValue(throwError(() => new PublicLinkInvalidError()));
      c.loadOrders(true);
      expect(c.state()).toBe('invalid');
    });
  });

  describe('staying fresh', () => {
    function setHidden(hidden: boolean) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }

    afterEach(() => setHidden(false));

    it('reloads a stale menu when the page comes back into view', () => {
      vi.useFakeTimers();
      setup();
      vi.advanceTimersByTime(MENU_STALE_AFTER_MS + 1);
      setHidden(false);
      expect(service.getLink).toHaveBeenCalledTimes(2);
    });

    it('leaves a recently loaded menu alone', () => {
      vi.useFakeTimers();
      setup();
      vi.advanceTimersByTime(MENU_STALE_AFTER_MS - 5_000);
      setHidden(false);
      expect(service.getLink).toHaveBeenCalledTimes(1);
    });

    it('does nothing while the page is hidden', () => {
      vi.useFakeTimers();
      setup();
      vi.advanceTimersByTime(MENU_STALE_AFTER_MS + 1);
      setHidden(true);
      expect(service.getLink).toHaveBeenCalledTimes(1);
    });

    it('refreshes my orders when the page comes back into view on that tab', () => {
      setup();
      c.selectTab('orders');
      expect(service.getOrders).toHaveBeenCalledTimes(1);
      setHidden(false);
      expect(service.getOrders).toHaveBeenCalledTimes(2);
    });

    it('polls my orders every 30 seconds while that tab is open and visible', () => {
      vi.useFakeTimers();
      setup();
      vi.advanceTimersByTime(ORDERS_POLL_MS);
      expect(service.getOrders).not.toHaveBeenCalled();

      c.selectTab('orders');
      expect(service.getOrders).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(ORDERS_POLL_MS);
      expect(service.getOrders).toHaveBeenCalledTimes(2);

      setHidden(true);
      vi.advanceTimersByTime(ORDERS_POLL_MS);
      expect(service.getOrders).toHaveBeenCalledTimes(2);
    });

    it('stops listening and polling when the page is destroyed', () => {
      vi.useFakeTimers();
      setup();
      c.selectTab('orders');
      fixture.destroy();
      vi.advanceTimersByTime(ORDERS_POLL_MS * 3);
      expect(service.getOrders).toHaveBeenCalledTimes(1);
      setHidden(false);
      expect(service.getLink).toHaveBeenCalledTimes(1);
    });
  });
});
