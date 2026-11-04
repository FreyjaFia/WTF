import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { AlertService, AuthService, ExpenseService, ModalStackService } from '@core/services';
import { BadgeComponent, IconComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { PullToRefreshComponent } from '@shared/components/pull-to-refresh/pull-to-refresh';
import { ExpenseCategoryDto, ExpenseDto, ExpenseListDto, SaveExpenseDto } from '@shared/models';
import { Subscription } from 'rxjs';

type ExpenseDialog = 'edit' | 'delete' | 'restore';

const NOTE_MAX_LENGTH = 200;

function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

@Component({
  selector: 'app-expenses',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    BadgeComponent,
    ConfirmDialogComponent,
    IconComponent,
    PullToRefreshComponent,
  ],
  templateUrl: './expenses.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ExpensesComponent implements OnInit, OnDestroy {
  private readonly expenseService = inject(ExpenseService);
  private readonly authService = inject(AuthService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);

  protected readonly isAndroid = Capacitor.getPlatform() === 'android';
  protected readonly noteMaxLength = NOTE_MAX_LENGTH;
  protected readonly canWrite = computed(() => this.authService.canWriteExpenses());
  protected readonly categories = signal<ExpenseCategoryDto[]>([]);
  protected readonly result = signal<ExpenseListDto>({ items: [], total: 0, byCategory: [] });
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly dialog = signal<ExpenseDialog | null>(null);
  protected readonly selected = signal<ExpenseDto | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly filterError = signal<string | null>(null);
  protected readonly formCategoryId = signal(1);
  protected readonly formNeedsNote = computed(
    () => this.categories().find((c) => c.id === this.formCategoryId())?.needsNote ?? false,
  );
  protected readonly filter = new FormGroup({
    fromDate: new FormControl('', { nonNullable: true }),
    toDate: new FormControl('', { nonNullable: true }),
    category: new FormControl(0, { nonNullable: true }),
    includeDeleted: new FormControl(false, { nonNullable: true }),
  });
  protected readonly form = new FormGroup({
    expenseDate: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    category: new FormControl(1, { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0.01),
      Validators.max(100_000_000),
    ]),
    note: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(NOTE_MAX_LENGTH)],
    }),
  });

  private modalStackId: number | null = null;
  private loadSubscription: Subscription | null = null;

  public ngOnInit(): void {
    const today = new Date();
    this.filter.patchValue({
      fromDate: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
      toDate: toDateInput(today),
    });
    this.form.controls.category.valueChanges.subscribe((id) =>
      this.formCategoryId.set(Number(id)),
    );
    this.expenseService.getCategories().subscribe({
      next: (categories) => this.categories.set(categories),
      error: (err: Error) => this.alertService.error(err.message),
    });
    this.load();
  }

  public ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
    this.removeFromStack();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected applyFilter(): void {
    this.load();
  }

  protected openAdd(): void {
    this.selected.set(null);
    this.form.reset({
      expenseDate: toDateInput(new Date()),
      category: this.categories()[0]?.id ?? 1,
      amount: null,
      note: '',
    });
    this.formCategoryId.set(this.form.controls.category.value);
    this.openDialog('edit');
  }

  protected openEdit(expense: ExpenseDto): void {
    this.selected.set(expense);
    this.form.reset({
      expenseDate: expense.expenseDate,
      category: expense.category,
      amount: expense.amount,
      note: expense.note ?? '',
    });
    this.formCategoryId.set(expense.category);
    this.openDialog('edit');
  }

  protected openDelete(expense: ExpenseDto): void {
    this.selected.set(expense);
    this.openDialog('delete');
  }

  protected openRestore(expense: ExpenseDto): void {
    this.selected.set(expense);
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

  protected saveExpense(): void {
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    const note = raw.note.trim();
    const category = this.categories().find((c) => c.id === Number(raw.category));
    if (this.form.invalid || raw.amount === null) {
      this.formError.set(
        `Enter a date and an amount above 0, with a note of up to ${NOTE_MAX_LENGTH} characters.`,
      );
      return;
    }

    if (category?.needsNote && note.length === 0) {
      this.formError.set(`A note is required for ${category.name}.`);
      return;
    }

    const dto: SaveExpenseDto = {
      expenseDate: raw.expenseDate,
      category: Number(raw.category),
      amount: Number(raw.amount),
      note: note.length > 0 ? note : null,
    };
    const current = this.selected();
    const request = current
      ? this.expenseService.updateExpense(current.id, dto)
      : this.expenseService.createExpense(dto);

    this.isSaving.set(true);
    this.formError.set(null);
    request.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.alertService.success(current ? 'Expense saved.' : 'Expense added.');
        this.closeDialog();
        this.load();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.formError.set(err.message);
      },
    });
  }

  protected confirmDelete(): void {
    const expense = this.selected();
    if (!expense) {
      return;
    }

    this.isSaving.set(true);
    this.expenseService.deleteExpense(expense.id).subscribe({
      next: () => this.finishChange('Expense deleted.'),
      error: (err: Error) => this.failChange(err),
    });
  }

  protected confirmRestore(): void {
    const expense = this.selected();
    if (!expense) {
      return;
    }

    this.isSaving.set(true);
    this.expenseService.restoreExpense(expense.id).subscribe({
      next: () => this.finishChange('Expense restored.'),
      error: (err: Error) => this.failChange(err),
    });
  }

  private finishChange(message: string): void {
    this.isSaving.set(false);
    this.alertService.success(message);
    this.closeDialog();
    this.load();
  }

  private failChange(err: Error): void {
    this.isSaving.set(false);
    this.alertService.error(err.message);
  }

  private openDialog(kind: ExpenseDialog): void {
    this.formError.set(null);
    this.dialog.set(kind);
    this.removeFromStack();
    this.modalStackId = this.modalStack.push(() => this.closeDialog());
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  private load(): void {
    const { fromDate, toDate, category, includeDeleted } = this.filter.getRawValue();
    if (fromDate && toDate && fromDate > toDate) {
      this.filterError.set('The start date must not be after the end date.');
      this.isRefreshing.set(false);
      return;
    }

    this.filterError.set(null);
    this.isLoading.set(!this.isRefreshing());
    this.loadSubscription?.unsubscribe();
    this.loadSubscription = this.expenseService
      .getExpenses({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        category: Number(category) || null,
        includeDeleted,
      })
      .subscribe({
        next: (result) => {
          this.result.set(result);
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
