import { DecimalPipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { AlertService, AuthService, ReorderService } from '@core/services';
import { ConnectionErrorComponent, IconComponent, PullToRefreshComponent } from '@shared/components';
import { reorderMessage } from '@shared/calculations';
import { ParLevelRowDto, ReorderGroupDto, ReorderListDto } from '@shared/models';

@Component({
  selector: 'app-reorder',
  imports: [ConnectionErrorComponent, DecimalPipe, IconComponent, PullToRefreshComponent],
  templateUrl: './reorder.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ReorderComponent implements OnInit {
  private readonly reorderApi = inject(ReorderService);
  private readonly alertService = inject(AlertService);
  protected readonly auth = inject(AuthService);

  protected readonly list = signal<ReorderListDto | null>(null);
  protected readonly parRows = signal<ParLevelRowDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly showPar = signal(false);
  protected readonly savingItemId = signal<string | null>(null);

  public ngOnInit(): void {
    this.load();
  }

  protected canSeeCosts(): boolean {
    return this.auth.canReadInventoryCosts();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected load(): void {
    this.connectionFailed.set(false);
    this.isLoading.set(true);
    this.reorderApi.getReorderList().subscribe({
      next: (list) => {
        this.list.set(list);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected togglePar(): void {
    this.showPar.update((value) => !value);
    if (this.showPar()) {
      this.reorderApi.getParLevels().subscribe({
        next: (rows) => this.parRows.set(rows),
        error: (err: Error) => this.alertService.error(err.message),
      });
    }
  }

  protected savePar(row: ParLevelRowDto, input: HTMLInputElement): void {
    const raw = input.value.trim();
    const parLevel = raw === '' ? null : Number(raw);
    if (parLevel !== null && (!Number.isFinite(parLevel) || parLevel < 0)) {
      this.alertService.error('Par level must be zero or more.');
      return;
    }

    if (parLevel === row.parLevel) {
      return;
    }

    this.savingItemId.set(row.itemId);
    this.reorderApi.setParLevel(row.itemId, parLevel).subscribe({
      next: (saved) => {
        this.savingItemId.set(null);
        this.parRows.update((rows) => rows.map((r) => (r.itemId === saved.itemId ? saved : r)));
        this.load();
      },
      error: (err: Error) => {
        this.savingItemId.set(null);
        input.value = row.parLevel === null ? '' : String(row.parLevel);
        this.alertService.error(err.message);
      },
    });
  }

  protected copyOrder(group: ReorderGroupDto): void {
    const text = reorderMessage(group);
    navigator.clipboard.writeText(text).then(
      () => this.alertService.success(`Order for ${group.supplierName} copied.`),
      () => this.alertService.error('Unable to copy the order.'),
    );
  }
}
