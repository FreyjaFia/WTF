import { describe, expect, it } from 'vitest';
import { orderAddressOf } from './order-address';

describe('orderAddressOf', () => {
  it('prefers the delivery address over the customer address', () => {
    expect(orderAddressOf({ deliveryAddress: ' 1 Rizal St ', customerAddress: '2 Mabini St' })).toBe('1 Rizal St');
  });

  it('falls back to the customer address and then to null', () => {
    expect(orderAddressOf({ deliveryAddress: '  ', customerAddress: '2 Mabini St' })).toBe('2 Mabini St');
    expect(orderAddressOf({ deliveryAddress: null, customerAddress: undefined })).toBeNull();
  });
});
