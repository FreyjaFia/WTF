import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertService, AuthService, InventoryService } from '@core/services';
import { ItemBranchStockDto, ItemDto } from '@shared/models';

type RowGroup = FormGroup<{
  branchId: FormControl<string>;
  warningQuantity: FormControl<number | null>;
  criticalQuantity: FormControl<number | null>;
  parLevel: FormControl<number | null>;
  costPrice: FormControl<number | null>;
}>;

@Component({
  selector: 'app-item-branch-settings',
  imports: [ReactiveFormsModule],
  templateUrl: './item-branch-settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemBranchSettingsComponent {
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly alertService = inject(AlertService);

  public readonly item = input.required<ItemDto>();
  public readonly saved = output<ItemBranchStockDto[]>();

  protected readonly rows = new FormArray<RowGroup>([]);
  protected readonly isSaving = signal(false);
  protected readonly branches = signal<ItemBranchStockDto[]>([]);
  protected readonly canEdit = computed(() => this.authService.canWriteItems());
  protected readonly canSeeCosts = computed(() => this.authService.canReadInventoryCosts());

  public constructor() {
    effect(() => {
      const id = this.item().id;
      this.inventoryService.getItemBranchSettings(id).subscribe({
        next: (stocks) => {
          this.branches.set(stocks);
          this.fill(stocks);
        },
        error: (err) => this.alertService.error(err.message),
      });
    });
  }

  protected shopLevel(value: number | null | undefined): string {
    return value === null || value === undefined ? 'Not set' : String(value);
  }

  protected shopCost(): string {
    const item = this.item();
    const cost = item.averageCost ?? item.costPrice;
    return cost === null || cost === undefined ? 'Not set' : String(cost);
  }

  protected isChanged(): boolean {
    return this.rows.dirty;
  }

  protected reset(): void {
    this.fill(this.branches());
  }

  protected save(): void {
    if (this.rows.invalid || this.isSaving()) {
      this.rows.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    const payload = this.rows.getRawValue().map((row) => ({
      branchId: row.branchId,
      warningQuantity: row.warningQuantity,
      criticalQuantity: row.criticalQuantity,
      parLevel: row.parLevel,
      costPrice: row.costPrice,
    }));

    this.inventoryService.saveItemBranchSettings(this.item().id, payload).subscribe({
      next: (stocks) => {
        this.isSaving.set(false);
        this.rows.markAsPristine();
        this.branches.set(stocks);
        this.alertService.success('Branch settings saved.');
        this.saved.emit(stocks);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  private fill(branches: ItemBranchStockDto[]): void {
    this.rows.clear();
    for (const branch of branches) {
      this.rows.push(
        new FormGroup({
          branchId: new FormControl(branch.branchId, { nonNullable: true }),
          warningQuantity: new FormControl(branch.warningQuantity ?? null, [Validators.min(0)]),
          criticalQuantity: new FormControl(branch.criticalQuantity ?? null, [Validators.min(0)]),
          parLevel: new FormControl(branch.parLevel ?? null, [Validators.min(0)]),
          costPrice: new FormControl(branch.costPrice ?? null, [Validators.min(0)]),
        }),
      );
    }

    this.rows.markAsPristine();
  }
}
