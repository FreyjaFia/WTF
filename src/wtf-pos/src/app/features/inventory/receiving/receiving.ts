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
  StockReceiptService,
  SupplierService,
} from '@core/services';
import {
  ConnectionErrorComponent,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
} from '@shared/components';
import { SelectDropdownComponent } from '@shared/components/select-dropdown/select-dropdown';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import {
  invoiceDifference,
  packUnitCost,
  receiptLineTotal,
  unitsFromPacks,
} from '@shared/calculations';
import {
  ItemDto,
  PurchaseOrderSummaryDto,
  StockReceiptDto,
  StockReceiptSummaryDto,
  SupplierItemDto,
  SupplierSummaryDto,
} from '@shared/models';

type ReceiptLineGroup = FormGroup<{
  itemId: FormControl<string>;
  packName: FormControl<string>;
  packs: FormControl<number | null>;
  unitsPerPack: FormControl<number | null>;
  packPrice: FormControl<number | null>;
}>;

function newLine(): ReceiptLineGroup {
  return new FormGroup({
    itemId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    packName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(50)] }),
    packs: new FormControl<number | null>(null, [Validators.required, Validators.min(0.001)]),
    unitsPerPack: new FormControl<number | null>(1, [Validators.required, Validators.min(0.001)]),
    packPrice: new FormControl<number | null>(null, [Validators.min(0)]),
  });
}

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

type ReceiptSortColumn = 'receipt' | 'received' | 'items' | 'total';

