import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { AlertService } from '@core/services/alert.service';
import { ConnectivityService } from '@core/services/connectivity.service';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { PublicLinkInvalidError, PublicOrderService } from '@core/services/public-order.service';
import { EnvelopeComponent } from '@shared/components/envelope/envelope';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { CartDrawerComponent } from '@shared/components/cart-drawer/cart-drawer';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { LineBreakdownComponent } from '@shared/components/line-breakdown/line-breakdown';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { ThemeSwitcherComponent } from '@shared/components/theme-switcher/theme-switcher';
import { PublicChatComponent } from './public-chat/public-chat';
import { PublicOfflineNoticeComponent } from './public-offline-notice/public-offline-notice';
import { PublicOrderDetailsComponent } from './public-order-details/public-order-details';
import { PublicOrdersComponent } from './public-orders/public-orders';
import {
  ConversationListDto,
  ConversationSummaryDto,
  ProductCategoryEnum,
  PublicAddOnGroupDto,
  PublicCartAddOn,
  PublicCartLine,
  PublicOrderDto,
  PublicOrderLinkDto,
  PublicProductDto,
  SubmitPublicOrderRequest,
} from '@shared/models';
import { LinkInvalidComponent } from './link-invalid/link-invalid';
import { PublicCheckoutComponent, PublicCheckoutForm } from './public-checkout/public-checkout';
import {
  MAX_ITEM_QUANTITY,
  PublicAddonPickerComponent,
  PublicAddonPickerResult,
} from './public-addon-picker/public-addon-picker';
import {
  addOnsTotal,
  buildDeals,
  buildLineBreakdown,
  LineBreakdown,
  Deal,
  DiscountAllowance,
  DiscountMatch,
  DiscountRule,
  extendedPrice,
  findBestDiscount,
  formatPromoLabel,
  fromCents,
  priceWithAddOns,
  promoDiscount,
  sumAmounts,
  toCents,
} from '@shared/calculations';

type LoadState = 'loading' | 'ready' | 'invalid' | 'error';
type Tab = 'menu' | 'orders';

interface PublicLineDiscount {
  price: number;
  quantity: number;
  label: string | null;
  limited: boolean;
  note: string | null;
}

/** The Promos section sits before the categories and uses this id in the tab strip and the section anchors. */
export const PROMO_SECTION_ID = -1;

interface MenuSection {
  id: number;
  label: string;
  products: PublicProductDto[];
  deals: Deal[];
}

/** Re-load the menu when the page comes back into view after this long. */
export const MENU_STALE_AFTER_MS = 60_000;
/** How often My orders refreshes itself while it is open and visible. */
export const ORDERS_POLL_MS = 30_000;
const ORDERS_PAGE_SIZE = 50;
/** A saved cart older than this is thrown away. */
const CART_KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_CART_LINES = 30;
const CART_STORAGE_PREFIX = 'wtf.public-cart.';
/** How long a tab-click scroll is allowed to glide before scroll events move the highlight again. */
export const PROGRAMMATIC_SCROLL_MS = 700;

const CATEGORY_LABELS: Record<number, string> = {
  [ProductCategoryEnum.Drink]: 'Drinks',
  [ProductCategoryEnum.Food]: 'Food',
  [ProductCategoryEnum.Dessert]: 'Desserts',
  [ProductCategoryEnum.Other]: 'Other',
};

/**
 * The page a customer opens from their personal ordering link. They are not signed in.
 *
 * The catalog is never saved on the device: it is fetched fresh every time the page loads and every time the customer
 * returns to the Menu tab, so a customer can never order from an obsolete list. Do not add the catalog cache, the image
 * cache or the offline queue to this page.
 *
 * Only the customer's choices (which products, how many, which add-ons) are kept for this tab, so a reload does not
 * lose the order. They are checked against the fresh menu before they are shown, like any other cart.
 */
