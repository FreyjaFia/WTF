import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PublicLinkInvalidError, PublicOrderService } from '@core/services/public-order.service';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
import { CartDrawerComponent } from '@shared/components/cart-drawer/cart-drawer';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import {
  ProductCategoryEnum,
  PublicAddOnGroupDto,
  PublicCartLine,
  PublicOrderDto,
  PublicOrderLinkDto,
  PublicOrderStatusKind,
  PublicProductDto,
} from '@shared/models';
import { LinkInvalidComponent } from './link-invalid/link-invalid';
import {
  MAX_ITEM_QUANTITY,
  PublicAddonPickerComponent,
  PublicAddonPickerResult,
} from './public-addon-picker/public-addon-picker';

type LoadState = 'loading' | 'ready' | 'invalid' | 'error';
type Tab = 'menu' | 'orders';

/** Re-load the menu when the page comes back into view after this long. */
export const MENU_STALE_AFTER_MS = 60_000;
/** How often My orders refreshes itself while it is open and visible. */
export const ORDERS_POLL_MS = 30_000;
const ORDERS_PAGE_SIZE = 50;
/** How long a tab-click scroll is allowed to glide before scroll events move the highlight again. */
export const PROGRAMMATIC_SCROLL_MS = 700;

const CATEGORY_LABELS: Record<number, string> = {
  [ProductCategoryEnum.Drink]: 'Drinks',
  [ProductCategoryEnum.Food]: 'Food',
  [ProductCategoryEnum.Dessert]: 'Desserts',
  [ProductCategoryEnum.Other]: 'Other',
};

const STATUS_VARIANTS: Record<PublicOrderStatusKind, BadgeVariant> = {
  waiting: 'amber',
  accepted: 'info',
  completed: 'success',
  rejected: 'error',
  cancelled: 'default',
  refunded: 'default',
};

/**
 * The page a customer opens from their personal ordering link. They are not signed in.
 *
 * Nothing here is saved on the device: the catalog is fetched fresh every time the page loads and every time the
 * customer returns to the Menu tab, and the cart lives in memory only. That way a customer can never order from an
 * obsolete list. Do not add the catalog cache, the image cache or the offline queue to this page.
 */
@Component({
  selector: 'app-public-order',
  imports: [
    DatePipe,
    DecimalPipe,
    AvatarComponent,
    BadgeComponent,
    CartDrawerComponent,
    IconComponent,
    LinkInvalidComponent,
    NgTemplateOutlet,
    PublicAddonPickerComponent,
    SearchInputComponent,
  ],
  templateUrl: './public-order.html',
  host: { class: 'block h-full' },
})
export class PublicOrderComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(PublicOrderService);

  private readonly sidebarHost = viewChild<ElementRef<HTMLElement>>('sidebarHost');
  private resizeObserver: ResizeObserver | null = null;

  private token = '';
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
  protected readonly cartOpen = signal(false);
  protected readonly pickerProduct = signal<PublicProductDto | null>(null);
  /** The cart line being edited in the picker, or null when adding a new item. */
  protected readonly editingKey = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly orders = signal<PublicOrderDto[]>([]);
  protected readonly ordersState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly ordersError = signal('');
  protected readonly expandedOrderId = signal<string | null>(null);

  /** The customer's picture, unless there is none or it failed to load. */
  protected readonly profileImage = computed(() =>
    this.imageFailed() ? null : (this.link()?.imageUrl ?? null),
  );

  protected readonly products = computed(() => this.link()?.catalog.products ?? []);

  protected readonly filteredProducts = computed(() => {
    const term = this.search().trim().toLowerCase();

    return this.products().filter(
      (p) =>
        !term ||
        p.name.toLowerCase().includes(term) ||
        (p.description ?? '').toLowerCase().includes(term),
    );
  });

  /** One section per category that still has a matching product, in the shop's order. */
  protected readonly sections = computed(() => {
    const products = this.filteredProducts();

    return Object.keys(CATEGORY_LABELS)
      .map(Number)
      .map((id) => ({
        id,
        label: CATEGORY_LABELS[id],
        products: products.filter((p) => p.category === id),
      }))
      .filter((section) => section.products.length > 0);
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
    this.cart().reduce((sum, line) => sum + this.lineTotal(line), 0),
  );

  protected readonly ordersByDate = computed(() => {
    const groups = new Map<string, PublicOrderDto[]>();

    for (const order of this.orders()) {
      const key = new Date(order.createdAt).toDateString();
      groups.set(key, [...(groups.get(key) ?? []), order]);
    }

    return [...groups.entries()].map(([date, orders]) => ({ date, orders }));
  });

  public constructor() {
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
    this.loadMenu();

    document.addEventListener('visibilitychange', this.onVisibility);
    this.pollTimer = setInterval(() => {
      if (this.tab() === 'orders' && !document.hidden && this.state() === 'ready') {
        this.loadOrders(true);
      }
    }, ORDERS_POLL_MS);
  }

  public ngOnDestroy(): void {
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
        this.reconcileCart();
      },
      error: (err: Error) => {
        this.isRefreshingMenu.set(false);

        if (err instanceof PublicLinkInvalidError) {
          this.state.set('invalid');
        } else if (silent && this.link()) {
          // Keep what is on screen, but make sure the customer knows it may be out of date.
          this.notice.set(`${err.message} The menu below may be out of date.`);
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
    if (this.tab() === tab) {
      return;
    }

    this.tab.set(tab);

    if (tab === 'menu') {
      // Always show a fresh menu when coming back to it.
      this.loadMenu(true);
    } else {
      this.loadOrders();
    }
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

  protected dismissNotice(): void {
    this.notice.set(null);
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

  protected closePicker(): void {
    this.pickerProduct.set(null);
    this.editingKey.set(null);
  }

  /** Reopens the picker for a line already in the cart. */
  protected editLine(line: PublicCartLine): void {
    const product = this.products().find((p) => p.id === line.productId);

    if (!product) {
      this.notice.set('That item is no longer available.');
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

  // --- cart (in memory only) ---

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

  protected unitPrice(line: PublicCartLine): number {
    return line.price + line.addOns.reduce((sum, a) => sum + a.price * a.quantity, 0);
  }

  protected lineTotal(line: PublicCartLine): number {
    return this.unitPrice(line) * line.quantity;
  }

  protected changeQuantity(key: string, delta: number): void {
    this.cart.update((lines) =>
      lines
        .map((l) =>
          l.key === key
            ? { ...l, quantity: Math.min(MAX_ITEM_QUANTITY, l.quantity + delta) }
            : l,
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

      const fresh = line.addOns.map((a, i) => ({ ...a, name: addOns[i]!.name, price: addOns[i]!.price }));
      if (
        product.price !== line.price ||
        fresh.some((a, i) => a.price !== line.addOns[i].price)
      ) {
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
      this.notice.set(messages.join(' '));
    }
  }

  // --- my orders ---

  protected toggleOrder(id: string): void {
    this.expandedOrderId.update((current) => (current === id ? null : id));
  }

  protected statusVariant(kind: PublicOrderStatusKind): BadgeVariant {
    return STATUS_VARIANTS[kind];
  }

  protected orderLineTotal(unitPrice: number, quantity: number, addOnsPerUnit: number): number {
    return (unitPrice + addOnsPerUnit) * quantity;
  }

  protected addOnsPerUnit(item: PublicOrderDto['items'][number]): number {
    return item.addOns.reduce((sum, a) => sum + a.unitPrice * a.quantity, 0);
  }
}
