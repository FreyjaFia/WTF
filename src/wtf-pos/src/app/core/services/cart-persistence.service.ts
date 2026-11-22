import { inject, Injectable } from '@angular/core';
import { CartItemDto, SeniorPwdPersonRequestDto } from '@shared/models';
import { BranchService } from './branch.service';
import { db, PersistedCart } from './db';
import { isPastIdRetention } from './senior-pwd-retention';

@Injectable({ providedIn: 'root' })
export class CartPersistenceService {
  private static readonly CART_ROW_ID = 1;

  private readonly branchService = inject(BranchService);

  public async save(
    items: CartItemDto[],
    customerId: string | null,
    specialInstructions: string,
    seniorPwdPersons: SeniorPwdPersonRequestDto[] = [],
    customerAddress: string | null = null,
  ): Promise<void> {
    const record: PersistedCart = {
      id: CartPersistenceService.CART_ROW_ID,
      customerId,
      customerAddress,
      specialInstructions,
      items,
      seniorPwdPersons,
      branchId: this.branchService.activeId(),
      savedAt: new Date().toISOString(),
    };

    await db.carts.put(record);
  }

  public async load(): Promise<PersistedCart | undefined> {
    const saved = await db.carts.get(CartPersistenceService.CART_ROW_ID);

    // A cart with Senior/PWD IDs in it is not kept for good: it is a sale nobody came back to finish.
    if (saved?.seniorPwdPersons?.length && isPastIdRetention(saved.savedAt)) {
      await this.clear();
      return undefined;
    }

    // A cart built for another branch would carry that branch's products and prices into this one.
    const active = this.branchService.activeId();

    if (saved && saved.branchId != null && active !== null && saved.branchId !== active) {
      await this.clear();
      return undefined;
    }

    return saved;
  }

  public async clear(): Promise<void> {
    await db.carts.delete(CartPersistenceService.CART_ROW_ID);
  }

  public async hasCart(): Promise<boolean> {
    const count = await db.carts.count();
    return count > 0;
  }
}
