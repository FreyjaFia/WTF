import { environment } from '@environments/environment.development';
import { ExpenseDto } from '@shared/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { ExpenseService } from './expense.service';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExpenseService', () => {
  const url = `${environment.apiUrl}/expenses`;
  const expense: ExpenseDto = {
    id: 'e1',
    expenseDate: '2026-03-10',
    category: 1,
    categoryName: 'Rent',
    amount: 12000,
    note: null,
    isActive: true,
    createdAt: '2026-03-10T01:00:00Z',
    createdByName: 'Admin',
  };
  const save = { expenseDate: '2026-03-10', category: 1, amount: 12000, note: null };

  it('lists with no filters by default', () => {
    const { service, http } = setupHttpService(ExpenseService);
    const result = capture(service.getExpenses());
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ items: [expense], total: 12000, byCategory: [] });

    expect((result.value as { total: number }).total).toBe(12000);
    http.verify();
  });

  it('sends the dates, the category and the deleted switch only when set', () => {
    const { service, http } = setupHttpService(ExpenseService);
    capture(
      service.getExpenses({
        fromDate: '2026-03-01',
        toDate: '2026-03-31',
        category: 3,
        includeDeleted: true,
      }),
    );
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('fromDate')).toBe('2026-03-01');
    expect(req.request.params.get('toDate')).toBe('2026-03-31');
    expect(req.request.params.get('category')).toBe('3');
    expect(req.request.params.get('includeDeleted')).toBe('true');
    req.flush({ items: [], total: 0, byCategory: [] });

    capture(service.getExpenses({ category: null, includeDeleted: false }));
    const plain = http.expectOne((r) => r.url === url);
    expect(plain.request.params.keys()).toEqual([]);
    plain.flush({ items: [], total: 0, byCategory: [] });
    http.verify();
  });

  it('lists the categories', () => {
    const { service, http } = setupHttpService(ExpenseService);
    const result = capture(service.getCategories());
    const req = http.expectOne(`${url}/categories`);
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 8, name: 'Other', needsNote: true }]);

    expect(result.value).toEqual([{ id: 8, name: 'Other', needsNote: true }]);
  });

  it('creates with a POST, updates with a PUT, deletes with a DELETE and restores with a POST', () => {
    const { service, http } = setupHttpService(ExpenseService);

    capture(service.createExpense(save));
    const create = http.expectOne(url);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(save);
    create.flush(expense);

    capture(service.updateExpense('e1', save));
    const update = http.expectOne(`${url}/e1`);
    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toEqual(save);
    update.flush(expense);

    capture(service.deleteExpense('e1'));
    const remove = http.expectOne(`${url}/e1`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(expense);

    capture(service.restoreExpense('e1'));
    const restore = http.expectOne(`${url}/e1/restore`);
    expect(restore.request.method).toBe('POST');
    restore.flush(expense);
    http.verify();
  });

  it('passes the server message on a refusal', () => {
    const { service, http } = setupHttpService(ExpenseService);
    const result = capture(service.updateExpense('e1', save));
    failWith(http.expectOne(`${url}/e1`), 400, { message: 'This expense was deleted.' });

    expect(result.error).toBe('This expense was deleted.');
  });

  it('falls back to its own message when the server gives none', () => {
    const { service, http } = setupHttpService(ExpenseService);
    const created = capture(service.createExpense(save));
    failWith(http.expectOne(url), 500);
    const updated = capture(service.updateExpense('e1', save));
    failWith(http.expectOne(`${url}/e1`), 500);
    const deleted = capture(service.deleteExpense('e1'));
    failWith(http.expectOne(`${url}/e1`), 500);
    const restored = capture(service.restoreExpense('e1'));
    failWith(http.expectOne(`${url}/e1/restore`), 500);
    const listed = capture(service.getExpenses());
    failWith(http.expectOne((r) => r.url === url), 500);
    const categories = capture(service.getCategories());
    failWith(http.expectOne(`${url}/categories`), 500);

    expect(created.error).toBe('Unable to add the expense.');
    expect(updated.error).toBe('Unable to save the expense.');
    expect(deleted.error).toBe('Unable to delete the expense.');
    expect(restored.error).toBe('Unable to restore the expense.');
    expect(listed.error).toBe('Unable to fetch the expenses.');
    expect(categories.error).toBe('Unable to fetch the expense categories.');
  });

  it('reports a network failure and asks for a connection check', () => {
    const { service, http, connectivity } = setupHttpService(ExpenseService);
    const result = capture(service.getExpenses());
    failNetwork(http.expectOne((r) => r.url === url));

    expect(result.error).toBe('Unable to connect to server. Please check your connection.');
    expect(connectivity.checkNow).toHaveBeenCalledOnce();
  });
});
