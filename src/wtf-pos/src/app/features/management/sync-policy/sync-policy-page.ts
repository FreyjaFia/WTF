import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertService, ConnectivityService, ModalStackService, OfflineSyncPolicyService } from '@core/services';
import { IconComponent, PageTitleComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { OfflineSyncMode, OfflineSyncPolicyDto } from '@shared/models';

interface CodeRow {
  readonly code: string;
  readonly label: string;
  readonly description: string;
}

const CODE_ROWS: readonly CodeRow[] = [
  {
    code: 'PriceChanged',
    label: 'An item price changed',
    description: 'The menu price moved after the register last updated, and before the sale.',
  },
  {
    code: 'AddOnPriceChanged',
    label: 'An add-on price changed',
    description: 'The price of an add-on on an item moved in the same way.',
  },
  {
    code: 'ProductInactive',
    label: 'An item was switched off',
    description: 'An item or add-on in the sale was turned off before the sale was made.',
  },
  {
    code: 'BundleChanged',
    label: 'A bundle changed',
    description: 'The price or the items of a bundle in the sale are no longer the same.',
  },
  {
    code: 'CustomerInactive',
    label: 'The customer was deactivated',
    description: 'The customer on the sale was turned off before the sale was made.',
  },
  {
    code: 'PromotionEnded',
    label: 'A promotion ended',
    description: 'A promotion on the sale ended before the sale was made.',
  },
  {
    code: 'UnknownProduct',
    label: 'An item is not on the menu',
    description: 'The sale has an item the shop does not have.',
  },
];

@Component({
  selector: 'app-sync-policy-page',
  imports: [ConfirmDialogComponent, DatePipe, IconComponent, PageTitleComponent, ReactiveFormsModule],
  templateUrl: './sync-policy-page.html',
  host: { class: 'flex-1 min-h-0' },
})
export class SyncPolicyPageComponent implements OnInit {
  private readonly policyService = inject(OfflineSyncPolicyService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly router = inject(Router);
  private readonly connectivity = inject(ConnectivityService);

  protected readonly hubRoute = AppRoutes.ManagementRoot;
  protected readonly rows = CODE_ROWS;
  protected readonly modes: readonly OfflineSyncMode[] = ['Hold', 'Note'];
  protected readonly isOnline = this.connectivity.isOnline;
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly showDiscardModal = signal(false);
  protected readonly updatedAt = signal<string | null>(null);

  protected readonly form = new FormGroup({
    modes: new FormGroup(
      Object.fromEntries(CODE_ROWS.map((r) => [r.code, new FormControl<OfflineSyncMode>('Hold', { nonNullable: true })])),
    ),
    priceTolerance: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0), Validators.max(1000)],
    }),
    autoApproveNotes: new FormControl(false, { nonNullable: true }),
    agedAfterDays: new FormControl(2, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.max(30), Validators.pattern(/^\d+$/)],
    }),
  });

  protected readonly canSave = computed(() => this.isOnline() && !this.isSaving() && !this.isLoading());

  private skipGuard = false;
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private modalStackId: number | null = null;

  public ngOnInit(): void {
    this.load();
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.form.dirty) {
      return true;
    }

    this.showDiscardModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDiscard());
    return new Promise((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected modeOf(code: string): OfflineSyncMode {
    return this.form.controls.modes.get(code)?.value as OfflineSyncMode;
  }

  protected setMode(code: string, mode: OfflineSyncMode): void {
    const control = this.form.controls.modes.get(code);
    control?.setValue(mode);
    control?.markAsDirty();
  }

  protected load(): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this.policyService.get().subscribe({
      next: (policy) => {
        this.apply(policy);
        this.isLoading.set(false);
      },
      error: (err: Error) => {
        this.alertService.error(err.message);
        this.loadFailed.set(true);
        this.isLoading.set(false);
      },
    });
  }

  protected save(): void {
    if (this.form.invalid || !this.canSave()) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.isSaving.set(true);
    this.policyService
      .save({
        codes: CODE_ROWS.map((r) => ({ code: r.code, mode: value.modes[r.code] as OfflineSyncMode })),
        priceTolerance: Number(value.priceTolerance),
        autoApproveNotes: value.autoApproveNotes,
        agedAfterDays: Number(value.agedAfterDays),
      })
      .subscribe({
        next: (saved) => {
          this.apply(saved);
          this.isSaving.set(false);
          this.alertService.successUpdated('Offline sync policy');
        },
        error: (err: Error) => {
          this.isSaving.set(false);
          this.alertService.error(err.message);
        },
      });
  }

  protected goBack(): void {
    this.router.navigateByUrl(AppRoutes.ManagementRoot);
  }

  protected cancelDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);
    this.pendingDeactivateResolve?.(false);
    this.pendingDeactivateResolve = null;
  }

  protected confirmDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);
    this.pendingDeactivateResolve?.(true);
    this.pendingDeactivateResolve = null;
  }

  private apply(policy: OfflineSyncPolicyDto): void {
    const modes = Object.fromEntries(CODE_ROWS.map((r) => [r.code, 'Hold' as OfflineSyncMode]));
    for (const entry of policy.codes) {
      if (entry.code in modes) {
        modes[entry.code] = entry.mode;
      }
    }

    this.form.reset(
      {
        modes,
        priceTolerance: policy.priceTolerance,
        autoApproveNotes: policy.autoApproveNotes,
        agedAfterDays: policy.agedAfterDays,
      },
      { emitEvent: false },
    );
    this.form.markAsPristine();
    this.updatedAt.set(policy.updatedAt);
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
