import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AlertService, AuthService, InventoryService, SupplierService } from '@core/services';
import { IconComponent } from '@shared/components';
import { SelectDropdownComponent } from '@shared/components/select-dropdown/select-dropdown';
import { BadgeComponent } from '@shared/components/badge/badge';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { ItemDto, SupplierDto, SupplierFieldsDto, SupplierItemDto } from '@shared/models';

@Component({
  selector: 'app-supplier-details',
  imports: [
    BadgeComponent,
    ConfirmDialogComponent,
    SelectDropdownComponent,
    DecimalPipe,
    IconComponent,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './supplier-details.html',
  host: { class: 'flex-1 min-h-0' },
})
export class SupplierDetailsComponent implements OnInit {
  private readonly suppliersApi = inject(SupplierService);
  private readonly inventory = inject(InventoryService);
  private readonly alertService = inject(AlertService);
  private readonly route = inject(ActivatedRoute);
  protected readonly auth = inject(AuthService);

  protected readonly listRoute = AppRoutes.ManagementSuppliers;
  protected readonly supplier = signal<SupplierDto | null>(null);
  protected readonly allItems = signal<ItemDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isLinking = signal(false);
  protected readonly confirmingDeactivate = signal(false);
  protected readonly editingLinkId = signal<string | null>(null);
  protected readonly pendingRemoval = signal<SupplierItemDto | null>(null);
  protected readonly itemOptions = computed(() => {
    const editing = this.editingLinkId();
    const source = editing
      ? this.allItems().filter((item) => item.id === editing)
      : this.linkableItems();
    return source.map((item) => ({ id: item.id, label: item.name }));
  });
  protected readonly linkableItems = computed(() => {
    const linked = new Set(this.supplier()?.items.map((item) => item.itemId) ?? []);
    return this.allItems().filter((item) => !linked.has(item.id));
  });
  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    contactName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(150)] }),
    address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    leadTimeDays: new FormControl<number | null>(null, [Validators.min(0), Validators.max(365)]),
    paymentTerms: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });
  protected readonly linkForm = new FormGroup({
    itemId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    supplierItemCode: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(50)] }),
    packName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(50)] }),
    unitsPerPack: new FormControl<number | null>(1, [Validators.required, Validators.min(0.001)]),
    packPrice: new FormControl<number | null>(null, [Validators.min(0)]),
    isPreferred: new FormControl(false, { nonNullable: true }),
  });

  public ngOnInit(): void {
    this.load();
  }

  protected canSeeCosts(): boolean {
    return this.auth.canReadInventoryCosts();
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      return;
    }

    this.isLoading.set(true);
    this.suppliersApi.getSupplier(id).subscribe({
      next: (supplier) => {
        this.show(supplier);
        this.isLoading.set(false);
      },
      error: (err: Error) => {
        this.isLoading.set(false);
        this.alertService.error(err.message);
      },
    });

    if (this.auth.canWriteStockMovements()) {
      this.inventory.getInventoryItems({ isActive: true }).subscribe({
        next: (items) => this.allItems.set(items),
        error: (err: Error) => this.alertService.error(err.message),
      });
    }
  }

  protected save(): void {
    const current = this.supplier();
    this.form.markAllAsTouched();
    if (!current || this.form.invalid || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    this.suppliersApi.updateSupplier(current.summary.id, this.readFields()).subscribe({
      next: (supplier) => {
        this.isSaving.set(false);
        this.show(supplier);
        this.alertService.success('Supplier saved.');
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected askDeactivate(): void {
    this.confirmingDeactivate.set(true);
  }

  protected cancelDeactivate(): void {
    this.confirmingDeactivate.set(false);
  }

  protected deactivate(): void {
    const current = this.supplier();
    if (!current) {
      return;
    }

    this.confirmingDeactivate.set(false);
    this.suppliersApi.deactivateSupplier(current.summary.id).subscribe({
      next: (supplier) => this.show(supplier),
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  protected restore(): void {
    const current = this.supplier();
    if (!current) {
      return;
    }

    this.suppliersApi.restoreSupplier(current.summary.id).subscribe({
      next: (supplier) => this.show(supplier),
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  protected editLink(link: SupplierItemDto): void {
    this.editingLinkId.set(link.itemId);
    this.linkForm.setValue({
      itemId: link.itemId,
      supplierItemCode: link.supplierItemCode ?? '',
      packName: link.packName ?? '',
      unitsPerPack: link.unitsPerPack,
      packPrice: link.packPrice,
      isPreferred: link.isPreferred,
    });
  }

  protected resetLinkForm(): void {
    this.editingLinkId.set(null);
    this.linkForm.reset({ itemId: '', supplierItemCode: '', packName: '', unitsPerPack: 1, packPrice: null, isPreferred: false });
  }

  protected saveLink(): void {
    const current = this.supplier();
    this.linkForm.markAllAsTouched();
    if (!current || this.linkForm.invalid || this.isLinking()) {
      return;
    }

    const value = this.linkForm.getRawValue();
    this.isLinking.set(true);
    this.suppliersApi
      .saveItemSupplier(value.itemId, current.summary.id, {
        supplierItemCode: value.supplierItemCode.trim() || null,
        packName: value.packName.trim() || null,
        unitsPerPack: value.unitsPerPack ?? 1,
        packPrice: value.packPrice,
        isPreferred: value.isPreferred,
      })
      .subscribe({
        next: () => {
          this.isLinking.set(false);
          this.resetLinkForm();
          this.reloadSupplier();
        },
        error: (err: Error) => {
          this.isLinking.set(false);
          this.alertService.error(err.message);
        },
      });
  }

  protected confirmRemoval(): void {
    const link = this.pendingRemoval();
    this.pendingRemoval.set(null);
    if (link) {
      this.removeLink(link);
    }
  }

  protected removeLink(link: SupplierItemDto): void {
    const current = this.supplier();
    if (!current) {
      return;
    }

    this.suppliersApi.removeItemSupplier(link.itemId, current.summary.id).subscribe({
      next: () => this.reloadSupplier(),
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  private reloadSupplier(): void {
    const current = this.supplier();
    if (!current) {
      return;
    }

    this.suppliersApi.getSupplier(current.summary.id).subscribe({
      next: (supplier) => this.show(supplier),
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  private show(supplier: SupplierDto): void {
    this.supplier.set(supplier);
    const s = supplier.summary;
    this.form.reset({
      name: s.name,
      contactName: s.contactName ?? '',
      phone: s.phone ?? '',
      email: s.email ?? '',
      address: s.address ?? '',
      leadTimeDays: s.leadTimeDays,
      paymentTerms: s.paymentTerms ?? '',
      notes: s.notes ?? '',
    });
    if (!this.auth.canWriteStockMovements()) {
      this.form.disable();
    }
  }

  private readFields(): SupplierFieldsDto {
    const value = this.form.getRawValue();
    return {
      name: value.name.trim(),
      contactName: value.contactName.trim() || null,
      phone: value.phone.trim() || null,
      email: value.email.trim() || null,
      address: value.address.trim() || null,
      leadTimeDays: value.leadTimeDays,
      paymentTerms: value.paymentTerms.trim() || null,
      notes: value.notes.trim() || null,
    };
  }
}
