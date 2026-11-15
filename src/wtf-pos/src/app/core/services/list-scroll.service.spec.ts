import { TestBed } from '@angular/core/testing';
import { ListScrollService } from './list-scroll.service';

describe('ListScrollService', () => {
  let service: ListScrollService;

  beforeEach(() => {
    sessionStorage.clear();
    service = TestBed.inject(ListScrollService);
  });

  it('gives back a saved position once', () => {
    service.save('orders', { pages: 3, offset: 420 });
    expect(service.take('orders')).toEqual({ pages: 3, offset: 420 });
    expect(service.take('orders')).toBeNull();
  });

  it('ignores damaged values', () => {
    sessionStorage.setItem('list-scroll:orders', '{"pages":"x"}');
    expect(service.take('orders')).toBeNull();
    sessionStorage.setItem('list-scroll:orders', 'not json');
    expect(service.take('orders')).toBeNull();
  });
});
