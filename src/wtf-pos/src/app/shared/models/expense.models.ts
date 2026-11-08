export interface ExpenseDto {
  id: string;
  expenseDate: string;
  category: number;
  categoryName: string;
  amount: number;
  note?: string | null;
  isActive: boolean;
  createdAt: string;
  createdByName?: string | null;
}

export interface ExpenseCategoryTotalDto {
  category: number;
  categoryName: string;
  count: number;
  amount: number;
}

export interface ExpenseListDto {
  items: ExpenseDto[];
  total: number;
  byCategory: ExpenseCategoryTotalDto[];
}

export interface ExpenseCategoryDto {
  id: number;
  name: string;
  needsNote: boolean;
}

export interface SaveExpenseDto {
  expenseDate: string;
  category: number;
  amount: number;
  note?: string | null;
}

export interface ExpenseListQuery {
  fromDate?: string;
  toDate?: string;
  category?: number | null;
  includeDeleted?: boolean;
}
