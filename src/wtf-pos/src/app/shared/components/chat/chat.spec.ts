import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConversationMessageDto } from '@shared/models';
import { describe, expect, it, vi } from 'vitest';
import { ChatComponent } from './chat';

const message = (
  id: string,
  sender: 'customer' | 'staff' | 'system',
  body: string,
  over: Partial<ConversationMessageDto> = {},
): ConversationMessageDto => ({
  id,
  sender,
  senderName: sender === 'staff' ? 'Ana Reyes' : null,
  body,
  createdAt: '2026-10-12T09:15:00',
  ...over,
});

describe('ChatComponent', () => {
  let fixture: ComponentFixture<ChatComponent>;

  function setup(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('messages', []);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const rows = () => [...el().querySelectorAll('[data-message]')] as HTMLElement[];
  const input = () => el().querySelector('[data-chat-input]') as HTMLTextAreaElement;
  const send = () => el().querySelector('[data-chat-send]') as HTMLButtonElement;

  const type = (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const key = (name: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: name, shiftKey, cancelable: true });
    input().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  describe('messages', () => {
    it('shows each message with its time', () => {
      setup({ messages: [message('1', 'customer', 'Is 5pm ok?')] });

      expect(rows().length).toBe(1);
      expect(text()).toContain('Is 5pm ok?');
      expect(text()).toContain('12 Oct, 9:15 AM');
    });

    it('shows an order update as a centered line, not a bubble, for both sides', () => {
      for (const viewer of ['staff', 'customer'] as const) {
        setup({
          viewer,
          messages: [message('1', 'system', 'Order accepted', { senderName: 'Ana' })],
        });

        const line = el().querySelector('[data-system-line]') as HTMLElement;
        expect(line).not.toBeNull();
        expect(line.textContent).toContain('Order accepted');
        // Staff are told who made the change; the customer is never given a staff name.
        if (viewer === 'staff') {
          expect(line.textContent).toContain('Ana');
        } else {
          expect(line.textContent).not.toContain('Ana');
        }
        expect(line.textContent).toContain('12 Oct, 9:15 AM');
        expect(el().querySelector('[data-mine]')).toBeNull();
      }
    });

    it('puts the viewers own messages on the right, and the other sides on the left', () => {
      setup({
        viewer: 'staff',
        messages: [message('1', 'customer', 'question'), message('2', 'staff', 'answer')],
      });

      expect(rows()[0].dataset['mine']).toBe('false');
      expect(rows()[0].className).toContain('items-start');
      expect(rows()[1].dataset['mine']).toBe('true');
      expect(rows()[1].className).toContain('items-end');
    });

    it('flips the sides for the customer', () => {
      setup({
        viewer: 'customer',
        messages: [message('1', 'customer', 'question'), message('2', 'staff', 'answer')],
      });

      expect(rows()[0].dataset['mine']).toBe('true');
      expect(rows()[1].dataset['mine']).toBe('false');
    });

    it('names the other side: the staff member, or the customer', () => {
      setup({
        viewer: 'staff',
        customerLabel: 'Maria Cruz',
        messages: [message('1', 'customer', 'q'), message('2', 'staff', 'a')],
      });
      expect(rows()[0].textContent).toContain('Maria Cruz');
      expect(rows()[1].textContent).not.toContain('Ana Reyes');

      setup({
        viewer: 'customer',
        messages: [message('1', 'customer', 'q'), message('2', 'staff', 'a', { senderName: 'Ana' })],
      });
      expect(rows()[1].textContent).toContain('Ana');
    });

    it('falls back to "Shop" for a staff message with no name', () => {
      setup({ viewer: 'customer', messages: [message('1', 'staff', 'a', { senderName: null })] });

      expect(rows()[0].textContent).toContain('Shop');
    });

    it('shows text as plain text, never as HTML', () => {
      setup({ messages: [message('1', 'customer', '<img src=x onerror=alert(1)><b>bold</b>')] });

      expect(el().querySelector('[data-message] img')).toBeNull();
      expect(el().querySelector('[data-message] b')).toBeNull();
      expect(text()).toContain('<img src=x onerror=alert(1)><b>bold</b>');
    });

    it('keeps line breaks and long words inside the bubble', () => {
      setup({ messages: [message('1', 'customer', 'a\nb')] });

      const bubble = rows()[0].querySelector('div')!;
      expect(bubble.className).toContain('whitespace-pre-wrap');
      expect(bubble.className).toContain('wrap-break-word');
    });

    it('says so when there are no messages', () => {
      setup({ emptyText: 'Say hello to the shop.' });

      expect(el().querySelector('[data-chat-empty]')!.textContent).toContain('Say hello to the shop.');
    });

    it('shows a spinner while the first load runs, but keeps messages on screen while refreshing', () => {
      setup({ isLoading: true });
      expect(el().querySelector('.loading-spinner')).not.toBeNull();

      setup({ isLoading: true, messages: [message('1', 'customer', 'hi')] });
      expect(el().querySelector('.loading-spinner')).toBeNull();
      expect(rows().length).toBe(1);
    });

    it('is a log that is read out as messages arrive', () => {
      setup();

      const log = el().querySelector('[data-chat-messages]')!;
      expect(log.getAttribute('role')).toBe('log');
      expect(log.getAttribute('aria-live')).toBe('polite');
    });

    it('scrolls to the newest message', async () => {
      setup({ messages: [message('1', 'customer', 'one')] });
      const list = el().querySelector('[data-chat-messages]') as HTMLElement;
      Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });

      fixture.componentRef.setInput('messages', [message('1', 'customer', 'one'), message('2', 'staff', 'two')]);
      fixture.detectChanges();
      await Promise.resolve();

      expect(list.scrollTop).toBe(500);
    });
  });

  describe('writing', () => {
    it('has a box and a send button that starts off', () => {
      setup();

      expect(input()).not.toBeNull();
      expect(send().disabled).toBe(true);
      expect(input().maxLength).toBe(1000);
    });

    it('turns the send button on once there is text, and off for blank text', () => {
      setup();

      type('Hello');
      expect(send().disabled).toBe(false);
      type('   \n  ');
      expect(send().disabled).toBe(true);
    });

    it('sends the trimmed text with the button', () => {
      setup();
      const sent = vi.fn();
      fixture.componentInstance.sent.subscribe(sent);

      type('  Ready at 5  ');
      send().click();

      expect(sent).toHaveBeenCalledWith('Ready at 5');
    });

    it('sends with Enter, and Shift+Enter only makes a new line', () => {
      setup();
      const sent = vi.fn();
      fixture.componentInstance.sent.subscribe(sent);
      type('Hello');

      const shifted = key('Enter', true);
      expect(sent).not.toHaveBeenCalled();
      expect(shifted.defaultPrevented).toBe(false);

      const plain = key('Enter');
      expect(sent).toHaveBeenCalledWith('Hello');
      expect(plain.defaultPrevented).toBe(true);
    });

    it('does not send empty text with Enter', () => {
      setup();
      const sent = vi.fn();
      fixture.componentInstance.sent.subscribe(sent);

      type('   ');
      key('Enter');

      expect(sent).not.toHaveBeenCalled();
    });

    it('keeps the draft until the page empties it, so a failed send keeps what was typed', () => {
      setup();
      const sent = vi.fn();
      fixture.componentInstance.sent.subscribe(sent);
      type('Hello');
      send().click();
      fixture.detectChanges();

      expect(input().value).toBe('Hello');

      fixture.componentRef.setInput('draft', '');
      fixture.detectChanges();
      expect(input().value).toBe('');
    });

    it('is off while sending, and shows a spinner', () => {
      setup({ isSending: true });
      type('Hello');

      expect(send().disabled).toBe(true);
      expect(input().disabled).toBe(true);
      expect(send().querySelector('.loading-spinner')).not.toBeNull();
    });

    it('does not send twice while sending', () => {
      setup({ isSending: true, draft: 'Hello' });
      const sent = vi.fn();
      fixture.componentInstance.sent.subscribe(sent);

      key('Enter');
      send().click();

      expect(sent).not.toHaveBeenCalled();
    });

    it('shows what went wrong above the box', () => {
      setup({ error: 'Please wait for the shop to reply before sending more messages.' });

      expect(el().querySelector('[data-chat-error]')!.textContent).toContain('Please wait for the shop');
      expect(el().querySelector('[data-chat-error]')!.getAttribute('role')).toBe('alert');
    });

    it('shows a counter only when close to the limit', () => {
      setup();
      type('x'.repeat(799));
      expect(el().querySelector('[data-chat-counter]')).toBeNull();

      type('x'.repeat(800));
      expect(el().querySelector('[data-chat-counter]')!.textContent).toContain('800/1000');
    });
  });

  describe('a closed chat', () => {
    it('shows why instead of the box, and keeps the history', () => {
      setup({
        canSend: false,
        closedReason: 'This order is finished, so the chat is closed.',
        messages: [message('1', 'customer', 'thanks')],
      });

      expect(input()).toBeNull();
      expect(send()).toBeNull();
      expect(el().querySelector('[data-chat-closed]')!.textContent).toContain('This order is finished');
      expect(rows().length).toBe(1);
    });

    it('has a default reason', () => {
      setup({ canSend: false });

      expect(el().querySelector('[data-chat-closed]')!.textContent).toContain('This chat is closed.');
    });

    it('cannot send even if asked to', () => {
      setup({ canSend: false, draft: 'x' });
      const sent = vi.fn();
      fixture.componentInstance.sent.subscribe(sent);

      (fixture.componentInstance as unknown as { submit: () => void }).submit();

      expect(sent).not.toHaveBeenCalled();
    });
  });
});
