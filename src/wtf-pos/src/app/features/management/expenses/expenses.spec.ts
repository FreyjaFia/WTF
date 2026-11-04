import { TestBed } from '@angular/core/testing';
import { AlertService, AuthService, ExpenseService, ModalStackService } from '@core/services';
import { ExpenseDto, ExpenseListDto } from '@shared/models';
import { fakeAlert, internals } from '@app/testing/management-spec-helpers';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpensesComponent } from './expenses';

function expense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'e1',
    expenseDate: '2026-03-10',
    category: 1,
    categoryName: 'Rent',
    amount: 12000,
    note: 'March rent',
    isActive: true,
    createdAt: '2026-03-10T01:00:00Z',
    createdByName: 'Admin',
    ...overrides,
  };
}

const CATEGORIES = [
  { id: 1, name: 'Rent', needsNote: false },
  { id: 3, name: 'Utilities', needsNote: false },
  { id: 8, name: 'Other', needsNote: true },
];

const LIST: ExpenseListDto = {
  items: [
    expense(),
    expense({ id: 'e2', categoryName: 'Utilities', category: 3, amount: 800.5, note: null }),
    expense({ id: 'e3', isActive: false, amount: 50 }),
  ],
  total: 12800.5,
  byCategory: [
    { category: 1, categoryName: 'Rent', count: 1, amount: 12000 },
    { category: 3, categoryName: 'Utilities', count: 1, amount: 800.5 },
  ],
};

