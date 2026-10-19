import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicOrderDto } from '@shared/models';
import { describe, expect, it, vi } from 'vitest';
import { PublicOrderDetailsComponent } from './public-order-details';

const make = (over: Partial<PublicOrderDto> = {}): PublicOrderDto => ({
  id: 'o1',
  orderNumber: 1001,
  createdAt: '2026-10-11T09:00:00',
  statusLabel: 'Waiting for confirmation',
  statusKind: 'waiting',
  items: [
    {
      name: 'Latte',
      quantity: 2,
      unitPrice: 150,
      addOns: [{ name: 'Large', quantity: 2, unitPrice: 30 }],
      specialInstructions: 'less ice',
    },
  ],
  total: 720,
  fulfillmentType: 'Delivery',
  deliveryAddress: '5 Side St',
  contactNumber: '0917 123 4567',
  paymentMethod: 'Cash',
  amountReceived: 1000,
  tips: 30,
  specialInstructions: 'Ring the bell',
  ...over,
});

describe('PublicOrderDetailsComponent', () => {
  let fixture: ComponentFixture<PublicOrderDetailsComponent>;

  function setup(order: PublicOrderDto = make()) {
    fixture = TestBed.createComponent(PublicOrderDetailsComponent);
    fixture.componentRef.setInput('order', order);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const note = () => el().querySelector('[data-status-note]')!.textContent!.trim();
  const row = (label: string) =>
    [...el().querySelectorAll('dt')].find((dt) => dt.textContent?.trim() === label);

  it('shows the order number, the date and the status', () => {
    setup();
    expect(text()).toContain('Order Details');
    expect(text()).toContain('#1001');
    expect(text()).toContain('11 Oct 2026');
    expect(text()).toContain('Waiting for confirmation');
  });

  it('lists each item with its add-ons, notes and the price of the whole line', () => {
    setup();
    expect(text()).toContain('2× Latte');
    expect(text()).toContain('Large');
    expect(text()).toContain('₱30.00 × 4 (2 per item)');
    expect(text()).toContain('₱300.00');
    expect(text()).not.toContain('×2');
    expect(text()).toContain('less ice');
    // (150 + 2 x 30) x 2
    expect(text()).toContain('420.00');
  });

  it('shows how it is handed over and how to reach the customer', () => {
    setup();
    expect(text()).toContain('Delivery');
    expect(text()).toContain('5 Side St');
    expect(text()).toContain('0917 123 4567');
    expect(text()).toContain('Ring the bell');
  });

  it('leaves out what the order does not have', () => {
    setup(
      make({
        fulfillmentType: 'Pickup',
        deliveryAddress: null,
        contactNumber: null,
        specialInstructions: null,
        tips: null,
        amountReceived: null,
      }),
    );
    expect(text()).not.toContain('Address');
    expect(text()).not.toContain('Contact');
    expect(row('Tip')).toBeUndefined();
    expect(row('You will pay')).toBeUndefined();
  });

  describe('payment summary', () => {
    it('adds the tip to what is due and works out the change', () => {
      setup();
      expect(row('Tip')!.nextElementSibling!.textContent).toContain('30.00');
      expect(row('To pay')!.nextElementSibling!.textContent).toContain('750.00');
      expect(row('You will pay')!.nextElementSibling!.textContent).toContain('1,000.00');
      expect(row('Change')!.nextElementSibling!.textContent).toContain('250.00');
    });

    it('shows no tip row without a tip', () => {
      setup(make({ tips: null }));
      expect(row('Tip')).toBeUndefined();
      expect(row('To pay')!.nextElementSibling!.textContent).toContain('720.00');
    });

    it('shows the method, or says it is not set', () => {
      setup();
      expect(row('Method')!.nextElementSibling!.textContent).toContain('Cash');

      setup(make({ paymentMethod: null }));
      expect(row('Method')!.nextElementSibling!.textContent).toContain('Not set');
    });

    it('counts the items', () => {
      setup();
      expect(row('Items')!.nextElementSibling!.textContent).toContain('2');
    });
  });

  describe('the sentence about where the order stands', () => {
    it.each([
      ['waiting', 'Waiting for the shop to confirm'],
      ['accepted', 'accepted your order'],
      ['completed', 'complete'],
      ['refunded', 'refunded'],
      ['cancelled', 'cancelled'],
    ] as const)('for a %s order', (statusKind, expected) => {
      setup(make({ statusKind }));
      expect(note()).toContain(expected);
    });

    it('gives the shop\'s reason for a rejected order', () => {
      setup(make({ statusKind: 'rejected', rejectionReason: 'Closed today' }));
      expect(note()).toContain('could not take this order. Reason: Closed today');
    });

    it('still reads well for a rejection without a reason', () => {
      setup(make({ statusKind: 'rejected', rejectionReason: null }));
      expect(note()).toBe('The shop could not take this order.');
    });
  });

  describe('timeline', () => {
    const steps = () =>
      [...el().querySelectorAll('[data-timeline] li')].map(
        (li) => `${li.getAttribute('data-step')}:${li.getAttribute('data-state')}`,
      );

    it('shows where an accepted delivery order is, with the time of each finished step', () => {
      setup(
        make({
          statusKind: 'accepted',
          fulfillmentType: 'Delivery',
          acceptedAt: '2026-10-11T09:05:00',
        }),
      );
      expect(steps()).toEqual([
        'placed:done',
        'accepted:done',
        'ready:current',
        'completed:upcoming',
      ]);
      expect(text()).toContain('Ready for delivery');
      expect(text()).toContain('9:05 AM');
      expect(text()).toContain('Being prepared');
    });

    it('says a step has not happened yet, so a later step is never read as the status', () => {
      setup(make({ statusKind: 'waiting', fulfillmentType: 'Delivery' }));
      const hints = [...el().querySelectorAll('[data-step-hint]')].map((h) => h.textContent!.trim());
      expect(hints).toEqual(['Waiting for the shop', 'Not yet', 'Not yet']);
    });

    it('lays the steps out in a row on wide screens and in a column on phones', () => {
      setup();
      const list = el().querySelector('[data-timeline] ol') as HTMLElement;
      expect(list.className).toContain('flex-col');
      expect(list.className).toContain('md:flex-row');
    });

    it('names the ready step for pickup', () => {
      setup(make({ fulfillmentType: 'Pickup' }));
      expect(text()).toContain('Ready for pickup');
    });

    it('stops at the rejection', () => {
      setup(make({ statusKind: 'rejected', finishedAt: '2026-10-11T09:02:00' }));
      expect(steps()).toEqual(['placed:done', 'rejected:stopped']);
    });

    it('shows a finished order with every step done', () => {
      setup(make({ statusKind: 'completed', finishedAt: '2026-10-11T10:00:00' }));
      expect(steps()).toEqual([
        'placed:done',
        'accepted:done',
        'ready:done',
        'completed:done',
      ]);
    });
  });

  describe('chat with the shop', () => {
    const card = () => el().querySelector('[data-chat-card]') as HTMLElement;
    const button = () => el().querySelector('[data-chat-button]') as HTMLButtonElement;

    it('has a card with a Chat button above the progress', () => {
      setup();

      expect(card().textContent).toContain('Chat with the shop');
      expect(button().textContent).toContain('Chat');
      const timeline = el().querySelector('[data-timeline]')!;
      expect(card().compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('asks the page to open the chat', () => {
      setup();
      const chat = vi.fn();
      fixture.componentInstance.chat.subscribe(chat);

      button().click();

      expect(chat).toHaveBeenCalledTimes(1);
    });

    it('shows how many messages from the shop are unread, and says the shop wrote', () => {
      setup();
      fixture.componentRef.setInput('unread', 3);
      fixture.detectChanges();

      expect(button().querySelector('[data-chat-unread]')!.textContent!.trim()).toBe('3');
      expect(card().textContent).toContain('The shop wrote to you.');
    });

    it('shows no number when nothing is unread', () => {
      setup();

      expect(button().querySelector('[data-chat-unread]')).toBeNull();
    });

    it.each(['waiting', 'accepted', 'ready'] as const)('invites a question on a %s order', (statusKind) => {
      setup(make({ statusKind }));

      expect(card().textContent).toContain('Ask about your order');
    });

    it.each(['completed', 'rejected', 'cancelled', 'refunded'] as const)(
      'says a %s order is finished, but its messages can still be read',
      (statusKind) => {
        setup(make({ statusKind }));

        expect(card().textContent).toContain('This order is finished. You can still read the messages.');
        expect(button()).not.toBeNull();
      },
    );
  });

  it('asks to go back', () => {
    setup();
    const back = vi.fn();
    fixture.componentInstance.back.subscribe(back);
    (el().querySelector('[aria-label="Back to my orders"]') as HTMLElement).click();
    expect(back).toHaveBeenCalledTimes(1);
  });
});
