import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConversationMessageDto } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComponent } from './chat';

const message = (
  id: string,
  sender: 'customer' | 'staff' | 'system',
  over: Partial<ConversationMessageDto> = {},
): ConversationMessageDto => ({
  id,
  sender,
  senderName: sender === 'staff' ? 'Ana' : null,
  body: id,
  createdAt: '2026-10-12T09:15:00',
  ...over,
});

describe('ChatComponent opening', () => {
  let fixture: ComponentFixture<ChatComponent>;

  const list = () => (fixture.nativeElement as HTMLElement).querySelector('[data-chat-messages]') as HTMLElement;
  const rows = () => [...list().querySelectorAll('[data-message]')] as HTMLElement[];
  const animated = () => rows().filter((row) => row.className.includes('app-fade-in'));

  function setup(messages: ConversationMessageDto[], inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('messages', messages);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the list hidden until it is at the newest message, then shows it', () => {
    setup([message('1', 'customer'), message('2', 'staff')]);

    expect(list().className).toContain('opacity-0');

    vi.advanceTimersByTime(20);
    fixture.detectChanges();

    expect(list().className).not.toContain('opacity-0');
  });

  it('shows an empty chat at once, with nothing to position', () => {
    setup([]);

    expect(list().className).not.toContain('opacity-0');
  });

  it('hides again for the first messages that arrive after an empty or loading list', () => {
    setup([], { isLoading: true });
    expect(list().className).not.toContain('opacity-0');

    fixture.componentRef.setInput('messages', [message('1', 'customer')]);
    fixture.detectChanges();
    expect(list().className).toContain('opacity-0');

    vi.advanceTimersByTime(20);
    fixture.detectChanges();
    expect(list().className).not.toContain('opacity-0');
  });

  it('eases in only the newest few rows, so a long chat is not animating hundreds of them', () => {
    setup(Array.from({ length: 40 }, (_, i) => message(String(i), i % 2 ? 'staff' : 'customer')));

    expect(animated().length).toBe(6);
    expect(rows().at(-1)!.className).toContain('app-fade-in');
    expect(rows()[0].className).not.toContain('app-fade-in');
  });

  it('does not make older rows animate when a message is added', () => {
    const ten = Array.from({ length: 10 }, (_, i) => message(String(i), 'customer'));
    setup(ten);
    const oldestAnimatedBefore = animated()[0].getAttribute('data-sender');

    fixture.componentRef.setInput('messages', [...ten, message('new', 'staff')]);
    fixture.detectChanges();

    expect(oldestAnimatedBefore).toBe('customer');
    expect(animated().length).toBe(6);
    expect(rows().at(-1)!.getAttribute('data-sender')).toBe('staff');
  });

  describe('system lines', () => {
    const line = message('s', 'system', { body: 'Order accepted', senderName: 'Ana Reyes' });
    const text = () => (fixture.nativeElement as HTMLElement).querySelector('[data-system-line]')!.textContent!;

    it('name the staff member to staff', () => {
      setup([line], { viewer: 'staff' });

      expect(text()).toContain('Ana Reyes');
    });

    it('never name anyone to the customer, even if the server sent a name', () => {
      setup([line], { viewer: 'customer' });

      expect(text()).toContain('Order accepted');
      expect(text()).not.toContain('Ana');
    });
  });
});
