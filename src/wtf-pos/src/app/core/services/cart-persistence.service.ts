import { Injectable } from '@angular/core';
import { CartItemDto } from '@shared/models';
import { db, PersistedCart } from './db';

@Injectable({ providedIn: 'root' })
export class CartPersistenceService {
  private static readonly CART_ROW_ID = 1;

  public async save(
    items: CartItemDto[],
    customerId: string | null,
    specialInstructions: string,
  ): Promise<void> {
    const record: PersistedCart = {
      id: CartPersistenceService.CART_ROW_ID,
      customerId,
      specialInstructions,
      items,
      savedAt: new Date().toISOString(),
    };

    await db.carts.put(record);
  }

  public async load(): Promise<PersistedCart | undefined> {
    return db.carts.get(CartPersistenceService.CART_ROW_ID);
  }

  public async clear(): Promise<void> {
    await db.carts.delete(CartPersistenceService.CART_ROW_ID);
  }

  public async hasCart(): Promise<boolean> {
    const count = await db.carts.count();
    return count > 0;
  }
}
