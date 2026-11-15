import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { OrderEditorAddress } from './order-editor-address';

describe('OrderEditorAddress', () => {
  function create(): OrderEditorAddress {
    return TestBed.runInInjectionContext(() => new OrderEditorAddress());
  }

  it('fills from the customer and trims it', () => {
    const address = create();

    address.fillFromCustomer('  5 Pine St ');

    expect(address.value()).toBe('5 Pine St');
    expect(address.control.dirty).toBe(false);
  });

  it('keeps what the cashier typed', () => {
    const address = create();
    address.set('9 Oak Ave', true);

    address.fillFromCustomer('5 Pine St');

    expect(address.value()).toBe('9 Oak Ave');
  });

  it('clears when the customer has none', () => {
    const address = create();
    address.fillFromCustomer('5 Pine St');

    address.fillFromCustomer(undefined);

    expect(address.value()).toBe('');
  });

  it('sends an address only for a selected customer, and nothing when blank', () => {
    const address = create();
    address.set('  9 Oak Ave ', true);

    expect(address.currentFor(true)).toBe('  9 Oak Ave '.trim());
    expect(address.currentFor(false)).toBeNull();

    address.set('   ', true);
    expect(address.currentFor(true)).toBeNull();
  });

  it('locks while a request is running', () => {
    const address = create();

    address.setBusy(true);
    expect(address.control.disabled).toBe(true);

    address.setBusy(false);
    expect(address.control.enabled).toBe(true);
  });
});
