import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { HasUnsavedChanges } from '@core/guards/unsaved-changes.guard';
import {
  AlertService,
  AuthService,
  ConnectivityService,
  ModalStackService,
  StockWasteService,
  WasteReasonService,
} from '@core/services';
import { wasteBalanceAfter, wasteNeedsReview } from '@shared/calculations';
import { IconComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { WasteItem } from '@shared/components/record-waste-dialog/record-waste-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { StockWasteSource, WasteReasonDto } from '@shared/models';

const MAX_QUANTITY = 999999.999;

@Component({
  selector: 'app-record-waste-editor',
  imports: [ConfirmDialogComponent, IconComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './record-waste-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex-1 min-h-0' },
})
export class RecordWasteEditorComponent implements OnInit, HasUnsavedChanges {
  private readonly stockWaste = inject(StockWasteService);
  private readonly wasteReasons = inject(WasteReasonService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly connectivity = inject(ConnectivityService);
  private readonly auth = inject(AuthService);

  protected readonly routes = AppRoutes;
  protected readonly isOnline = this.connectivity.isOnline;
  protected readonly item = signal<WasteItem | null>(null);
  protected readonly reasons = signal<WasteReasonDto[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly showDiscardModal = signal(false);

  protected readonly form = new FormGroup({
    quantity: new FormControl<number | null>(null),
    reasonId: new FormControl<string>('', { nonNullable: true }),
    notes: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly quantity = toSignal(this.form.controls.quantity.valueChanges, { initialValue: null });
  private readonly reasonId = toSignal(this.form.controls.reasonId.valueChanges, { initialValue: '' });

  // One id per page visit: a retry after a failed or timed-out request sends the same id, so the API saves it once.
  private readonly clientRequestId = crypto.randomUUID();
  private skipGuard = false;
  private modalStackId: number | null = null;
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;

  protected readonly unit = computed(() => {
    const item = this.item();
    return item ? getInventoryUnitAbbreviation(item.unitName) : '';
  });

  protected readonly selectedReason = computed<WasteReasonDto | null>(() => {
    const id = Number(this.reasonId());
    return this.reasons().find((reason) => reason.id === id) ?? null;
  });

  protected readonly validQuantity = computed<number | null>(() => {
    const quantity = this.quantity();
    if (quantity === null || quantity === undefined || Number.isNaN(quantity) || quantity <= 0) {
      return null;
    }

    return quantity;
  });

  protected readonly balanceAfter = computed<number | null>(() => {
    const item = this.item();
    const quantity = this.validQuantity();
    return item && quantity !== null ? wasteBalanceAfter(item.currentQuantity, quantity) : null;
  });

  protected readonly needsReview = computed(() => {
    const item = this.item();
    const quantity = this.validQuantity();
    return !!item && quantity !== null && wasteNeedsReview(quantity, item.wasteApprovalLimit);
  });

  protected readonly goesBelowZero = computed(() => {
    const after = this.balanceAfter();
    return after !== null && after < 0;
  });

  protected readonly isBlocked = computed(() => this.goesBelowZero() && !this.item()?.allowNegativeStock);

  public ngOnInit(): void {
    this.load();
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.form.dirty) {
      return true;
    }

    this.showDiscardModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDiscard());

    return new Promise<boolean>((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected confirmDiscard(): void {
    this.closeDiscard(true);
  }

  protected cancelDiscard(): void {
    this.closeDiscard(false);
  }

  protected load(): void {
    const itemId = this.route.snapshot.paramMap.get('itemId');
    this.isLoading.set(true);
    this.loadError.set(null);

    this.stockWaste.getWasteItems().subscribe({
      next: (items) => {
        const found = items.find((entry) => entry.id === itemId);
        this.item.set(
          found
            ? {
                id: found.id,
                name: found.name,
                unitName: found.baseUnit,
                currentQuantity: found.currentQuantity,
                allowNegativeStock: found.allowNegativeStock,
                wasteApprovalLimit: found.wasteApprovalLimit ?? null,
              }
            : null,
        );
        this.isLoading.set(false);
      },
      error: (error: Error) => {
        this.loadError.set(error.message);
        this.isLoading.set(false);
      },
    });

    this.wasteReasons.getReasons().subscribe({
      next: (reasons) =>
        this.reasons.set(
          reasons
            .filter((reason) => reason.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        ),
      error: (error: Error) => this.loadError.set(error.message),
    });
  }

  protected save(): void {
    if (this.isSaving()) {
      return;
    }

    const item = this.item();
    const quantity = this.validQuantity();
    const reason = this.selectedReason();
    const notes = this.form.controls.notes.value.trim();

    if (!item) {
      return;
    }

    if (!this.isOnline()) {
      this.error.set('Recording waste needs a connection. Try again when you are back online.');
      return;
    }

    if (quantity === null) {
      this.error.set('Enter how much was wasted.');
      return;
    }

    if (quantity > MAX_QUANTITY) {
      this.error.set('The quantity is too large.');
      return;
    }

    if (!reason) {
      this.error.set('Choose a reason.');
      return;
    }

    if (reason.requiresNote && !notes) {
      this.error.set(`A note is required when the reason is ${reason.name}.`);
      return;
    }

    if (this.isBlocked()) {
      this.error.set(`${item.name} does not allow sales below zero, so it cannot waste more than its balance.`);
      return;
    }

    this.error.set(null);
    this.isSaving.set(true);
    this.stockWaste
      .recordWaste({
        itemId: item.id,
        quantity,
        wasteReasonId: reason.id,
        notes: notes || null,
        source: StockWasteSource.ItemDetails,
        clientRequestId: this.clientRequestId,
      })
      .subscribe({
        next: (waste) => {
          this.isSaving.set(false);
          this.skipGuard = true;
          this.alertService.success(
            waste.status === 'PendingReview' ? 'Waste recorded. It needs Admin review.' : 'Waste recorded.',
          );
          void this.router.navigateByUrl(
            this.auth.canReadStockMovements() ? AppRoutes.InventoryWaste : AppRoutes.InventoryWasteRecord,
          );
        },
        error: (error: Error) => {
          this.isSaving.set(false);
          this.error.set(error.message);
        },
      });
  }

  private closeDiscard(leave: boolean): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }

    this.showDiscardModal.set(false);

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(leave);
      this.pendingDeactivateResolve = null;
    }
  }
}
