import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CartItemDto } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchService } from './branch.service';
import { CartPersistenceService } from './cart-persistence.service';
import { db } from './db';

describe('CartPersistenceService', () => {
  let service: CartPersistenceService;
  const put = vi.fn();
  const get = vi.fn();
  const del = vi.fn();
  const count = vi.fn();
  const activeId = signal<string | null>(null);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(db.carts, 'put').mockImplementation(put);
    vi.spyOn(db.carts, 'get').mockImplementation(get);
    vi.spyOn(db.carts, 'delete').mockImplementation(del);
    vi.spyOn(db.carts, 'count').mockImplementation(count);
    activeId.set(null);
    TestBed.configureTestingModule({ providers: [{ provide: BranchService, useValue: { activeId } }] });
    service = TestBed.inject(CartPersistenceService);
  });

  afterEach(() => vi.restoreAllMocks());

  it('saves the cart in the single fixed row with a timestamp', async () => {
    const items = [{ productId: 'p1' }] as unknown as CartItemDto[];

    await service.save(items, 'c1', 'no ice');

    const record = put.mock.calls[0][0];
    expect(record).toMatchObject({
      id: 1,
      customerId: 'c1',
      specialInstructions: 'no ice',
      items,
    });
    expect(new Date(record.savedAt).toString()).not.toBe('Invalid Date');
  });

  it('saves the order address with the cart, or null when there is none', async () => {
    const items = [{ productId: 'p1' }] as unknown as CartItemDto[];

    await service.save(items, 'c1', '', [], '45 Mabini Street');
    await service.save(items, 'c1', '');

    expect(put.mock.calls[0][0].customerAddress).toBe('45 Mabini Street');
    expect(put.mock.calls[1][0].customerAddress).toBeNull();
  });

  it('loads the fixed row', async () => {
    get.mockResolvedValue({ id: 1 });

    await expect(service.load()).resolves.toEqual({ id: 1 });
    expect(get).toHaveBeenCalledWith(1);
  });

  it('drops a saved cart whose Senior/PWD IDs are past the retention period', async () => {
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    get.mockResolvedValue({ id: 1, savedAt: old, seniorPwdPersons: [{ idNumber: 'SC-1' }] });

    await expect(service.load()).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith(1);
  });

  it('keeps an old cart that holds no Senior/PWD ID and a recent one that does', async () => {
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    get.mockResolvedValue({ id: 1, savedAt: old, seniorPwdPersons: [] });
    await expect(service.load()).resolves.toMatchObject({ id: 1 });

    get.mockResolvedValue({ id: 1, savedAt: new Date().toISOString(), seniorPwdPersons: [{ idNumber: 'SC-1' }] });
    await expect(service.load()).resolves.toMatchObject({ id: 1 });
    expect(del).not.toHaveBeenCalled();
  });

  it('clears the fixed row', async () => {
    await service.clear();

    expect(del).toHaveBeenCalledWith(1);
  });

  it.each([
    [0, false],
    [1, true],
  ])('hasCart is based on row count (%i -> %s)', async (rows, expected) => {
    count.mockResolvedValue(rows);

    await expect(service.hasCart()).resolves.toBe(expected);
  });

  describe('the branch a cart belongs to', () => {
    const items = [{ productId: 'p1' }] as unknown as CartItemDto[];

    it('saves the open branch with the cart', async () => {
      activeId.set('b-main');

      await service.save(items, null, '');

      expect(put.mock.calls[0][0].branchId).toBe('b-main');
    });

    it('gives the cart back for the same branch', async () => {
      activeId.set('b-main');
      get.mockResolvedValue({ id: 1, items, branchId: 'b-main', savedAt: new Date().toISOString() });

      expect(await service.load()).toBeDefined();
      expect(del).not.toHaveBeenCalled();
    });

    it('clears a cart made in another branch instead of giving it back', async () => {
      activeId.set('b-bgc');
      get.mockResolvedValue({ id: 1, items, branchId: 'b-main', savedAt: new Date().toISOString() });

      expect(await service.load()).toBeUndefined();
      expect(del).toHaveBeenCalledWith(1);
    });

    it('keeps a cart saved before carts knew their branch', async () => {
      activeId.set('b-main');
      get.mockResolvedValue({ id: 1, items, savedAt: new Date().toISOString() });

      expect(await service.load()).toBeDefined();
    });
  });
});
