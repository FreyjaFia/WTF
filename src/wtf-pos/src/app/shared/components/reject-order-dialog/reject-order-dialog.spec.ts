import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { RejectOrderDialogComponent } from './reject-order-dialog';

describe('RejectOrderDialogComponent', () => {
  let fixture: ComponentFixture<RejectOrderDialogComponent>;

  function setup(isBusy = false) {
    fixture = TestBed.createComponent(RejectOrderDialogComponent);
    fixture.componentRef.setInput('orderNumber', 1042);
    fixture.componentRef.setInput('isBusy', isBusy);
    fixture.detectChanges();

    const confirmed = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    return { confirmed, cancelled };
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const textarea = () => el().querySelector('textarea') as HTMLTextAreaElement;
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement;

  function type(value: string) {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('names the order and explains the customer will see the reason', () => {
    setup();
    expect(el().textContent).toContain('Reject Order #1042?');
    expect(el().textContent).toContain('The customer will see your reason');
  });

  it('asks for a reason and does not confirm without one', () => {
    const { confirmed } = setup();
    button('Reject Order').click();
    fixture.detectChanges();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Please enter a reason for rejecting the order.');
    expect(textarea().getAttribute('aria-invalid')).toBe('true');
  });

  it('treats a blank reason as missing', () => {
    const { confirmed } = setup();
    type('     ');
    button('Reject Order').click();
    fixture.detectChanges();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().querySelector('[role="alert"]')).not.toBeNull();
  });

  it('sends the trimmed reason', () => {
    const { confirmed } = setup();
    type('  Out of stock today  ');
    button('Reject Order').click();

    expect(confirmed).toHaveBeenCalledWith('Out of stock today');
  });

  it('clears the error as soon as a reason is typed', () => {
    setup();
    button('Reject Order').click();
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')).not.toBeNull();

    type('Closed');
    expect(el().querySelector('[role="alert"]')).toBeNull();
    expect(textarea().getAttribute('aria-invalid')).toBeNull();
  });

  it('limits the reason to 500 characters and shows the count', () => {
    setup();
    type('x'.repeat(650));

    expect(textarea().value.length).toBe(500);
    expect(textarea().getAttribute('maxlength')).toBe('500');
    expect(el().textContent).toContain('500/500');
  });

  it('can be cancelled', () => {
    const { cancelled } = setup();
    button('Cancel').click();
    expect(cancelled).toHaveBeenCalled();
  });

  it('does nothing while it is busy and shows the busy label', () => {
    const { confirmed } = setup(true);
    expect(el().textContent).toContain('Rejecting...');
    expect(textarea().disabled).toBe(true);

    fixture.componentInstance['reason'].set('Closed');
    fixture.componentInstance['submit']();
    expect(confirmed).not.toHaveBeenCalled();
  });
});
