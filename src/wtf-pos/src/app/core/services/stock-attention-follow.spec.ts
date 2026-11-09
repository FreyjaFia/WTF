import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { followStockPermission } from './stock-attention-follow';

describe('followStockPermission', () => {
  it('starts when the person can read stock, stops when the plan or role takes it away, and stops on destroy', () => {
    const version = signal(0);
    let allowed = false;
    const auth = { permissionsVersion: version, canReadStockMovements: () => allowed };
    const attention = { start: vi.fn(), stop: vi.fn() };
    const injector = TestBed.inject(Injector);

    followStockPermission(auth as never, attention as never, injector);
    TestBed.tick();
    expect(attention.start).not.toHaveBeenCalled();

    // The role would allow it, but the server's list is not known yet.
    allowed = true;
    version.set(0);
    TestBed.tick();
    expect(attention.start).not.toHaveBeenCalled();

    version.update((v) => v + 1);
    TestBed.tick();
    expect(attention.start).toHaveBeenCalledTimes(1);

    allowed = false;
    version.update((v) => v + 1);
    TestBed.tick();
    expect(attention.stop).toHaveBeenCalledTimes(1);

    allowed = true;
    version.update((v) => v + 1);
    TestBed.tick();
    expect(attention.start).toHaveBeenCalledTimes(2);

    TestBed.resetTestingModule();
    expect(attention.stop).toHaveBeenCalledTimes(2);
  });
});
