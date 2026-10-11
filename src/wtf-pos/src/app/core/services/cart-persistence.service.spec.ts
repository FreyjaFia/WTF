import { TestBed } from '@angular/core/testing';
import { CartItemDto } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartPersistenceService } from './cart-persistence.service';
import { db } from './db';

describe('CartPersistenceService', () => {
  let service: CartPersistenceService;
  const put = vi.fn();
  const get = vi.fn();
  const del = vi.fn();
  const count = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(db.carts, 'put').mockImplementation(put);
    vi.spyOn(db.carts, 'get').mockImplementation(get);
    vi.spyOn(db.carts, 'delete').mockImplementation(del);
    vi.spyOn(db.carts, 'count').mockImplementation(count);
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

  it('loads the fixed row', async () => {
    get.mockResolvedValue({ id: 1 });

    await expect(service.load()).resolves.toEqual({ id: 1 });
    expect(get).toHaveBeenCalledWith(1);
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
});
