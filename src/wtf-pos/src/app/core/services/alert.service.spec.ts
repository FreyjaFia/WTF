import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from './alert.service';

describe('AlertService', () => {
  let service: AlertService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = TestBed.inject(AlertService);
  });

  afterEach(() => vi.useRealTimers());

  it('starts hidden', () => {
    expect(service.alert().visible).toBe(false);
    expect(service.alert().message).toBe('');
  });

  it.each([
    ['success', 'success'],
    ['error', 'error'],
    ['warning', 'warning'],
    ['info', 'info'],
  ] as const)('%s() shows an alert of that type', (method, type) => {
    service[method]('hello');

    expect(service.alert()).toMatchObject({
      type,
      message: 'hello',
      visible: true,
      actionLabel: null,
      action: null,
    });
  });

  it('keeps the action label and callback for action alerts', () => {
    const action = vi.fn();

    service.successWithAction('Saved', 'Undo', action);
    expect(service.alert()).toMatchObject({ type: 'success', actionLabel: 'Undo' });
    service.alert().action?.();
    expect(action).toHaveBeenCalledTimes(1);

    service.infoWithAction('FYI', 'View', action);
    expect(service.alert()).toMatchObject({ type: 'info', actionLabel: 'View' });
  });

  it('dismiss hides the alert and clears the action but keeps the message', () => {
    service.successWithAction('Saved', 'Undo', () => undefined);

    service.dismiss();

    expect(service.alert()).toMatchObject({
      visible: false,
      actionLabel: null,
      action: null,
      message: 'Saved',
    });
  });

  it('auto-dismisses after 5 seconds', () => {
    service.error('boom');
    TestBed.tick();

    vi.advanceTimersByTime(4999);
    expect(service.alert().visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(service.alert().visible).toBe(false);
  });

  it('restarts the timer when a new alert replaces the previous one', () => {
    service.error('first');
    TestBed.tick();
    vi.advanceTimersByTime(3000);

    service.error('second');
    TestBed.tick();
    vi.advanceTimersByTime(3000);
    expect(service.alert()).toMatchObject({ visible: true, message: 'second' });

    vi.advanceTimersByTime(2000);
    expect(service.alert().visible).toBe(false);
  });

  it('builds success messages from SuccessMessages', () => {
    service.successCreated('Order');
    expect(service.alert().message).toBe('Order created successfully.');
    service.successUpdated('Order');
    expect(service.alert().message).toBe('Order updated successfully.');
    service.successDeleted('Order');
    expect(service.alert().message).toBe('Order deleted successfully.');
    service.successRestored('Order');
    expect(service.alert().message).toBe('Order restored successfully.');
    service.successSaved('Order');
    expect(service.alert().message).toBe('Order saved successfully.');
    service.successUploaded();
    expect(service.alert().message).toBe('Image uploaded successfully.');
  });

  it('shows the canned error messages', () => {
    service.errorUnauthorized();
    expect(service.alert()).toMatchObject({
      type: 'error',
      message: 'You are not authorized to perform this action.',
    });
    service.errorInvalidImageType();
    expect(service.alert().message).toBe(
      'Invalid image file type. Only JPG, PNG, GIF, and WebP are allowed.',
    );
    service.errorFileTooLarge();
    expect(service.alert().message).toBe('File size exceeds 5MB limit.');
    service.errorFileTooLarge(10);
    expect(service.alert().message).toBe('File size exceeds 10MB limit.');
    service.errorNothingToUpdate();
    expect(service.alert().message).toBe('No changes to update.');
  });

  it('builds lower-cased entity error messages', () => {
    expect(service.getLoadErrorMessage('Customers')).toBe('Failed to load customers.');
    expect(service.getCreateErrorMessage('Order')).toBe('Failed to create order.');
    expect(service.getUpdateErrorMessage('Order')).toBe('Failed to update order.');
    expect(service.getDeleteErrorMessage('Order')).toBe('Failed to delete order.');
    expect(service.getUploadErrorMessage()).toBe('Failed to upload image.');
    expect(service.getUploadErrorMessage('Logo')).toBe('Failed to upload logo.');
  });
});
