import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { AlertService, AuthService, BranchService, ConnectivityService, KitchenAccessError, KitchenService, SignalRService } from '@core/services';
import { orderNumberLabel } from '@shared/utils/order-number';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import {
  IconComponent,
  SearchInputComponent,
  SideDrawerComponent,
} from '@shared/components';
import {
  kitchenActionLabel,
  kitchenAgeLabel,
  kitchenAgeMinutes,
  kitchenAgeTone,
  kitchenNextState,
  kitchenPreviousState,
  type KitchenAgeTone,
} from '@shared/calculations';
import {
  FulfillmentTypeEnum,
  KitchenChangeKindEnum,
  KitchenOrderDto,
  KitchenStateEnum,
  OrderSourceEnum,
} from '@shared/models';
import { debounceTime, Subject } from 'rxjs';

type BoardView = 'board' | 'served';

interface BoardColumn {
  state: KitchenStateEnum;
  label: string;
  empty: string;
}

const COLUMNS: BoardColumn[] = [
  { state: KitchenStateEnum.New, label: 'New', empty: 'No new orders' },
  { state: KitchenStateEnum.Preparing, label: 'Preparing', empty: 'Nothing being made' },
  { state: KitchenStateEnum.Ready, label: 'Ready', empty: 'Nothing waiting to be served' },
];

const POLL_MS = 30000;
const TICK_MS = 15000;
const LARGE_TEXT_KEY = 'wtf.kitchen.largeText';
const CHIME_KEY = 'wtf.kitchen.chime';

