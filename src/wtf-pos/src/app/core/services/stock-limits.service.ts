import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  PosStockLimitsDto,
  StockLimitItemDto,
  StockLimitLinkDto,
  StockLimitSizeAmountDto,
  StockSizeMultiplierDto,
} from '@shared/models';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const POLL_MS = 60_000;

/**
 * The items that block sales when they run short, with their balances and which products take them. The order editor
 * uses it to tell a cashier before payment that a cart cannot be sold. It is a guide, not the check: the server still
 * refuses the sale, because another register may take the stock first. Cashiers cannot read stock in general, so this
 * is the one small view of it they get.
 */
@Injectable({ providedIn: 'root' })
export class StockLimitsService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly url = `${environment.apiUrl}/pos/stock-limits`;

  private readonly _data = signal<PosStockLimitsDto | null>(null);

  public readonly items = computed<StockLimitItemDto[]>(() => this._data()?.items ?? []);
  public readonly links = computed<StockLimitLinkDto[]>(() => this._data()?.links ?? []);
  public readonly sizeMultipliers = computed<StockSizeMultiplierDto[]>(() => this._data()?.sizeMultipliers ?? []);
  public readonly sizeAmounts = computed<StockLimitSizeAmountDto[]>(() => this._data()?.sizeAmounts ?? []);
  public readonly asOf = computed(() => this._data()?.asOf ?? null);
  public readonly hasBlockingItems = computed(() => this.items().length > 0);

  private usage = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  public start(): void {
    this.usage += 1;
    if (this.usage > 1) {
      return;
    }

    this.pollTimer = setInterval(() => {
      if (this.connectivity.isOnline()) {
        this.refresh();
      }
    }, POLL_MS);
    this.refresh();
  }

  public stop(): void {
    if (this.usage === 0) {
      return;
    }

    this.usage -= 1;
    if (this.usage === 0) {
      this.clearTimer();
    }
  }

  public load(): Observable<PosStockLimitsDto> {
    return this.http.get<PosStockLimitsDto>(this.url).pipe(tap((result) => this._data.set(result)));
  }

  /** Reloads quietly. A failure keeps the last answer: this is a hint and must never raise an error. */
  public refresh(): void {
    this.load().subscribe({ error: () => undefined });
  }

  public ngOnDestroy(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