describe('ExpensesComponent', () => {
  let service: {
    getExpenses: ReturnType<typeof vi.fn>;
    getCategories: ReturnType<typeof vi.fn>;
    createExpense: ReturnType<typeof vi.fn>;
    updateExpense: ReturnType<typeof vi.fn>;
    deleteExpense: ReturnType<typeof vi.fn>;
    restoreExpense: ReturnType<typeof vi.fn>;
  };
  let alerts: ReturnType<typeof fakeAlert>;
  let modalStack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let canWrite: boolean;

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: ExpenseService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: modalStack },
        { provide: AuthService, useValue: { canWriteExpenses: () => canWrite } },
      ],
    });
    const fixture = TestBed.createComponent(ExpensesComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function buttons(fixture: { nativeElement: HTMLElement }, label: string): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button')).filter(
      (b) => (b as HTMLButtonElement).textContent?.trim() === label,
    ) as HTMLButtonElement[];
  }

  beforeEach(() => {
    canWrite = true;
    service = {
      getExpenses: vi.fn(() => of(LIST)),
      getCategories: vi.fn(() => of(CATEGORIES)),
      createExpense: vi.fn(() => of(expense())),
      updateExpense: vi.fn(() => of(expense())),
      deleteExpense: vi.fn(() => of(expense())),
      restoreExpense: vi.fn(() => of(expense())),
    };
    alerts = fakeAlert();
    modalStack = { push: vi.fn(() => 7), remove: vi.fn() };
  });

  it('loads this month by default, without deleted expenses', () => {
    create();
    const query = service.getExpenses.mock.calls[0][0];
    expect(query.fromDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(query.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.category).toBeNull();
    expect(query.includeDeleted).toBe(false);
  });

  it('shows the total, the totals by category and every expense', () => {
    const fixture = create();
    expect(text(fixture)).toContain('₱12,800.50');
    expect(text(fixture)).toContain('₱800.50');
    expect(text(fixture)).toContain('March rent');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="expense-row"]')).toHaveLength(3);
    expect(text(fixture)).toContain('Deleted');
  });

  it('offers Edit and Delete for active expenses and Restore for deleted ones', () => {
    const fixture = create();
    expect(buttons(fixture, 'Edit')).toHaveLength(2);
    expect(buttons(fixture, 'Delete')).toHaveLength(2);
    expect(buttons(fixture, 'Restore')).toHaveLength(1);
    expect(buttons(fixture, 'Add Expense')).toHaveLength(1);
  });

  it('is read only without the right to write', () => {
    canWrite = false;
    const fixture = create();
    expect(buttons(fixture, 'Edit')).toHaveLength(0);
    expect(buttons(fixture, 'Delete')).toHaveLength(0);
    expect(buttons(fixture, 'Restore')).toHaveLength(0);
    expect(buttons(fixture, 'Add Expense')).toHaveLength(0);
    expect(text(fixture)).toContain('March rent');
  });

  it('shows the empty state', () => {
    service.getExpenses.mockReturnValue(of({ items: [], total: 0, byCategory: [] }));
    const fixture = create();
    expect(text(fixture)).toContain('No expenses found');
  });

  it('shows a spinner while loading and alerts when loading fails', () => {
    const pending = new Subject<ExpenseListDto>();
    service.getExpenses.mockReturnValue(pending);
    const fixture = create();
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).not.toBeNull();
    pending.error(new Error('load failed'));
    fixture.detectChanges();
    expect(alerts.error).toHaveBeenCalledWith('load failed');
    expect(internals(fixture.componentInstance).isLoading()).toBe(false);
  });

  it('reloads with the chosen filters', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.filter.patchValue({ fromDate: '2026-01-01', toDate: '2026-01-31', category: 3, includeDeleted: true });
    c.applyFilter();
    expect(service.getExpenses).toHaveBeenLastCalledWith({
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
      category: 3,
      includeDeleted: true,
    });
  });

  it('ignores a slow answer for an earlier filter when a newer one has been asked', () => {
    const slow = new Subject<ExpenseListDto>();
    const fast = new Subject<ExpenseListDto>();
    service.getExpenses.mockReturnValueOnce(slow).mockReturnValueOnce(fast);
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.applyFilter();

    fast.next({ ...LIST, total: 5, items: [] });
    slow.next({ ...LIST, total: 999, items: [] });

    expect(c.result().total).toBe(5);
  });

  it('refuses a start date after the end date without calling the server', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    service.getExpenses.mockClear();
    c.filter.patchValue({ fromDate: '2026-02-01', toDate: '2026-01-01' });
    c.applyFilter();
    fixture.detectChanges();
    expect(service.getExpenses).not.toHaveBeenCalled();
    expect(c.filterError()).toBe('The start date must not be after the end date.');
    expect(text(fixture)).toContain('The start date must not be after the end date.');
  });

  it('opens Add with today and the first category', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    fixture.detectChanges();
    expect(c.dialog()).toBe('edit');
    expect(c.selected()).toBeNull();
    expect(c.form.getRawValue()).toMatchObject({ category: 1, amount: null, note: '' });
    expect(c.form.controls.expenseDate.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(modalStack.push).toHaveBeenCalled();
    expect(text(fixture)).toContain('Note (optional)');
  });

  it('asks for a note when the category is Other', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.controls.category.setValue(8);
    fixture.detectChanges();
    expect(text(fixture)).toContain('Note (required)');
  });

  it('saves a new expense with a trimmed note and reloads', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.patchValue({ expenseDate: '2026-03-12', category: 3, amount: 900, note: '  Power  ' });
    service.getExpenses.mockClear();
    c.saveExpense();

    expect(service.createExpense).toHaveBeenCalledWith({
      expenseDate: '2026-03-12',
      category: 3,
      amount: 900,
      note: 'Power',
    });
    expect(alerts.success).toHaveBeenCalledWith('Expense added.');
    expect(c.dialog()).toBeNull();
    expect(service.getExpenses).toHaveBeenCalledOnce();
  });

  it('sends no note when it is blank', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.patchValue({ amount: 10, note: '   ' });
    c.saveExpense();
    expect(service.createExpense.mock.calls[0][0].note).toBeNull();
  });

  it('refuses a missing amount, a zero amount and an Other without a note', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.saveExpense();
    expect(c.formError()).toContain('amount above 0');

    c.form.patchValue({ amount: 0 });
    c.saveExpense();
    expect(c.formError()).toContain('amount above 0');

    c.form.patchValue({ category: 8, amount: 5, note: '' });
    c.saveExpense();
    expect(c.formError()).toBe('A note is required for Other.');
    expect(service.createExpense).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the server message when saving fails', () => {
    service.createExpense.mockReturnValue(throwError(() => new Error('Date too far away.')));
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.patchValue({ amount: 5 });
    c.saveExpense();
    fixture.detectChanges();

    expect(c.dialog()).toBe('edit');
    expect(c.formError()).toBe('Date too far away.');
    expect(c.isSaving()).toBe(false);
    expect(text(fixture)).toContain('Date too far away.');
  });

  it('edits an expense with its own values filled in', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openEdit(LIST.items[0]);
    expect(c.form.getRawValue()).toEqual({
      expenseDate: '2026-03-10',
      category: 1,
      amount: 12000,
      note: 'March rent',
    });

    c.form.patchValue({ amount: 12500 });
    c.saveExpense();
    expect(service.updateExpense).toHaveBeenCalledWith('e1', expect.objectContaining({ amount: 12500 }));
    expect(alerts.success).toHaveBeenCalledWith('Expense saved.');
  });

  it('deletes after confirming and reloads', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openDelete(LIST.items[0]);
    fixture.detectChanges();
    expect(text(fixture)).toContain('Delete Expense');

    service.getExpenses.mockClear();
    c.confirmDelete();
    expect(service.deleteExpense).toHaveBeenCalledWith('e1');
    expect(alerts.success).toHaveBeenCalledWith('Expense deleted.');
    expect(c.dialog()).toBeNull();
    expect(service.getExpenses).toHaveBeenCalledOnce();
  });

  it('restores after confirming', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openRestore(LIST.items[2]);
    c.confirmRestore();
    expect(service.restoreExpense).toHaveBeenCalledWith('e3');
    expect(alerts.success).toHaveBeenCalledWith('Expense restored.');
  });

  it('alerts when a delete or restore fails and keeps the dialog', () => {
    service.deleteExpense.mockReturnValue(throwError(() => new Error('nope')));
    service.restoreExpense.mockReturnValue(throwError(() => new Error('nope too')));
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openDelete(LIST.items[0]);
    c.confirmDelete();
    expect(alerts.error).toHaveBeenCalledWith('nope');
    expect(c.dialog()).toBe('delete');

    c.openRestore(LIST.items[2]);
    c.confirmRestore();
    expect(alerts.error).toHaveBeenCalledWith('nope too');
  });

  it('releases the modal stack when it closes', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.closeDialog();
    expect(modalStack.remove).toHaveBeenCalledWith(7);
  });
});
