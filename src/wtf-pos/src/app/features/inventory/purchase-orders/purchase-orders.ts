import { DatePipe, DecimalPipe } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorMessages } from '@core/messages';
import {
  AlertService,
  AuthService,
  InventoryService,
  PurchaseOrderService,
  SupplierService,
} from '@core/services';
import {
  BadgeVariant,
  ConfirmDialogComponent,
  ConnectionErrorComponent,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
} from '@shared/components';
import { BadgeComponent } from '@shared/components/badge/badge';
import { SelectDropdownComponent } from '@shared/components/select-dropdown/select-dropdown';
import { packUnitCost, receiptLineTotal, unitsFromPacks } from '@shared/calculations';
import {
  ItemDto,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  PurchaseOrderSummaryDto,
  SupplierItemDto,
  SupplierSummaryDto,
} from '@shared/models';

type OrderLineGroup = FormGroup<{
  itemId: FormControl<string>;
  packName: FormControl<string>;
  packs: FormControl<number | null>;
  unitsPerPack: FormControl<number | null>;
  packPrice: FormControl<number | null>;
}>;

function newLine(): OrderLineGroup {
  return new FormGroup({
    itemId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    packName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(50)] }),
    packs: new FormControl<number | null>(null, [Validators.required, Validators.min(0.001)]),
    unitsPerPack: new FormControl<number | null>(1, [Validators.required, Validators.min(0.001)]),
    packPrice: new FormControl<number | null>(null, [Validators.min(0)]),
  });
}

const statusLabels: Record<number, string> = {
  [PurchaseOrderStatus.Draft]: 'Draft',
  [PurchaseOrderStatus.Sent]: 'Sent',
  [PurchaseOrderStatus.PartlyReceived]: 'Partly received',
  [PurchaseOrderStatus.Received]: 'Received',
  [PurchaseOrderStatus.Cancelled]: 'Cancelled',
};

const statusVariants: Record<number, BadgeVariant> = {
  [PurchaseOrderStatus.Draft]: 'default',
  [PurchaseOrderStatus.Sent]: 'info',
  [PurchaseOrderStatus.PartlyReceived]: 'amber',
  [PurchaseOrderStatus.Received]: 'success',
  [PurchaseOrderStatus.Cancelled]: 'error',
};

const statusBars: Record<number, string> = {
  [PurchaseOrderStatus.Draft]: 'bg-gray-300',
  [PurchaseOrderStatus.Sent]: 'bg-blue-400',
  [PurchaseOrderStatus.PartlyReceived]: 'bg-amber-400',
  [PurchaseOrderStatus.Received]: 'bg-green-500',
  [PurchaseOrderStatus.Cancelled]: 'bg-red-300',
};

type OrderAction = 'send' | 'cancel' | 'close';

@Component({
  selector: 'app-purchase-orders',
  imports: [
    BadgeComponent,
    ConfirmDialogComponent,
    ConnectionErrorComponent,
    DatePipe,
    DecimalPipe,
    IconComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    SearchInputComponent,
    SelectDropdownComponent,
  ],
  templateUrl: './purchase-orders.html',
  host: { class: 'flex-1 min-h-0' },
})
export class PurchaseOrdersComponent implements OnInit {
  private readonly ordersApi = inject(PurchaseOrderService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly inventory = inject(InventoryService);
  private readonly alertService = inject(AlertService);
  protected readonly auth = inject(AuthService);

  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly statuses = PurchaseOrderStatus;
  protected readonly search = signal('');
  protected readonly pendingAction = signal<{ action: OrderAction; order: PurchaseOrderDto } | null>(null);
  protected readonly isActing = signal(false);
  protected readonly statusFilter = signal<number | null>(null);
  protected readonly orders = signal<PurchaseOrderSummaryDto[]>([]);
  protected readonly suppliers = signal<SupplierSummaryDto[]>([]);
  protected readonly items = signal<ItemDto[]>([]);
  protected readonly filteredOrders = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.orders();
    }