@Component({
  selector: 'app-kitchen-board',
  imports: [FilterButtonComponent, IconComponent, NgTemplateOutlet, SearchInputComponent, SideDrawerComponent],
  templateUrl: './kitchen-board.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KitchenBoardComponent implements OnInit, OnDestroy {
  private readonly kitchen = inject(KitchenService);
  protected readonly branchService = inject(BranchService);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(AlertService);
  private readonly signalR = inject(SignalRService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = COLUMNS;
  protected readonly States = KitchenStateEnum;
  protected readonly ChangeKind = KitchenChangeKindEnum;
  protected readonly searchControl = new FormControl('', { nonNullable: true });

  protected readonly orders = signal<KitchenOrderDto[]>([]);
  protected readonly view = signal<BoardView>('board');
  protected readonly activeTab = signal<KitchenStateEnum>(KitchenStateEnum.New);
  protected readonly sourceFilter = signal<OrderSourceEnum | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly accessMessage = signal<string | null>(null);
  protected readonly isFiltersOpen = signal(false);
  protected readonly busyIds = signal<ReadonlySet<string>>(new Set());
  protected readonly largeText = signal(readFlag(LARGE_TEXT_KEY));
  protected readonly chimeOn = signal(readFlag(CHIME_KEY));
  protected readonly isFullscreen = signal(false);
  protected readonly now = signal(Date.now());
  protected readonly isOnline = this.connectivity.isOnline;

  protected readonly canUpdate = computed(() => this.auth.canUpdateKitchen());

  protected readonly needsBranch = computed(() => this.branchService.isMultiBranch() && this.branchService.isAllSelected());

  protected readonly canAct = computed(() => this.canUpdate() && !this.needsBranch());

  protected readonly activeFilterCount = computed(() => (this.sourceFilter() === null ? 0 : 1));

  protected readonly staleOrders = computed(() =>
    this.orders().filter((o) => o.isStale && !o.isStopMaking && o.kitchenStatus !== KitchenStateEnum.Served),
  );

  protected readonly stopMakingOrders = computed(() => this.orders().filter((o) => o.isStopMaking));

  protected readonly liveOrders = computed(() =>
    this.orders().filter((o) => !o.isStale && !o.isStopMaking && o.kitchenStatus !== KitchenStateEnum.Served),
  );

  protected readonly servedOrders = computed(() =>
    this.orders().filter((o) => o.kitchenStatus === KitchenStateEnum.Served),
  );

  protected readonly counts = computed(() => {
    const counts: Record<number, number> = {
      [KitchenStateEnum.New]: 0,
      [KitchenStateEnum.Preparing]: 0,
      [KitchenStateEnum.Ready]: 0,
    };
    for (const order of this.liveOrders()) {
      counts[order.kitchenStatus] += 1;
    }

    return counts;
  });

  private readonly refetch$ = new Subject<void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private knownIds: Set<string> | null = null;
  private audio: AudioContext | null = null;
  private loadSeq = 0;

  private readonly visibilityHandler = (): void => {
    if (document.visibilityState === 'visible') {
      this.load();
      void this.requestWakeLock();
    }
  };

  private readonly fullscreenHandler = (): void => {
    this.isFullscreen.set(!!document.fullscreenElement);
  };

  constructor() {
    effect(() => {
      if (this.isOnline()) {
        this.load();
      }
    });
  }

  public ngOnInit(): void {
    this.load();
    this.signalR.startStaffOrdersHub();
    this.signalR.orderChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refetch$.next());
    this.refetch$.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
    this.searchControl.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.forgetKnownOrders();
        this.load();
      });

    this.pollTimer = setInterval(() => this.load(), POLL_MS);
    this.tickTimer = setInterval(() => this.now.set(Date.now()), TICK_MS);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    document.addEventListener('fullscreenchange', this.fullscreenHandler);
    void this.requestWakeLock();
  }

  public ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }

    document.removeEventListener('visibilitychange', this.visibilityHandler);
    document.removeEventListener('fullscreenchange', this.fullscreenHandler);
    this.signalR.stopStaffOrdersHub();
    void this.wakeLock?.release().catch(() => undefined);
    void this.audio?.close().catch(() => undefined);
  }

  protected orderLabel(order: KitchenOrderDto): string {
    return orderNumberLabel(order.orderNumber, order.branchCode, this.branchService.isMultiBranch() && this.branchService.isAllSelected());
  }

  protected ordersIn(state: KitchenStateEnum): KitchenOrderDto[] {
    return this.liveOrders().filter((o) => o.kitchenStatus === state);
  }

  protected selectView(view: BoardView): void {
    if (this.view() === view) {
      return;
    }

    this.view.set(view);
    this.forgetKnownOrders();
    this.load();
  }

  protected selectTab(state: KitchenStateEnum): void {
    this.activeTab.set(state);
  }

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected setSource(source: OrderSourceEnum | null): void {
    this.sourceFilter.set(source);
    this.forgetKnownOrders();
    this.load();
  }

  protected clearFilters(): void {
    this.sourceFilter.set(null);
    this.forgetKnownOrders();
    this.load();
  }

  protected refresh(): void {
    this.load();
  }

  protected toggleLargeText(): void {
    this.largeText.update((on) => !on);
    writeFlag(LARGE_TEXT_KEY, this.largeText());
  }

  protected toggleChime(): void {
    this.chimeOn.update((on) => !on);
    writeFlag(CHIME_KEY, this.chimeOn());
    if (this.chimeOn()) {
      this.playChime();
    }
  }

  protected toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  }

  protected advance(order: KitchenOrderDto): void {
    const next = kitchenNextState(order.kitchenStatus);
    if (next === null) {
      return;
    }

    this.run(order, { to: next, from: order.kitchenStatus });
  }

  protected stepBack(order: KitchenOrderDto): void {
    const previous = kitchenPreviousState(order.kitchenStatus);
    if (previous === null) {
      return;
    }

    this.run(order, { to: previous, from: order.kitchenStatus });
  }

  protected bringBack(order: KitchenOrderDto): void {
    this.run(order, { to: KitchenStateEnum.Ready, from: KitchenStateEnum.Served, bringBack: true });
  }

  protected markSeen(order: KitchenOrderDto): void {
    this.runCall(order, this.kitchen.markChangeSeen(order.id));
  }

  protected dismiss(order: KitchenOrderDto): void {
    this.runCall(order, this.kitchen.dismiss(order.id), true);
  }

  protected clearOld(): void {
    this.kitchen
      .clearOld()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.load(),
        error: (err: Error) => this.alerts.error(err.message),
      });
  }

  protected isBusy(order: KitchenOrderDto): boolean {
    return this.busyIds().has(order.id);
  }

  protected actionLabel(order: KitchenOrderDto): string {
    return kitchenActionLabel(order.kitchenStatus, this.isPickup(order));
  }

  protected backLabel(order: KitchenOrderDto): string {
    return order.kitchenStatus === KitchenStateEnum.Ready ? 'Back to Preparing' : 'Back to New';
  }

  protected canStepBack(order: KitchenOrderDto): boolean {
    return order.kitchenStatus !== KitchenStateEnum.New;
  }

  protected isPickup(order: KitchenOrderDto): boolean {
    return order.fulfillmentType !== FulfillmentTypeEnum.Delivery;
  }

  protected fulfillmentLabel(order: KitchenOrderDto): string {
    if (order.source !== OrderSourceEnum.CustomerLink && order.fulfillmentType == null) {
      return 'In shop';
    }

    return this.isPickup(order) ? 'Pickup' : 'Delivery';
  }

  protected ageMinutes(order: KitchenOrderDto): number {
    return kitchenAgeMinutes(order.createdAt, this.now());
  }

  protected ageLabel(order: KitchenOrderDto): string {
    return kitchenAgeLabel(this.ageMinutes(order));
  }

  protected ageTone(order: KitchenOrderDto): KitchenAgeTone {
    return order.kitchenStatus === KitchenStateEnum.Served ? 'ok' : kitchenAgeTone(this.ageMinutes(order));
  }

  protected temperatureOf(order: KitchenOrderDto, lineIndex: number): string | null {
    const temperature = order.lines[lineIndex].addOns.find((a) => a.isTemperature);
    return temperature ? temperature.name : null;
  }

  protected trackById(_index: number, order: KitchenOrderDto): string {
    return order.id;
  }

  private load(): void {
    if (!this.connectivity.isOnline()) {
      return;
    }

    const seq = ++this.loadSeq;
    const served = this.view() === 'served';
    this.kitchen
      .getBoard({
        states: served ? [KitchenStateEnum.Served] : [KitchenStateEnum.New, KitchenStateEnum.Preparing, KitchenStateEnum.Ready],
        source: this.sourceFilter(),
        search: this.searchControl.value,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (board) => {
          if (seq !== this.loadSeq) {
            return;
          }

          this.orders.set(board.orders);
          this.now.set(Date.now());
          this.isLoading.set(false);
          this.loadFailed.set(false);
          this.accessMessage.set(null);
          this.noticeNewOrders(board.orders);
        },
        error: (err: Error) => {
          if (seq !== this.loadSeq) {
            return;
          }

          this.isLoading.set(false);
          this.loadFailed.set(true);
          this.accessMessage.set(err instanceof KitchenAccessError ? err.message : null);
        },
      });
  }

  private run(order: KitchenOrderDto, request: { to: KitchenStateEnum; from: KitchenStateEnum; bringBack?: boolean }): void {
    this.runCall(order, this.kitchen.move(order.id, request));
  }

  private runCall(order: KitchenOrderDto, call: ReturnType<KitchenService['move']>, remove = false): void {
    this.setBusy(order.id, true);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.setBusy(order.id, false);
        this.orders.update((list) =>
          remove
            ? list.filter((o) => o.id !== order.id)
            : this.view() === 'board' && updated.kitchenStatus === KitchenStateEnum.Served
              ? list.filter((o) => o.id !== order.id)
              : this.view() === 'served' && updated.kitchenStatus !== KitchenStateEnum.Served
                ? list.filter((o) => o.id !== order.id)
                : list.map((o) => (o.id === order.id ? updated : o)),
        );
      },
      error: (err: Error) => {
        this.setBusy(order.id, false);
        this.alerts.error(err.message);
        this.load();
      },
    });
  }

  private setBusy(id: string, busy: boolean): void {
    this.busyIds.update((ids) => {
      const next = new Set(ids);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }

  // A different filter or view lists other orders, which are not new arrivals and must not ring the chime.
  private forgetKnownOrders(): void {
    this.knownIds = null;
  }

  private noticeNewOrders(orders: KitchenOrderDto[]): void {
    if (this.view() !== 'board') {
      return;
    }

    const ids = new Set(orders.filter((o) => o.kitchenStatus === KitchenStateEnum.New).map((o) => o.id));
    const known = this.knownIds;
    this.knownIds = ids;
    if (known && this.chimeOn() && [...ids].some((id) => !known.has(id))) {
      this.playChime();
    }
  }

  private playChime(): void {
    try {
      this.audio ??= new AudioContext();
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + 0.4);
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + 0.4);
    } catch {
      // No sound available on this device.
    }
  }

  private async requestWakeLock(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
      this.wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      // The screen may sleep on this device.
    }
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Storage is blocked: the choice is kept for this visit only.
  }
}
