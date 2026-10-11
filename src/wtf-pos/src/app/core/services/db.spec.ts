import { describe, expect, it } from 'vitest';
import { db, WtfDatabase } from './db';

describe('WtfDatabase schema', () => {
  it('uses the wtf-pos database name at the latest version', () => {
    expect(db).toBeInstanceOf(WtfDatabase);
    expect(db.name).toBe('wtf-pos');
    expect(db.verno).toBe(5);
  });

  it('declares all tables', () => {
    const names = db.tables.map((t) => t.name).sort();
    expect(names).toEqual(['carts', 'catalog', 'images', 'pendingOrders']);
  });

  it('declares expected primary keys and indexes', () => {
    expect(db.table('carts').schema.primKey.keyPath).toBe('id');
    expect(db.table('carts').schema.primKey.auto).toBe(true);
    expect(db.table('images').schema.primKey.keyPath).toBe('url');
    expect(db.table('images').schema.idxByName['cachedAt']).toBeDefined();
    const pending = db.table('pendingOrders').schema;
    expect(pending.idxByName['localId']).toBeDefined();
    expect(pending.idxByName['status']).toBeDefined();
  });
});
