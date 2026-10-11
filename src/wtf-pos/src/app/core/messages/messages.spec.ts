import { describe, expect, it } from 'vitest';
import { HttpErrorMessages, ServiceErrorMessages, SuccessMessages } from './messages';

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectStrings(v, out));
  }
  return out;
}

describe('messages', () => {
  it('has no blank error messages', () => {
    const all = [...collectStrings(HttpErrorMessages), ...collectStrings(ServiceErrorMessages)];

    expect(all.length).toBeGreaterThan(0);
    for (const message of all) {
      expect(message.trim()).not.toBe('');
    }
  });

  it('builds success messages for an entity', () => {
    expect(SuccessMessages.Common.Created('Order')).toBe('Order created successfully.');
    expect(SuccessMessages.Common.Updated('Order')).toBe('Order updated successfully.');
    expect(SuccessMessages.Common.Deleted('Order')).toBe('Order deleted successfully.');
    expect(SuccessMessages.Common.Restored('Order')).toBe('Order restored successfully.');
    expect(SuccessMessages.Common.Saved('Order')).toBe('Order saved successfully.');
  });

  it('defaults the uploaded entity to Image', () => {
    expect(SuccessMessages.Common.Uploaded()).toBe('Image uploaded successfully.');
    expect(SuccessMessages.Common.Uploaded('Logo')).toBe('Logo uploaded successfully.');
  });
});
