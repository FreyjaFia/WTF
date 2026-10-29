import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { AlertService, ModalStackService, WasteReasonService } from '@core/services';
import { BadgeComponent, IconComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { PullToRefreshComponent } from '@shared/components/pull-to-refresh/pull-to-refresh';
import { SaveWasteReasonDto, WasteReasonDto } from '@shared/models';

type ReasonDialog = 'edit' | 'deactivate' | 'restore';

@Component({
  selector: 'app-waste-reasons',
  imports: [
    ReactiveFormsModule,
    BadgeComponent,
    ConfirmDialogComponent,
    IconComponent,
    PullToRefreshComponent,
  ],
  templateUrl: './waste-reasons.html',
  host: { class: 'flex-1 min-h-0' },
})
export class WasteReasonsComponent implements OnInit, OnDestroy {
  private readonly wasteReasonService = inject(WasteReasonService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);

  protected readonly isAndroid = Capacitor.getPlatform() === 'android';
  protected readonly reasons = signal<WasteReasonDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly dialog = signal<ReasonDialog | null>(null);
  protected readonly selected = signal<WasteReasonDto | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly sortedReasons = computed(() =>
    [...this.reasons()].sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    ),
  );
  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    requiresNote: new FormControl(false, { nonNullable: true }),
    sortOrder: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
  });

  private modalStackId: number | null = null;

  public ngOnInit(): void {
    this.loadReasons();
  }

  public ngOnDestroy(): void {
    this.removeFromStack();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadReasons();
  }

  protected openAdd(): void {
    const nextOrder = this.reasons().reduce((max, r) => Math.max(max, r.sortOrder), 0) + 10;
    this.selected.set(null);
    this.form.reset({ name: '', requiresNote: false, sortOrder: nextOrder });
    this.form.controls.requiresNote.enable();
    this.openDialog('edit');
  }

  protected openEdit(reason: WasteReasonDto): void {
    this.selected.set(reason);
    this.form.reset({
      name: reason.name,
      requiresNote: reason.requiresNote,
      sortOrder: reason.sortOrder,
    });

    if (reason.isSystem && reason.requiresNote) {
      this.form.controls.requiresNote.disable();
    } else {
      this.form.controls.requiresNote.enable();
    }

    this.openDialog('edit');
  }

  protected openDeactivate(reason: WasteReasonDto): void {
    this.selected.set(reason);
    this.openDialog('deactivate');
  }

  protected openRestore(reason: WasteReasonDto): void {
    this.selected.set(reason);
    this.openDialog('restore');
  }

  protected closeDialog(): void {
    if (this.isSaving()) {
      return;
    }

    this.dialog.set(null);
    this.selected.set(null);
    this.formError.set(null);
    this.removeFromStack();
  }

  protected saveReason(): void {
    this.form.markAllAsTouched();
    const name = this.form.controls.name.value.trim();
    if (this.form.invalid || name.length === 0) {
      this.formError.set('Enter a name of up to 60 characters and a sort order of 0 or more.');
      return;
    }

    const dto: SaveWasteReasonDto = {
      name,
      requiresNote: this.form.getRawValue().requiresNote,
      sortOrder: Number(this.form.controls.sortOrder.value),
    };
    const current = this.selected();
    const request = current
      ? this.wasteReasonService.updateReason(current.id, dto)
      : this.wasteReasonService.createReason(dto);

    this.isSaving.set(true);
    this.formError.set(null);
    request.subscribe({
      next: (saved) => {
        this.upsert(saved);
        this.isSaving.set(false);
        this.alertService.success(current ? 'Waste reason saved.' : 'Waste reason added.');
        this.closeDialog();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.formError.set(err.message);
      },
    });
  }

  protected confirmDeactivate(): void {
    const reason = this.selected();
    if (!reason) {
      return;
    }

    this.isSaving.set(true);
    this.wasteReasonService.deactivateReason(reason.id).subscribe({
      next: (saved) => {
        this.upsert(saved);
        this.isSaving.set(false);
        this.alertService.success(`${saved.name} is turned off.`);
        this.closeDialog();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected confirmRestore(): void {
    const reason = this.selected();
    if (!reason) {
      return;
    }

    this.isSaving.set(true);
    this.wasteReasonService.restoreReason(reason.id).subscribe({
      next: (saved) => {
        this.upsert(saved);
        this.isSaving.set(false);
        this.alertService.success(`${saved.name} is restored.`);
        this.closeDialog();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  private openDialog(kind: ReasonDialog): void {
    this.formError.set(null);
    this.dialog.set(kind);
    this.removeFromStack();
    this.modalStackId = this.modalStack.push(() => this.closeDialog());
  }

  private upsert(saved: WasteReasonDto): void {
    const list = this.reasons();
    if (list.some((r) => r.id === saved.id)) {
      this.reasons.set(list.map((r) => (r.id === saved.id ? saved : r)));
    } else {
      this.reasons.set([...list, saved]);
    }
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  private loadReasons(): void {
    this.isLoading.set(!this.isRefreshing());
    this.wasteReasonService.getReasons(true).subscribe({
      next: (reasons) => {
        this.reasons.set(reasons);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }
}
