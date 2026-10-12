import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConversationMessageDto } from '@shared/models';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ChatComponent } from './chat';

const message = (id: string, sender: 'customer' | 'staff'): ConversationMessageDto => ({
  id,
  sender,
  senderName: sender === 'staff' ? 'Ana' : null,
  body: id,
  createdAt: '2026-10-12T09:15:00',
});

describe('ChatComponent scrolling', () => {
  let fixture: ComponentFixture<ChatComponent>;

  const list = () => (fixture.nativeElement as HTMLElement).querySelector('[data-chat-messages]') as HTMLElement;
  const height = (value: number) => Object.defineProperty(list(), 'scrollHeight', { value, configurable: true });
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  function setup(messages: ConversationMessageDto[], viewer: 'staff' | 'customer' = 'staff') {
    fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('messages', messages);
    fixture.componentRef.setInput('viewer', viewer);
    fixture.detectChanges();
  }

  const update = (messages: ConversationMessageDto[]) => {
    fixture.componentRef.setInput('messages', messages);
    fixture.detectChanges();
  };

  it('opens at the newest message once the messages arrive', async () => {
    setup([]);
    height(900);

    update([message('1', 'customer'), message('2', 'staff')]);
    await frame();

    expect(list().scrollTop).toBe(900);
  });

  it('follows a new message while the reader is at the bottom', async () => {
    setup([message('1', 'customer')]);
    height(500);
    list().dispatchEvent(new Event('scroll'));

    height(700);
    update([message('1', 'customer'), message('2', 'staff')]);
    await frame();

    expect(list().scrollTop).toBe(700);
  });

  it('leaves someone who scrolled up to read where they are, when the other side writes', async () => {
    setup([message('1', 'staff')]);
    await frame();
    height(2000);
    Object.defineProperty(list(), 'clientHeight', { value: 400, configurable: true });
    list().scrollTop = 100;
    list().dispatchEvent(new Event('scroll'));

    height(2200);
    update([message('1', 'customer'), message('2', 'customer')]);
    await frame();

    expect(list().scrollTop).toBe(100);
  });

  it('still jumps to the bottom for their own new message', async () => {
    setup([message('1', 'staff')], 'customer');
    await frame();
    height(2000);
    Object.defineProperty(list(), 'clientHeight', { value: 400, configurable: true });
    list().scrollTop = 100;
    list().dispatchEvent(new Event('scroll'));

    height(2200);
    update([message('1', 'staff'), message('2', 'customer')]);
    await frame();

    expect(list().scrollTop).toBe(2200);
  });

  it('keeps the list scrollable when the conversation is long', () => {
    setup(Array.from({ length: 200 }, (_, i) => message(String(i), i % 2 ? 'staff' : 'customer')));

    expect(list().className).toContain('overflow-y-auto');
    expect(list().className).toContain('min-h-0');
    expect(list().querySelectorAll('[data-message]').length).toBe(200);
  });
});

describe('ChatComponent removing photos', () => {
  const photo = (id: string, sender: 'customer' | 'staff'): ConversationMessageDto => ({
    id,
    sender,
    senderName: null,
    body: '',
    createdAt: '2026-10-12T09:15:00',
    hasImage: true,
    imageWidth: 10,
    imageHeight: 10,
  });

  const build = (viewer: 'staff' | 'customer') => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('messages', [photo('1', 'customer'), photo('2', 'staff')]);
    fixture.componentRef.setInput('viewer', viewer);
    fixture.componentRef.setInput('imageLoader', () => of('x'));
    fixture.componentRef.setInput('canRemoveImages', true);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelectorAll('[data-chat-remove-photo]').length;
  };

  it('lets a customer remove only their own photos, and staff remove any', () => {
    expect(build('customer')).toBe(1);
    expect(build('staff')).toBe(2);
  });
});
