import { CartItemDto } from '@shared/models';
import Dexie, { type Table } from 'dexie';

export interface PersistedCart {
  id: number;
  customerId: string | null;
  specialInstructions: string;
  items: CartItemDto[];
  savedAt: string;
}

export class WtfDatabase extends Dexie {
  public readonly carts!: Table<PersistedCart, number>;

  constructor() {
    super('wtf-pos');

    this.version(1).stores({
      carts: '++id',
    });
  }
}

export const db = new WtfDatabase();
