import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthLoadingService } from './auth-loading.service';
import { ListStateService } from './list-state.service';
import { ModalStackService } from './modal-stack.service';

describe('AuthLoadingService', () => {
  it('starts idle and toggles each flag independently', () => {
    const service = TestBed.inject(AuthLoadingService);
    expect(service.checkingSession()).toBe(false);
    expect(service.loadingProfile()).toBe(false);

    service.setCheckingSession(true);
    expect(service.checkingSession()).toBe(true);
    expect(service.loadingProfile()).toBe(false);

    service.setLoadingProfile(true);
    service.setCheckingSession(false);
    expect(service.checkingSession()).toBe(false);
    expect(service.loadingProfile()).toBe(true);
  });
});

describe('ListStateService', () => {
  let service: ListStateService;

  beforeEach(() => {
    localStorage.clear();
    service = TestBed.inject(ListStateService);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns the fallback when nothing is stored', () => {
    expect(service.load('missing', { page: 1 })).toEqual({ page: 1 });
  });

  it('round-trips saved values', () => {
    service.save('orders', { search: 'abc', page: 3 });

    expect(service.load('orders', null)).toEqual({ search: 'abc', page: 3 });
  });

  it('returns the fallback for corrupt JSON', () => {
    localStorage.setItem('bad', '{not json');

    expect(service.load('bad', 'fallback')).toBe('fallback');
  });

  it('ignores storage failures on save and load', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => service.save('k', 1)).not.toThrow();
    expect(service.load('k', 'fb')).toBe('fb');
  });
});

describe('ModalStackService', () => {
  let service: ModalStackService;

  beforeEach(() => {
    service = TestBed.inject(ModalStackService);
  });

  it('reports no open modals when empty and pop returns false', () => {
    expect(service.hasOpen()).toBe(false);
    expect(service.pop()).toBe(false);
  });

  it('closes the most recently opened modal first', () => {
    const closed: string[] = [];
    service.push(() => closed.push('a'));
    service.push(() => closed.push('b'));

    expect(service.hasOpen()).toBe(true);
    expect(service.pop()).toBe(true);
    expect(closed).toEqual(['b']);
    expect(service.pop()).toBe(true);
    expect(closed).toEqual(['b', 'a']);
    expect(service.hasOpen()).toBe(false);
  });

  it('returns unique ids and removes a modal without closing it', () => {
    const close = vi.fn();
    const first = service.push(close);
    const second = service.push(() => undefined);

    expect(first).not.toBe(second);
    service.remove(first);

    expect(close).not.toHaveBeenCalled();
    expect(service.pop()).toBe(true);
    expect(service.hasOpen()).toBe(false);
  });

  it('ignores removal of unknown ids', () => {
    service.push(() => undefined);

    service.remove(999);

    expect(service.hasOpen()).toBe(true);
  });
});