@Component({
  selector: 'app-public-order',
  imports: [
    DecimalPipe,
    AvatarComponent,
    CartDrawerComponent,
    EnvelopeComponent,
    IconComponent,
    LineBreakdownComponent,
    LinkInvalidComponent,
    NgTemplateOutlet,
    PublicAddonPickerComponent,
    PublicCheckoutComponent,
    PublicChatComponent,
    PublicOfflineNoticeComponent,
    PublicOrderDetailsComponent,
    PublicOrdersComponent,
    SearchInputComponent,
    ThemeSwitcherComponent,
  ],
  templateUrl: './public-order.html',
  host: { class: 'block h-full' },
})
export class PublicOrderComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(PublicOrderService);
  private readonly hub = inject(PublicOrderHubService);
  private readonly alerts = inject(AlertService);
  protected readonly connectivity = inject(ConnectivityService);

  private readonly sidebarHost = viewChild<ElementRef<HTMLElement>>('sidebarHost');
  private resizeObserver: ResizeObserver | null = null;

  protected token = '';
  private loadedAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisibility = () => this.handleVisibility();

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly link = signal<PublicOrderLinkDto | null>(null);
  protected readonly tab = signal<Tab>('menu');
  protected readonly isRefreshingMenu = signal(false);
  protected readonly isSidebarCollapsed = signal(false);
  protected readonly isCartCollapsed = signal(false);
  /** Set when the profile picture cannot be loaded, so the initials show instead. */
  protected readonly imageFailed = signal(false);

  protected readonly search = signal('');
  /** The category tab that is highlighted. It follows the scroll position and moves it when clicked. */
  protected readonly activeCategory = signal<number | null>(null);
  private isProgrammaticScroll = false;
  private programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly cart = signal<PublicCartLine[]>([]);
  /** Saving the cart waits until the saved one has been read back, or it would be erased first. */
  private cartRestored = false;
  protected readonly cartOpen = signal(false);
  protected readonly pickerProduct = signal<PublicProductDto | null>(null);
  /** The cart line being edited in the picker, or null when adding a new item. */
  protected readonly editingKey = signal<string | null>(null);
  /** Add-ons a deal card starts the picker with (a new item, not an edit). */
  protected readonly pickerStart = signal<PublicCartAddOn[] | null>(null);
  protected readonly checkoutOpen = signal(false);
  protected readonly isPlacingOrder = signal(false);
  /** What the server said about the last attempt to place the order, shown in the checkout. */
  protected readonly checkoutError = signal<string | null>(null);

  protected readonly orders = signal<PublicOrderDto[]>([]);
  protected readonly ordersState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly ordersError = signal('');
  /** The order whose details are open on My orders, or null for the list. */
  protected readonly selectedOrderId = signal<string | null>(null);

  // --- chat with the shop ---
  /** My order chats for the envelope. Loaded fresh from the shop; nothing is kept on the device. */
  protected readonly conversations = signal<ConversationListDto | null>(null);
  protected readonly isLoadingConversations = signal(false);
  /** The order whose chat is open. */
  protected readonly chatOrderId = signal<string | null>(null);
  protected readonly chatOrderNumber = signal<number | null>(null);
  /** The chat was opened from the envelope, away from its order, so it offers a way to the order. */
  protected readonly chatFromEnvelope = signal(false);
  protected readonly unreadConversations = computed(
    () => this.conversations()?.unreadConversations ?? 0,
  );
  protected readonly unreadByOrder = computed(() => {
    const unread: Record<string, number> = {};
    for (const item of this.conversations()?.items ?? []) {
      if (item.orderId && item.unreadCount > 0) {
        unread[item.orderId] = item.unreadCount;
      }
    }
    return unread;
  });
  private liveSubscriptions: Subscription[] = [];
  private locationSubscription: Subscription | null = null;
  private liveStarted = false;
  protected readonly selectedOrder = computed(
    () => this.orders().find((order) => order.id === this.selectedOrderId()) ?? null,
  );

  /** The customer's picture, unless there is none or it failed to load. */
  protected readonly profileImage = computed(() =>
    this.imageFailed() ? null : (this.link()?.imageUrl ?? null),
  );

  protected readonly products = computed(() => this.link()?.catalog.products ?? []);

  /** The discount rules that are on, by product, in the shape the shared price calculator reads. */
  private readonly dealRulesByProduct = computed(() => {
    const rules = new Map<string, DiscountRule[]>();
    for (const deal of this.link()?.catalog.deals ?? []) {
      rules.set(deal.productId, [
        ...(rules.get(deal.productId) ?? []),
        {
          fixedPrice: deal.amountOff ?? null,
          percentOff: deal.percentOff ?? null,
          addOns: deal.addOns,
          remaining: deal.remaining ?? null,
          maxPerOrder: deal.maxPerOrder ?? null,
          promotionKey: deal.groupKey ?? null,
        },
      ]);
    }
    return rules;
  });

  /** Discounts shown as cards: the product with the add-ons the discount needs, priced as the shop will charge it. */
  protected readonly deals = computed<Deal[]>(() => {
    const catalog = this.link()?.catalog;
    if (!catalog) {
      return [];
    }

    return buildDeals(
      (catalog.deals ?? []).map((deal) => ({
        productId: deal.productId,
        fixedPrice: deal.amountOff,
        percentOff: deal.percentOff,
        addOns: deal.addOns,
        remaining: deal.remaining,
      })),
      (productId) => catalog.products.find((p) => p.id === productId),
      (productId, addOnId) =>
        (catalog.addOnsByProductId[productId] ?? [])
          .flatMap((group) => group.options)
          .find((option) => option.id === addOnId),
    );
  });

  protected readonly filteredProducts = computed(() => {
    const term = this.search().trim().toLowerCase();

    return this.products().filter(
      (p) =>
        !term ||
        p.name.toLowerCase().includes(term) ||
        (p.description ?? '').toLowerCase().includes(term),
    );
  });

  protected readonly filteredDeals = computed(() => {
    const term = this.search().trim().toLowerCase();
    const deals = this.deals();
    return term ? deals.filter((deal) => deal.title.toLowerCase().includes(term)) : deals;
  });

  /** Promos first (when there are any), then one section per category that still has a matching product. */
  protected readonly sections = computed<MenuSection[]>(() => {
    const products = this.filteredProducts();
    const deals = this.filteredDeals();
    const categories = Object.keys(CATEGORY_LABELS)
      .map(Number)
      .map((id) => ({
        id,
        label: CATEGORY_LABELS[id],
        products: products.filter((p) => p.category === id),
        deals: [] as Deal[],
      }))
      .filter((section) => section.products.length > 0);

    return deals.length > 0
      ? [{ id: PROMO_SECTION_ID, label: 'Promos', products: [], deals }, ...categories]
      : categories;
  });

  /** The highlighted tab, falling back to the first section when the chosen one is not shown. */
  protected readonly highlightedCategory = computed(() => {
    const sections = this.sections();
    const active = this.activeCategory();

    return sections.some((s) => s.id === active) ? active : (sections[0]?.id ?? null);
  });

  protected readonly pickerInitial = computed<PublicAddonPickerResult | null>(() => {
    const key = this.editingKey();
    const line = key ? this.cart().find((l) => l.key === key) : null;

    return line
      ? {
          addOns: line.addOns,
          quantity: line.quantity,
          specialInstructions: line.specialInstructions ?? null,
        }
      : null;
  });

  protected readonly pickerGroups = computed<PublicAddOnGroupDto[]>(() => {
    const product = this.pickerProduct();
    return product ? this.groupsFor(product.id) : [];
  });

  protected readonly cartCount = computed(() =>
    this.cart().reduce((sum, line) => sum + line.quantity, 0),
  );
  protected readonly cartTotal = computed(() =>
    sumAmounts(this.cart().map((line) => this.lineTotal(line))),
  );

  public constructor() {
    // Coming back online: the menu on screen may be old, so load it again without asking the customer.
    let wasOnline = this.connectivity.isOnline();
    effect(() => {
      const online = this.connectivity.isOnline();
      if (online && !wasOnline && untracked(() => this.state() === 'ready')) {
        untracked(() => this.loadMenu(true));
      }
      wasOnline = online;
    });

    effect(() => {
      const lines = this.cart();
      if (this.cartRestored) {
        this.saveCart(lines);
      }
    });

    // Like the signed-in layout: publish the sidebar width so the cart sheet opens beside it, not over it.
    effect(() => {
      const host = this.sidebarHost()?.nativeElement ?? null;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;

      if (!host) {
        this.setSidebarWidth(0);
        return;
      }

      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.publishSidebarWidth(host));
        this.resizeObserver.observe(host);
      }

      this.publishSidebarWidth(host);
    });
  }

  public ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    // The address says where the customer is (menu, order list, one order), so Back, Refresh and shared links work.
    this.syncFromUrl();
    this.locationSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.syncFromUrl());
    this.loadMenu();
    this.startLive();

    document.addEventListener('visibilitychange', this.onVisibility);
    this.pollTimer = setInterval(() => {
      if (this.tab() === 'orders' && !document.hidden && this.state() === 'ready') {
        this.loadOrders(true);
      }
    }, ORDERS_POLL_MS);
  }

  public ngOnDestroy(): void {
    this.liveSubscriptions.forEach((subscription) => subscription.unsubscribe());
    this.liveSubscriptions = [];
    this.locationSubscription?.unsubscribe();
    this.hub.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.setSidebarWidth(0);
    if (this.programmaticScrollTimer !== null) {
      clearTimeout(this.programmaticScrollTimer);
      this.programmaticScrollTimer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // --- layout ---

  protected toggleSidebar(): void {
    this.isSidebarCollapsed.update((collapsed) => !collapsed);
  }

  protected toggleCartCollapse(): void {
    this.isCartCollapsed.update((collapsed) => !collapsed);
  }

  private publishSidebarWidth(host: HTMLElement): void {
    const wide = window.matchMedia?.('(min-width: 599px)').matches ?? true;
    this.setSidebarWidth(wide ? Math.round(host.getBoundingClientRect().width) : 0);
  }

  private setSidebarWidth(width: number): void {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }

  // --- real time and chat ---

  /**
   * Listens for the shop's news: a message, an order that changed, or a revoked link. The server only says that
   * something happened; the page then asks for the data again, so what is shown always comes from the shop. If the
   * connection never opens, the refreshes the page already does keep everything current.
   */
  private startLive(): void {
    if (this.liveStarted || !this.token) {
      return;
    }

    this.liveStarted = true;
    this.liveSubscriptions = [
      this.hub.orderMessage.subscribe(() => this.loadConversations()),
      this.hub.conversationRead.subscribe(() => this.loadConversations()),
      this.hub.orderStatusChanged.subscribe(() => {
        this.loadOrders(true);
        this.loadConversations();
      }),
      this.hub.linkRevoked.subscribe(() => this.state.set('invalid')),
    ];
    this.hub.connect(this.token);
  }

  protected loadConversations(): void {
    if (this.state() !== 'ready' && this.state() !== 'loading') {
      return;
    }

    this.isLoadingConversations.set(true);
    this.service.getConversations(this.token).subscribe({
      next: (list) => {
        this.conversations.set(list);
        this.isLoadingConversations.set(false);
      },
      error: (err: Error) => {
        this.isLoadingConversations.set(false);
        if (err instanceof PublicLinkInvalidError) {
          this.state.set('invalid');
        }
        // Anything else leaves the envelope as it was.
      },
    });
  }

  protected openChat(orderId: string, orderNumber: number | null = null): void {
    this.chatFromEnvelope.set(false);
    this.chatOrderNumber.set(
      orderNumber ?? this.orders().find((o) => o.id === orderId)?.orderNumber ?? null,
    );
    this.chatOrderId.set(orderId);
  }

  protected closeChat(): void {
    this.chatOrderId.set(null);
    this.chatFromEnvelope.set(false);
  }

  protected goToChatOrder(): void {
    const orderId = this.chatOrderId();
    this.closeChat();
    if (orderId) {
      this.openOrder(orderId);
    }
  }

  /** A conversation was pressed in the envelope: open its chat where the customer is. */
  protected openConversation(item: ConversationSummaryDto): void {
    if (!item.orderId) {
      return;
    }

    this.openChat(item.orderId, item.orderNumber ?? null);
    this.chatFromEnvelope.set(true);
  }

  protected onChatLinkInvalid(): void {
    this.chatOrderId.set(null);
    this.state.set('invalid');
  }

  // --- loading ---

  protected loadMenu(silent = false): void {
    if (silent) {
      this.isRefreshingMenu.set(true);
    } else {
      this.state.set('loading');
    }

    this.service.getLink(this.token).subscribe({
      next: (link) => {
        if (link.imageUrl !== this.link()?.imageUrl) {
          this.imageFailed.set(false);
        }
        this.link.set(link);
        this.loadedAt = Date.now();
        this.isRefreshingMenu.set(false);
        this.state.set('ready');
        this.restoreCart();
        this.reconcileCart();
        this.loadConversations();
      },
      error: (err: Error) => {
        this.isRefreshingMenu.set(false);

        if (err instanceof PublicLinkInvalidError) {
          this.state.set('invalid');
        } else if (silent && this.link()) {
          // Keep what is on screen. While the connection is down the offline banner already says it may be out of
          // date, so only another kind of failure needs a message of its own.
          if (this.connectivity.isOnline()) {
            this.alerts.warning(`${err.message} The menu below may be out of date.`);
          }
        } else {
          this.errorMessage.set(err.message);
          this.state.set('error');
        }
      },
    });
  }

  protected loadOrders(silent = false): void {
    if (!silent) {
      this.ordersState.set('loading');
    }

    this.service.getOrders(this.token, 1, ORDERS_PAGE_SIZE).subscribe({
      next: (result) => {
        this.orders.set(result.items);
        this.ordersState.set('ready');
      },
      error: (err: Error) => {
        if (err instanceof PublicLinkInvalidError) {
          this.state.set('invalid');
          return;
        }

        // A failed background refresh keeps the list that is already showing.
        if (!silent || this.ordersState() !== 'ready') {
          this.ordersError.set(err.message);
          this.ordersState.set('error');
        }
      },
    });
  }

  private handleVisibility(): void {
    if (document.hidden || this.state() !== 'ready') {
      return;
    }

    if (this.tab() === 'orders') {
      this.loadOrders(true);
    } else if (Date.now() - this.loadedAt >= MENU_STALE_AFTER_MS) {
      this.loadMenu(true);
    }
  }

  protected selectTab(tab: Tab): void {
    this.goTo(tab === 'orders' ? ['orders'] : []);
    this.applyLocation(tab, null);
  }

  private goTo(parts: string[]): void {
    void this.router.navigate(['/shop', this.token, ...parts]);
  }

  private syncFromUrl(): void {
    const segments = this.router.url.split(/[?#]/)[0].split('/').filter(Boolean);
    if (segments[0] !== 'shop' || segments[1] !== this.token) {
      return;
    }

    if (segments[2] === 'orders') {
      this.applyLocation('orders', segments[3] ? decodeURIComponent(segments[3]) : null);
    } else {
      this.applyLocation('menu', null);
    }
  }

  private applyLocation(tab: Tab, orderId: string | null): void {
    if (this.tab() !== tab) {
      this.tab.set(tab);

      if (tab === 'menu') {
        // Always show a fresh menu when coming back to it.
        this.loadMenu(true);
      } else {
        this.loadOrders();
      }
    }

    this.selectedOrderId.set(orderId);
  }

  // --- menu ---

  /** Clicking a tab scrolls the menu to that category, like the shop's own order screen. */
  protected selectCategoryTab(id: number): void {
    this.activeCategory.set(id);
    this.scrollTabIntoView(id);

    const target = document.getElementById(`category-${id}`);
    if (!target) {
      return;
    }

    // While the page glides to the section, scroll events must not move the highlight along the way.
    this.isProgrammaticScroll = true;
    if (this.programmaticScrollTimer !== null) {
      clearTimeout(this.programmaticScrollTimer);
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.programmaticScrollTimer = setTimeout(() => {
      this.isProgrammaticScroll = false;
      this.programmaticScrollTimer = null;
    }, PROGRAMMATIC_SCROLL_MS);
  }

  /** Keeps the highlighted tab in step with the category the customer is scrolling through. */
  protected onMenuScrolled(event: Event): void {
    if (this.isProgrammaticScroll) {
      return;
    }

    const container = event.currentTarget;
    const sections = this.sections();
    if (!(container instanceof HTMLElement) || sections.length === 0) {
      return;
    }

    const isScrollable = container.scrollHeight > container.clientHeight + 4;
    const isNearBottom =
      isScrollable && container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
    if (isNearBottom) {
      this.setActiveFromScroll(sections[sections.length - 1].id);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const activationLine = containerRect.top + containerRect.height * 0.35;
    let active: number | null = null;

    for (const section of sections) {
      const element = document.getElementById(`category-${section.id}`);
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) {
        continue;
      }

      active ??= section.id;
      if (rect.top <= activationLine) {
        active = section.id;
      }
    }

    if (active !== null) {
      this.setActiveFromScroll(active);
    }
  }

  private setActiveFromScroll(id: number): void {
    if (this.highlightedCategory() === id) {
      return;
    }

    this.activeCategory.set(id);
    this.scrollTabIntoView(id);
  }

  private scrollTabIntoView(id: number): void {
    const tab = document.querySelector(`[data-menu-tab="${id}"]`);
    if (tab instanceof HTMLElement) {
      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  protected onSearch(value: string): void {
    this.search.set(value);
  }

  private groupsFor(productId: string): PublicAddOnGroupDto[] {
    return (this.link()?.catalog.addOnsByProductId[productId] ?? []).filter(
      (group) => group.options.length > 0,
    );
  }

  /** Always opens the picker, even with no add-ons, so the customer can set a quantity and instructions. */
  protected openProduct(product: PublicProductDto): void {
    this.pickerProduct.set(product);
  }

  /** A deal card opens the picker with the add-ons its discount needs already chosen. */
  protected openDeal(deal: Deal): void {
    const product = this.products().find((p) => p.id === deal.productId);
    if (!product) {
      return;
    }

    this.pickerStart.set(deal.addOns.map((a) => ({ id: a.id, name: a.name, price: a.price, quantity: a.quantity })));
    this.pickerProduct.set(product);
  }

  protected closePicker(): void {
    this.pickerProduct.set(null);
    this.pickerStart.set(null);
    this.editingKey.set(null);
  }

  /** Reopens the picker for a line already in the cart. */
  protected editLine(line: PublicCartLine): void {
    const product = this.products().find((p) => p.id === line.productId);

    if (!product) {
      this.alerts.warning('That item is no longer available.');
      this.removeLine(line.key);
      return;
    }

    this.editingKey.set(line.key);
    this.pickerProduct.set(product);
  }

  protected onPicked(result: PublicAddonPickerResult): void {
    const product = this.pickerProduct();
    const editing = this.editingKey();
    this.pickerProduct.set(null);
    this.pickerStart.set(null);
    this.editingKey.set(null);

    if (!product) {
      return;
    }

    if (editing) {
      // Replace the old line; if the new choices match another line, the two merge.
      this.cart.update((lines) => lines.filter((l) => l.key !== editing));
    }

    this.addLine(product, result);
  }

  // --- cart ---

  private get cartStorageKey(): string {
    return CART_STORAGE_PREFIX + this.token;
  }

  /** Keeps the choices for this tab only. Storage can be blocked or full, and then the cart simply is not kept. */
  private saveCart(lines: PublicCartLine[]): void {
    try {
      if (lines.length === 0) {
        sessionStorage.removeItem(this.cartStorageKey);
      } else {
        sessionStorage.setItem(this.cartStorageKey, JSON.stringify({ savedAt: Date.now(), lines }));
      }
    } catch {
      // Not kept.
    }
  }

  /** Puts back the cart saved before a reload, once, when the menu has just loaded. The menu check follows. */
  private restoreCart(): void {
    if (this.cartRestored) {
      return;
    }
    this.cartRestored = true;

    try {
      const raw = sessionStorage.getItem(this.cartStorageKey);
      if (!raw || this.cart().length > 0) {
        return;
      }

      const saved = JSON.parse(raw) as { savedAt?: unknown; lines?: unknown };
      if (
        typeof saved.savedAt !== 'number' ||
        Date.now() - saved.savedAt > CART_KEEP_MS ||
        !Array.isArray(saved.lines)
      ) {
        sessionStorage.removeItem(this.cartStorageKey);
        return;
      }

      const lines = saved.lines.filter((line) => this.isCartLine(line)).slice(0, MAX_CART_LINES);
      if (lines.length > 0) {
        this.cart.set(lines as PublicCartLine[]);
      }
    } catch {
      // Unreadable or blocked: start with an empty cart.
    }
  }

  private isCartLine(line: unknown): boolean {
    const l = line as Partial<PublicCartLine> | null;
    return (
      !!l &&
      typeof l.key === 'string' &&
      typeof l.productId === 'string' &&
      typeof l.name === 'string' &&
      typeof l.price === 'number' &&
      Number.isInteger(l.quantity) &&
      l.quantity! >= 1 &&
      l.quantity! <= MAX_ITEM_QUANTITY &&
      Array.isArray(l.addOns) &&
      l.addOns.every(
        (a) =>
          typeof a?.id === 'string' &&
          typeof a.name === 'string' &&
          typeof a.price === 'number' &&
          Number.isInteger(a.quantity) &&
          a.quantity >= 1,
      )
    );
  }

  private addLine(product: PublicProductDto, result: PublicAddonPickerResult): void {
    const key = [
      product.id,
      result.addOns
        .map((a) => `${a.id}x${a.quantity}`)
        .sort()
        .join(','),
      (result.specialInstructions ?? '').toLowerCase(),
    ].join('|');

    this.cart.update((lines) => {
      const existing = lines.find((l) => l.key === key);

      if (existing) {
        return lines.map((l) =>
          l.key === key
            ? { ...l, quantity: Math.min(MAX_ITEM_QUANTITY, l.quantity + result.quantity) }
            : l,
        );
      }

      return [
        ...lines,
        {
          key,
          productId: product.id,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
          quantity: result.quantity,
          addOns: result.addOns,
          specialInstructions: result.specialInstructions,
        },
      ];
    });
  }

  protected readonly pickerRules = computed(() => {
    const product = this.pickerProduct();
    return product ? (this.dealRulesByProduct().get(product.id) ?? []) : [];
  });

  /** The price a cart line really costs per item before add-ons, when a discount applies to it. */
  protected lineDiscount(line: PublicCartLine): PublicLineDiscount | null {
    const lines = this.cart();
    const index = lines.indexOf(line);
    const best =
      index >= 0
        ? this.cartDiscounts()[index]
        : this.bestDiscountFor(line, new DiscountAllowance());
    if (!best) {
      return null;
    }

    const rest = best.requested - best.quantity;
    const perOrder = best.rule.maxPerOrder;
    const reason =
      perOrder != null && (best.rule.remaining == null || perOrder <= best.rule.remaining)
        ? `limit of ${perOrder} per order`
        : `only ${best.quantity} left`;
    return {
      price: best.price,
      quantity: best.quantity,
      label: formatPromoLabel(best.rule, line.price, addOnsTotal(line.addOns)),
      limited: best.rule.remaining != null || best.rule.maxPerOrder != null,
      note: rest > 0 ? `Promo on ${best.quantity} (${reason}); the other ${rest} at full price.` : null,
    };
  }

  // Lines share what a discount can still take in this order, so each line is judged after the ones above it.
  private readonly cartDiscounts = computed(() => {
    const allowance = new DiscountAllowance();
    return this.cart().map((line) => {
      const best = this.bestDiscountFor(line, allowance);
      if (best) {
        allowance.use(best.rule, best.quantity);
      }

      return best;
    });
  });

  private bestDiscountFor(line: PublicCartLine, allowance: DiscountAllowance): DiscountMatch | null {
    const rules = this.dealRulesByProduct().get(line.productId);
    if (!rules) {
      return null;
    }

    return findBestDiscount(
      line.price,
      line.addOns.flatMap((addOn) => Array.from({ length: addOn.quantity }, () => addOn.id)),
      rules,
      line.quantity,
      allowance,
    );
  }

  /** True when a discount in the cart has a usage limit, so the shop confirms the price when it accepts the order. */
  protected readonly hasLimitedDiscount = computed(() =>
    this.cart().some((line) => this.lineDiscount(line)?.limited),
  );

  protected getBreakdown(line: PublicCartLine): LineBreakdown {
    const discount = this.lineDiscount(line);
    return buildLineBreakdown({
      qty: line.quantity,
      listUnitPrice: line.price,
      addOns: line.addOns.map((addOn) => ({
        addOnId: addOn.id,
        name: addOn.name,
        price: addOn.price,
        quantity: addOn.quantity,
        addOnType: addOn.type,
      })),
      discount: discount
        ? {
            amount: promoDiscount(line.price, discount.price, discount.quantity),
            label: discount.label,
          }
        : null,
    });
  }

  protected unitPrice(line: PublicCartLine): number {
    return priceWithAddOns(this.lineDiscount(line)?.price ?? line.price, line.addOns);
  }

  protected lineTotal(line: PublicCartLine): number {
    const discount = this.lineDiscount(line);
    if (!discount) {
      return extendedPrice(this.unitPrice(line), line.quantity);
    }

    const cents =
      toCents(priceWithAddOns(discount.price, line.addOns)) * discount.quantity +
      toCents(priceWithAddOns(line.price, line.addOns)) * (line.quantity - discount.quantity);
    return fromCents(cents);
  }

  protected changeQuantity(key: string, delta: number): void {
    this.cart.update((lines) =>
      lines
        .map((l) =>
          l.key === key ? { ...l, quantity: Math.min(MAX_ITEM_QUANTITY, l.quantity + delta) } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }

  protected removeLine(key: string): void {
    this.cart.update((lines) => lines.filter((l) => l.key !== key));
  }

  protected clearCart(): void {
    this.cart.set([]);
    this.cartOpen.set(false);
  }

  protected openCart(): void {
    this.isCartCollapsed.set(false);
    this.cartOpen.set(true);
  }

  protected closeCart(): void {
    this.cartOpen.set(false);
  }

  /**
   * Checks the cart against the menu that was just loaded. Items that are gone are removed and changed prices are
   * updated, and the customer is told, so what they see is always what the shop currently sells.
   */
  private reconcileCart(): void {
    const lines = this.cart();
    if (lines.length === 0) {
      return;
    }

    const byId = new Map(this.products().map((p) => [p.id, p]));
    let removed = 0;
    let repriced = false;

    const next: PublicCartLine[] = [];
    for (const line of lines) {
      const product = byId.get(line.productId);
      const groups = this.groupsFor(line.productId);
      const addOns = line.addOns.map((a) =>
        groups.flatMap((g) => g.options).find((o) => o.id === a.id),
      );

      if (!product || addOns.some((a) => !a)) {
        removed++;
        continue;
      }

      const fresh = line.addOns.map((a, i) => ({
        ...a,
        name: addOns[i]!.name,
        price: addOns[i]!.price,
      }));
      if (product.price !== line.price || fresh.some((a, i) => a.price !== line.addOns[i].price)) {
        repriced = true;
      }

      next.push({ ...line, name: product.name, price: product.price, addOns: fresh });
    }

    this.cart.set(next);

    const messages: string[] = [];
    if (removed > 0) {
      messages.push(
        removed === 1
          ? 'An item in your order is no longer available and was removed.'
          : `${removed} items in your order are no longer available and were removed.`,
      );
    }
    if (repriced) {
      messages.push('Some prices have changed. Your order shows the current prices.');
    }
    if (messages.length > 0) {
      this.alerts.warning(messages.join(' '));
    }
  }

  // --- checkout ---

  protected openCheckout(): void {
    if (this.cart().length === 0 || !this.connectivity.isOnline()) {
      return;
    }

    // The cart stays where it is behind the checkout, as in the signed-in order screen, so it does not slide away
    // and back. It closes when the order is placed.
    this.checkoutError.set(null);
    this.checkoutOpen.set(true);
  }

  protected closeCheckout(): void {
    if (this.isPlacingOrder()) {
      return;
    }

    this.checkoutOpen.set(false);
    this.checkoutError.set(null);
  }

  /** The order request for the cart and the checkout form. It carries no prices: the server decides those. */
  protected buildOrderRequest(form: PublicCheckoutForm): SubmitPublicOrderRequest {
    return {
      items: this.cart().map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        addOns: line.addOns.map((addOn) => ({ productId: addOn.id, quantity: addOn.quantity })),
        specialInstructions: line.specialInstructions ?? null,
      })),
      fulfillment: form.fulfillment,
      deliveryAddress: form.deliveryAddress,
      contactNumber: form.contactNumber,
      paymentMethod: form.paymentMethod,
      amountReceived: form.amountReceived,
      tips: form.tips,
      specialInstructions: form.specialInstructions,
      expectedTotal: this.cartTotal(),
      saveContactNumber: form.saveContactNumber,
      saveAddress: form.saveAddress,
    };
  }

  /** The server kept what the customer chose to keep; show the same on the next checkout so it is not asked again. */
  private rememberSavedDetails(form: PublicCheckoutForm): void {
    if (!form.saveContactNumber && !form.saveAddress) {
      return;
    }

    this.link.update((link) =>
      link
        ? {
            ...link,
            contactNumber: form.saveContactNumber ? form.contactNumber : link.contactNumber,
            address: form.saveAddress ? (form.deliveryAddress ?? link.address) : link.address,
          }
        : link,
    );
  }

  protected placeOrder(form: PublicCheckoutForm): void {
    if (this.isPlacingOrder() || this.cart().length === 0) {
      return;
    }

    if (!this.connectivity.isOnline()) {
      this.checkoutError.set("You're offline. Reconnect to place your order.");
      return;
    }

    this.isPlacingOrder.set(true);
    this.checkoutError.set(null);

    this.service.createOrder(this.token, this.buildOrderRequest(form)).subscribe({
      next: (order) => {
        this.isPlacingOrder.set(false);
        this.checkoutOpen.set(false);
        this.rememberSavedDetails(form);
        this.cart.set([]);
        this.cartOpen.set(false);
        this.alerts.success(
          `Your order #${order.orderNumber} was sent. The shop will confirm it shortly.`,
        );
        // Show it straight away on My orders, waiting for confirmation.
        this.goTo(['orders']);
        this.tab.set('orders');
        this.selectedOrderId.set(null);
        this.loadOrders();
      },
      error: (err: Error) => {
        this.isPlacingOrder.set(false);

        // The link stopped working while the customer was filling in checkout: nothing was created, and nothing
        // stays on screen.
        if (err instanceof PublicLinkInvalidError) {
          this.checkoutOpen.set(false);
          this.cart.set([]);
          this.state.set('invalid');
          return;
        }

        this.checkoutError.set(err.message);

        // An item that is no longer sold or a changed price: bring the menu and the cart up to date underneath.
        if (/no longer available|The total changed/i.test(err.message)) {
          this.loadMenu(true);
        }
      },
    });
  }

  // --- my orders ---

  protected openOrder(id: string): void {
    this.goTo(['orders', id]);
    this.applyLocation('orders', id);
  }

  protected closeOrder(): void {
    this.goTo(['orders']);
    this.selectedOrderId.set(null);
  }
}
