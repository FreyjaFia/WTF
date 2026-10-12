import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalStackService } from '@core/services';
import { describe, expect, it, vi } from 'vitest';
import { ChatLightboxComponent } from './chat-lightbox';

describe('ChatLightboxComponent', () => {
  let fixture: ComponentFixture<ChatLightboxComponent>;
  let closed: ReturnType<typeof vi.fn<() => void>>;

  function setup() {
    fixture = TestBed.createComponent(ChatLightboxComponent);
    closed = vi.fn<() => void>();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentRef.setInput('src', 'https://api.test/pic.jpg');
    fixture.detectChanges();
  }

  const q = (selector: string) => (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLElement;

  it('shows the picture in a modal dialog, so the browser draws it over the whole screen', () => {
    const showModal = vi.fn();
    HTMLDialogElement.prototype.showModal = showModal;

    setup();

    expect(showModal).toHaveBeenCalledTimes(1);
    expect((q('[data-chat-zoom-image]') as HTMLImageElement).src).toBe('https://api.test/pic.jpg');
  });

  it('closes when the backdrop (the dialog itself) is clicked', () => {
    setup();

    q('[data-chat-zoom]').click();

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('does not close when the picture itself is clicked', () => {
    setup();

    q('[data-chat-zoom-image]').click();

    expect(closed).not.toHaveBeenCalled();
  });

  it('closes from the close button, once', () => {
    setup();

    q('[data-chat-zoom-close]').click();

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without letting the chat behind it see the key', () => {
    setup();
    const behind = vi.fn();
    (fixture.nativeElement as HTMLElement).addEventListener('keydown', behind);

    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    q('[data-chat-zoom]').dispatchEvent(key);
    const cancel = new Event('cancel', { cancelable: true });
    q('[data-chat-zoom]').dispatchEvent(cancel);

    expect(behind).not.toHaveBeenCalled();
    expect(cancel.defaultPrevented).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('keeps clicks inside the picture view from reaching the chat behind it', () => {
    setup();
    const behind = vi.fn();
    (fixture.nativeElement as HTMLElement).addEventListener('click', behind);

    q('[data-chat-zoom]').click();
    q('[data-chat-zoom-image]').click();

    expect(behind).not.toHaveBeenCalled();
  });

  it('is closed first by the phone back button, before the chat', () => {
    const stack = TestBed.inject(ModalStackService);
    setup();

    expect(stack.hasOpen()).toBe(true);
    stack.pop();

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('leaves the back button stack when it goes away', () => {
    const stack = TestBed.inject(ModalStackService);
    setup();

    fixture.destroy();

    expect(stack.hasOpen()).toBe(false);
  });
});