@Component({
  selector: 'app-receiving',
  imports: [
    ConnectionErrorComponent,
    DatePipe,
    DecimalPipe,
    IconComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    SearchInputComponent,
    SelectDropdownComponent,
    SortHeaderComponent,
  ],
  templateUrl: './receiving.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ReceivingComponent implements OnInit {
  private readonly receiptsApi = inject(StockReceiptService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly inventory = inject(InventoryService);
  private readonly ordersApi = inject(PurchaseOrderService);
  private readonly alertService = inject(AlertService);
  protected readonly auth = inject(AuthService);

  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly search = signal('');
  protected readonly receipts = signal<StockReceiptSummaryDto[]>([]);
  protected readonly filteredReceipts = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.receipts();
    }

    return this.receipts().filter((receipt) =>
      [
        receipt.supplierName,
        receipt.invoiceNumber,
        receipt.purchaseOrderNumber ? `po-${receipt.purchaseOrderNumber}` : null,
        receipt.createdByName,
        receipt.note,
      ].some((field) => field?.toLowerCase().includes(term)),
    );
  });
  protected readonly sortColumn = signal<ReceiptSortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly sortedReceipts = computed(() => {
    const column = this.sortColumn();
    const receipts = [...this.filteredReceipts()];
    if (!column) {
      return receipts;
    }

    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: StockReceiptSummaryDto, b: StockReceiptSummaryDto): number => {
      switch (column) {
        case 'receipt':
          return a.supplierName.localeCompare(b.supplierName, undefined, { sensitivity: 'base' });
        case 'received':
          return a.receivedOn.localeCompare(b.receivedOn) || a.createdAt.localeCompare(b.createdAt);
        case 'items':
          return a.lineCount - b.lineCount;
        case 'total':
          return (a.linesTotal ?? -1) - (b.linesTotal ?? -1);
      }
    };

    return receipts.sort((a, b) => compare(a, b) * direction);
  });
  protected readonly supplierOptions = computed(() =>
    this.suppliers().map((supplier) => ({ id: supplier.id, label: supplier.name })),
  );
  protected readonly itemOptions = computed(() =>
    this.items().map((item) => ({ id: item.id, label: item.name })),
  );
  protected readonly orderOptions = computed(() =>
    this.openOrders().map((order) => ({ id: order.id, label: `PO-${order.poNumber}` })),
  );
  protected readonly suppliers = signal<SupplierSummaryDto[]>([]);
  protected readonly items = signal<ItemDto[]>([]);
  protected readonly supplierItems = signal<SupplierItemDto[]>([]);
  protected readonly openOrders = signal<PurchaseOrderSummaryDto[]>([]);
  protected readonly purchaseOrderId = signal<string>('');
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isFormOpen = signal(false);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly expanded = signal<StockReceiptDto | null>(null);
  protected readonly formTick = signal(0);
  protected readonly header = new FormGroup({
    supplierId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    receivedOn: new FormControl(localToday(), { nonNullable: true, validators: [Validators.required] }),
    invoiceNumber: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(50)] }),
    invoiceTotal: new FormControl<number | null>(null, [Validators.min(0)]),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });
  protected readonly lines = new FormArray<ReceiptLineGroup>([newLine()]);
  protected readonly lineTotals = computed(() => {
    this.formTick();
    return this.lines.controls.map((line) => {
      const value = line.getRawValue();
      return receiptLineTotal(value.packs ?? 0, value.packPrice);
    });
  });
  protected readonly linesTotal = computed(() => {
    const totals = this.lineTotals();
    return totals.some((total) => total === null)
      ? null
      : totals.reduce<number>((sum, total) => sum + (total as number), 0);
  });
  protected readonly difference = computed(() => {
    this.formTick();
    return invoiceDifference(this.header.controls.invoiceTotal.value, this.lineTotals());
  });
  private pendingRequestId = crypto.randomUUID();

  public ngOnInit(): void {
    this.load();
    this.lines.valueChanges.subscribe(() => this.formTick.update((tick) => tick + 1));
    this.header.controls.invoiceTotal.valueChanges.subscribe(() => this.formTick.update((tick) => tick + 1));
  }

  protected canSeeCosts(): boolean {
    return this.auth.canReadInventoryCosts();
  }

  protected openForm(): void {
    this.isFormOpen.set(true);
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

  protected closeForm(): void {
    this.isFormOpen.set(false);
    this.resetForm();
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

  protected chooseSupplier(): void {
    const supplierId = this.header.controls.supplierId.value;
    this.supplierItems.set([]);
    this.openOrders.set([]);
    this.purchaseOrderId.set('');
    if (!supplierId) {
      return;
    }

    this.ordersApi.getOrders({ supplierId, openOnly: true }).subscribe({
      next: (orders) => this.openOrders.set(orders),
      error: (err: Error) => this.alertService.error(err.message),
    });

    this.suppliersApi.getSupplier(supplierId).subscribe({
      next: (supplier) => this.supplierItems.set(supplier.items),
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  protected chooseOrder(orderId: string): void {
    this.purchaseOrderId.set(orderId);
    if (!orderId) {
      return;
    }

    this.ordersApi.getOrder(orderId).subscribe({
      next: (order) => {
        this.lines.clear();
        for (const line of order.lines) {
          const remaining = line.packsOrdered - line.packsReceived;
          if (remaining <= 0) {
            continue;
          }

          const group = newLine();
          group.patchValue({
            itemId: line.itemId,
            packName: line.packName ?? '',
            packs: remaining,
            unitsPerPack: line.unitsPerPack,
            packPrice: this.canSeeCosts() ? line.packPrice : null,
          });
          this.lines.push(group);
        }

        if (this.lines.length === 0) {
          this.lines.push(newLine());
        }
      },
      error: (err: Error) => this.alertService.error(err.message),
    });
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

  protected unitsAdded(index: number): number {
    this.formTick();
    const value = this.lines.at(index).getRawValue();
    return unitsFromPacks(value.packs ?? 0, value.unitsPerPack ?? 0);
  }

  protected unitCostOf(index: number): number | null {
    this.formTick();
    const value = this.lines.at(index).getRawValue();
    return packUnitCost(value.packPrice, value.unitsPerPack ?? 0);
  }

  protected toggleSort(column: ReceiptSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  protected toggleReceipt(receipt: StockReceiptSummaryDto): void {
    if (this.expandedId() === receipt.id) {
      this.expandedId.set(null);
      this.expanded.set(null);
      return;
    }

    this.expandedId.set(receipt.id);
    this.expanded.set(null);
    this.receiptsApi.getReceipt(receipt.id).subscribe({
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
    this.receiptsApi.getReceipts().subscribe({
      next: (receipts) => {
        this.receipts.set(receipts);
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
    this.isSaving.set(true);
    this.receiptsApi
      .recordReceipt({
        supplierId: head.supplierId,
        receivedOn: head.receivedOn,
        invoiceNumber: head.invoiceNumber.trim() || null,
        invoiceTotal: head.invoiceTotal,
        note: head.note.trim() || null,
        clientRequestId: this.pendingRequestId,
        purchaseOrderId: this.purchaseOrderId() || null,
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
      })
      .subscribe({
        next: (receipt) => {
          this.isSaving.set(false);
          this.alertService.success(
            receipt.summary.difference
              ? 'Receipt recorded. The lines do not match the invoice total.'
              : 'Receipt recorded.',
          );
          this.closeForm();
          this.load();
        },
        error: (err: Error) => {
          this.isSaving.set(false);
          this.alertService.error(err.message);
        },
      });
  }

  private resetForm(): void {
    this.header.reset({
      supplierId: '',
      receivedOn: localToday(),
      invoiceNumber: '',
      invoiceTotal: null,
      note: '',
    });
    this.lines.clear();
    this.lines.push(newLine());
    this.supplierItems.set([]);
    this.openOrders.set([]);
    this.purchaseOrderId.set('');
    this.pendingRequestId = crypto.randomUUID();
  }
}