    return this.orders().filter((order) =>
      [`po-${order.poNumber}`, order.supplierName, order.note, order.createdByName].some((field) =>
        field?.toLowerCase().includes(term),
      ),
    );
  });
  protected readonly supplierOptions = computed(() =>
    this.suppliers().map((supplier) => ({ id: supplier.id, label: supplier.name })),
  );
  protected readonly itemOptions = computed(() =>
    this.items().map((item) => ({ id: item.id, label: item.name })),
  );
  protected readonly supplierItems = signal<SupplierItemDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isFormOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly expanded = signal<PurchaseOrderDto | null>(null);
  protected readonly formTick = signal(0);
  protected readonly header = new FormGroup({
    supplierId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    expectedOn: new FormControl('', { nonNullable: true }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });
  protected readonly lines = new FormArray<OrderLineGroup>([newLine()]);
  protected readonly lineTotals = computed(() => {
    this.formTick();
    return this.lines.controls.map((line) => {
      const value = line.getRawValue();
      return receiptLineTotal(value.packs ?? 0, value.packPrice);
    });
  });
  protected readonly orderTotal = computed(() => {
    const totals = this.lineTotals();
    return totals.some((total) => total === null)
      ? null
      : totals.reduce<number>((sum, total) => sum + (total as number), 0);
  });

  public ngOnInit(): void {
    this.load();
    this.lines.valueChanges.subscribe(() => this.formTick.update((tick) => tick + 1));
  }

  protected canSeeCosts(): boolean {
    return this.auth.canReadInventoryCosts();
  }

  protected statusLabel(status: number): string {
    return statusLabels[status] ?? 'Unknown';
  }

  protected statusVariant(status: number): BadgeVariant {
    return statusVariants[status] ?? 'default';
  }

  protected statusBar(status: number): string {
    return statusBars[status] ?? 'bg-gray-300';
  }

  protected pickSupplier(id: string | null): void {
    this.header.controls.supplierId.setValue(id ?? '');
    this.header.controls.supplierId.markAsTouched();
    this.chooseSupplier();
  }

  protected pickItem(index: number, id: string | null): void {
    const control = this.lines.at(index).controls.itemId;
    control.setValue(id ?? '');
    control.markAsTouched();
    this.chooseItem(index);
  }

  protected setFilter(status: number | null): void {
    this.statusFilter.set(status);
    this.load();
  }

  protected openForm(): void {
    this.editingId.set(null);
    this.resetForm();
    this.isFormOpen.set(true);
    this.loadChoices();
  }

  protected editOrder(order: PurchaseOrderDto): void {
    this.resetForm();
    this.editingId.set(order.summary.id);
    this.isFormOpen.set(true);
    this.loadChoices();
    this.header.patchValue({
      supplierId: order.summary.supplierId,
      expectedOn: order.summary.expectedOn ?? '',
      note: order.summary.note ?? '',
    });
    this.loadSupplierItems(order.summary.supplierId);
    this.lines.clear();
    for (const line of order.lines) {
      const group = newLine();
      group.patchValue({
        itemId: line.itemId,
        packName: line.packName ?? '',
        packs: line.packsOrdered,
        unitsPerPack: line.unitsPerPack,
        packPrice: line.packPrice,
      });
      this.lines.push(group);
    }
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
    this.editingId.set(null);
    this.resetForm();
  }

  protected chooseSupplier(): void {
    this.loadSupplierItems(this.header.controls.supplierId.value);
  }

  protected addLine(): void {
    this.lines.push(newLine());
  }

  protected removeLine(index: number): void {
    if (this.lines.length > 1) {
      this.lines.removeAt(index);
    }
  }

  protected chooseItem(index: number): void {
    const line = this.lines.at(index);
    const link = this.supplierItems().find((item) => item.itemId === line.controls.itemId.value);
    if (!link) {
      return;
    }

    line.patchValue({
      packName: link.packName ?? '',
      unitsPerPack: link.unitsPerPack,
      packPrice: this.canSeeCosts() ? link.packPrice : null,
    });
  }

  protected unitName(itemId: string): string {
    return this.items().find((item) => item.id === itemId)?.unitName ?? '';
  }

  protected unitsOrdered(index: number): number {
    this.formTick();
    const value = this.lines.at(index).getRawValue();
    return unitsFromPacks(value.packs ?? 0, value.unitsPerPack ?? 0);
  }

  protected unitCostOf(index: number): number | null {
    this.formTick();
    const value = this.lines.at(index).getRawValue();
    return packUnitCost(value.packPrice, value.unitsPerPack ?? 0);
  }

  protected toggleOrder(order: PurchaseOrderSummaryDto): void {
    if (this.expandedId() === order.id) {
      this.expandedId.set(null);
      this.expanded.set(null);
      return;
    }

    this.expandedId.set(order.id);
    this.expanded.set(null);
    this.ordersApi.getOrder(order.id).subscribe({
      next: (detail) => this.expanded.set(detail),
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected load(): void {
    this.connectionFailed.set(false);
    this.isLoading.set(true);
    this.ordersApi.getOrders({ status: this.statusFilter() }).subscribe({
      next: (orders) => {
        this.orders.set(orders);
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

  protected save(): void {
    this.header.markAllAsTouched();
    this.lines.markAllAsTouched();
    if (this.header.invalid || this.lines.invalid || this.isSaving()) {
      return;
    }

    const head = this.header.getRawValue();
    const fields = {
      supplierId: head.supplierId,
      expectedOn: head.expectedOn || null,
      note: head.note.trim() || null,
      lines: this.lines.controls.map((line) => {
        const value = line.getRawValue();
        return {
          itemId: value.itemId,
          packs: value.packs ?? 0,
          unitsPerPack: value.unitsPerPack ?? 1,
          packPrice: value.packPrice,
          packName: value.packName.trim() || null,
        };
      }),
    };
    const editing = this.editingId();
    const request = editing
      ? this.ordersApi.updateOrder(editing, fields)
      : this.ordersApi.createOrder(fields);

    this.isSaving.set(true);
    request.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.alertService.success(editing ? 'Purchase order updated.' : 'Draft purchase order saved.');
        this.closeForm();
        this.expandedId.set(null);
        this.load();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected askConfirm(action: OrderAction, order: PurchaseOrderDto): void {
    this.pendingAction.set({ action, order });
  }

  protected confirmHeading(): string {
    const pending = this.pendingAction();
    const number = pending ? `PO-${pending.order.summary.poNumber}` : '';
    switch (pending?.action) {
      case 'send':
        return `Mark ${number} as sent?`;
      case 'cancel':
        return `Cancel ${number}?`;
      default:
        return `Close ${number}?`;
    }
  }

  protected confirmLabel(): string {
    switch (this.pendingAction()?.action) {
      case 'send':
        return 'Mark as sent';
      case 'cancel':
        return 'Cancel order';
      default:
        return 'Close order';
    }
  }

  protected confirmText(): string {
    switch (this.pendingAction()?.action) {
      case 'send':
        return 'The order can no longer be edited, and its items count as on order in the reorder list.';
      case 'cancel':
        return 'Nothing has been received yet. The order will stop counting as on order.';
      default:
        return 'The items that have not arrived will stop counting as on order. This cannot be undone.';
    }
  }

  protected runPending(): void {
    const pending = this.pendingAction();
    if (!pending || this.isActing()) {
      return;
    }

    const id = pending.order.summary.id;
    const request =
      pending.action === 'send'
        ? this.ordersApi.sendOrder(id)
        : pending.action === 'cancel'
          ? this.ordersApi.cancelOrder(id)
          : this.ordersApi.closeOrder(id);
    const message =
      pending.action === 'send'
        ? 'Purchase order marked as sent.'
        : pending.action === 'cancel'
          ? 'Purchase order cancelled.'
          : 'Purchase order closed.';

    this.isActing.set(true);
    request.subscribe({
      next: (order) => {
        this.isActing.set(false);
        this.pendingAction.set(null);
        this.alertService.success(message);
        this.expanded.set(order);
        this.load();
      },
      error: (err: Error) => {
        this.isActing.set(false);
        this.pendingAction.set(null);
        this.alertService.error(err.message);
      },
    });
  }

  private loadChoices(): void {
    if (this.suppliers().length === 0) {
      this.suppliersApi.getSuppliers().subscribe({
        next: (suppliers) => this.suppliers.set(suppliers),
        error: (err: Error) => this.alertService.error(err.message),
      });
    }

    if (this.items().length === 0) {
      this.inventory.getInventoryItems({ isActive: true }).subscribe({
        next: (items) => this.items.set(items),
        error: (err: Error) => this.alertService.error(err.message),
      });
    }
  }

  private loadSupplierItems(supplierId: string): void {
    this.supplierItems.set([]);
    if (!supplierId) {
      return;
    }

    this.suppliersApi.getSupplier(supplierId).subscribe({
      next: (supplier) => this.supplierItems.set(supplier.items),
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  private resetForm(): void {
    this.header.reset({ supplierId: '', expectedOn: '', note: '' });
    this.lines.clear();
    this.lines.push(newLine());
    this.supplierItems.set([]);
  }
}
