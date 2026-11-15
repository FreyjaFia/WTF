import { DatePipe, DecimalPipe } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorMessages } from '@core/messages';
import {
  AlertService,
  AuthService,
  ListStateService,
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
  SideDrawerComponent,
} from '@shared/components';
import { BadgeComponent } from '@shared/components/badge/badge';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { SelectDropdownComponent } from '@shared/components/select-dropdown/select-dropdown';
import { AppRoutes } from '@shared/constants/app-routes';
import { packUnitCost, receiptLineTotal, unitsFromPacks } from '@shared/calculations';
import {
  ItemDto,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  PurchaseOrderSummaryDto,
  SupplierItemDto,
  SupplierSummaryDto,
} from '@shared/models';
import { debounceTime, Subscription } from 'rxjs';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, isPageSizeOption } from '@shared/calculations/pagination';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';

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
type OrderSortColumn = 'order' | 'expected' | 'status' | 'total';

@Component({
  selector: 'app-purchase-orders',
  imports: [PaginationComponent, 
    BadgeComponent,
    ConfirmDialogComponent,
    ConnectionErrorComponent,
    DatePipe,
    DecimalPipe,
    FilterButtonComponent,
    IconComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    SearchInputComponent,
    SelectDropdownComponent,
    SideDrawerComponent,
    SortHeaderComponent,
  ],
  templateUrl: './purchase-orders.html',
  host: { class: 'flex-1 min-h-0' },
})
export class PurchaseOrdersComponent implements OnInit {
  private readonly ordersApi = inject(PurchaseOrderService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly inventory = inject(InventoryService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly statuses = PurchaseOrderStatus;
  protected readonly searchControl = new FormControl<string | null>('');
  protected readonly pendingAction = signal<{
    action: OrderAction;
    order: PurchaseOrderDto;
  } | null>(null);
  protected readonly isActing = signal(false);
  protected readonly statusFilter = signal<number | null>(null);
  protected readonly isFiltersOpen = signal(false);
  protected readonly activeFilterCount = computed(() => (this.statusFilter() === null ? 0 : 1));
  protected readonly orders = signal<PurchaseOrderSummaryDto[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly page = signal(readPageParam(inject(ActivatedRoute)));
  protected readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly isReloading = signal(false);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly listState = inject(ListStateService);
  private loadRequest: Subscription | null = null;
  protected readonly suppliers = signal<SupplierSummaryDto[]>([]);
  protected readonly items = signal<ItemDto[]>([]);
  protected readonly sortColumn = signal<OrderSortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');
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
    const saved = this.listState.load<{ pageSize?: number }>('inventory:purchase-orders', {});
    this.pageSize.set(isPageSizeOption(saved.pageSize) ? (saved.pageSize as number) : DEFAULT_PAGE_SIZE);
    this.searchControl.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reloadFromFirstPage());
    this.load();
    this.lines.valueChanges.subscribe(() => this.formTick.update((tick) => tick + 1));
  }

  protected toggleSort(column: OrderSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }

    this.reloadFromFirstPage();
  }

  protected openSuggestedOrders(): void {
    this.router.navigateByUrl(AppRoutes.InventorySuggestedOrders);
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

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected setFilter(status: number | null): void {
    this.statusFilter.set(status);
    this.reloadFromFirstPage();
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
    this.loadSupplierItems(this.header.controls.supplierId.value, true);
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
    const firstLoad = this.orders().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.connectionFailed.set(false);
    this.loadRequest?.unsubscribe();

    this.loadRequest = this.ordersApi
      .getOrdersPaged({
        status: this.statusFilter(),
        search: this.searchControl.value?.trim() || null,
        sortBy: this.sortColumn(),
        sortDirection: this.sortColumn() ? this.sortDirection() : null,
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.orders.set([...result.items]);
          this.totalCount.set(result.totalCount);
          if (result.page !== this.page()) {
            this.page.set(result.page);
            writePageParam(this.router, this.activatedRoute, result.page);
          }
          this.isLoading.set(false);
          this.isReloading.set(false);
          this.isRefreshing.set(false);
        },
        error: (err: Error) => {
          this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
          this.isLoading.set(false);
          this.isReloading.set(false);
          this.isRefreshing.set(false);
          this.alertService.error(err.message);
        },
      });
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    writePageParam(this.router, this.activatedRoute, page);
    this.load();
  }

  protected changePageSize(size: number): void {
    this.pageSize.set(size);
    this.listState.save('inventory:purchase-orders', { pageSize: size });
    this.reloadFromFirstPage();
  }

  protected reloadFromFirstPage(): void {
    this.page.set(1);
    writePageParam(this.router, this.activatedRoute, 1);
    this.load();
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
        this.alertService.success(
          editing ? 'Purchase order updated.' : 'Draft purchase order saved.',
        );
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

  private loadSupplierItems(supplierId: string, fillChosenLines = false): void {
    this.supplierItems.set([]);
    if (!supplierId) {
      return;
    }

    this.suppliersApi.getSupplier(supplierId).subscribe({
      next: (supplier) => {
        this.supplierItems.set(supplier.items);
        // An item picked before the supplier's pack details arrived has no pack details yet: fill them in now.
        if (fillChosenLines) {
          this.lines.controls.forEach((line, index) => {
            if (line.controls.itemId.value && !line.controls.unitsPerPack.dirty) {
              this.chooseItem(index);
            }
          });
        }
      },
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
