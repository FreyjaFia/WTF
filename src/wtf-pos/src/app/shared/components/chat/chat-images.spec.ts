import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConversationMessageDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComponent } from './chat';
import { ChatImageComponent } from './chat-image';

const picture = (over: Partial<ConversationMessageDto> = {}): ConversationMessageDto => ({
  id: 'm1',
  sender: 'customer',
  senderName: null,
  body: '',
  createdAt: '2026-10-12T09:15:00',
  hasImage: true,
  imageWidth: 800,
  imageHeight: 600,
  ...over,
});

const file = (size = 10, type = 'image/png', name = 'proof.png') => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('ChatComponent pictures', () => {
  let fixture: ComponentFixture<ChatComponent>;

  const loader = () => vi.fn(() => of('blob:fake-picture'));

  function setup(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('messages', []);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (selector: string) => el().querySelector(selector) as HTMLElement | null;
  const click = (selector: string) => {
    (q(selector) as HTMLElement).click();
    fixture.detectChanges();
  };
  const chooseFile = (chosen: File | null) => {
    const input = q('[data-chat-file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: chosen ? [chosen] : [], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  describe('attaching', () => {
    it('has no attach button until the page can load pictures', () => {
      setup();

      expect(q('[data-chat-file]')).toBeNull();
    });

    it('offers only JPEG, PNG and WebP', () => {
      setup({ imageLoader: loader() });

      expect((q('[data-chat-file]') as HTMLInputElement).accept).toBe('image/jpeg,image/png,image/webp');
    });

    it('shows a preview of the chosen photo with a way to remove it', () => {
      setup({ imageLoader: loader() });

      chooseFile(file());

      expect((q('[data-chat-attachment-preview]') as HTMLImageElement).src).toContain('blob:preview');
      expect(q('[data-chat-attachment]')!.textContent).toContain('proof.png');
      expect(fixture.componentInstance.attachment()).not.toBeNull();

      click('[data-chat-attachment-remove]');

      expect(q('[data-chat-attachment]')).toBeNull();
      expect(fixture.componentInstance.attachment()).toBeNull();
    });

    it('releases the preview when the photo is removed', () => {
      setup({ imageLoader: loader() });
      chooseFile(file());

      click('[data-chat-attachment-remove]');

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    });

    it('refuses a file that is not a JPEG, PNG or WebP, and keeps nothing', () => {
      setup({ imageLoader: loader() });

      chooseFile(file(10, 'image/gif', 'fun.gif'));

      expect(q('[data-chat-error]')!.textContent).toContain('JPEG, PNG or WebP');
      expect(q('[data-chat-attachment]')).toBeNull();
    });

    it('refuses a file over 5 MB', () => {
      setup({ imageLoader: loader() });

      chooseFile(file(5 * 1024 * 1024 + 1));

      expect(q('[data-chat-error]')!.textContent).toContain('5 MB');
      expect(q('[data-chat-attachment]')).toBeNull();
    });

    it('clears the refusal once a good photo is chosen', () => {
      setup({ imageLoader: loader() });
      chooseFile(file(10, 'image/gif'));

      chooseFile(file());

      expect(q('[data-chat-error]')).toBeNull();
    });

    it('does nothing when the picker is closed without a choice', () => {
      setup({ imageLoader: loader() });

      chooseFile(null);

      expect(q('[data-chat-attachment]')).toBeNull();
      expect(q('[data-chat-error]')).toBeNull();
    });
  });

  describe('sending', () => {
    it('can send a photo without any text', () => {
      setup({ imageLoader: loader() });
      const sentImage = vi.fn();
      fixture.componentInstance.sentImage.subscribe(sentImage);
      chooseFile(file());

      expect((q('[data-chat-send]') as HTMLButtonElement).disabled).toBe(false);
      click('[data-chat-send]');

      expect(sentImage).toHaveBeenCalledWith({ file: expect.any(File), body: '' });
    });

    it('sends the photo with its trimmed caption, and not as plain text', () => {
      setup({ imageLoader: loader(), draft: '  GCash payment  ' });
      const sent = vi.fn();
      const sentImage = vi.fn();
      fixture.componentInstance.sent.subscribe(sent);
      fixture.componentInstance.sentImage.subscribe(sentImage);
      chooseFile(file());

      click('[data-chat-send]');

      expect(sentImage).toHaveBeenCalledWith({ file: expect.any(File), body: 'GCash payment' });
      expect(sent).not.toHaveBeenCalled();
    });

    it('still sends plain text when no photo is chosen', () => {
      setup({ imageLoader: loader(), draft: 'hello' });
      const sent = vi.fn();
      fixture.componentInstance.sent.subscribe(sent);

      click('[data-chat-send]');

      expect(sent).toHaveBeenCalledWith('hello');
    });

    it('keeps the photo when the send fails (the page shows the error)', () => {
      setup({ imageLoader: loader(), error: 'The picture is too big.' });
      chooseFile(file());

      expect(q('[data-chat-error]')!.textContent).toContain('The picture is too big.');
      expect(q('[data-chat-attachment]')).not.toBeNull();
    });

    it('cannot attach while a send is in progress', () => {
      setup({ imageLoader: loader(), isSending: true });

      expect((q('[data-chat-file]') as HTMLInputElement).disabled).toBe(true);
    });

    it('does not offer pictures in a closed chat', () => {
      setup({ imageLoader: loader(), canSend: false });

      expect(q('[data-chat-file]')).toBeNull();
    });

    it('asks for a caption as optional once a photo is chosen', () => {
      setup({ imageLoader: loader() });
      chooseFile(file());

      expect((q('[data-chat-input]') as HTMLTextAreaElement).placeholder).toContain('caption');
    });
  });

  describe('showing', () => {
    it('shows a picture in the message and reserves its shape', () => {
      const load = loader();
      setup({ imageLoader: load, messages: [picture()] });

      expect((q('[data-chat-image]') as HTMLElement).style.aspectRatio.replace(/\s/g, '')).toBe('800/600');
      expect(load).toHaveBeenCalledTimes(1);
      expect((q('[data-chat-image-loaded]') as HTMLImageElement).src).toContain('blob:fake-picture');
    });

    it('shows larger when tapped, and closes again', () => {
      setup({ imageLoader: loader(), messages: [picture()] });

      click('[data-chat-image]');
      expect(q('[data-chat-zoom]')).not.toBeNull();

      click('[data-chat-zoom-close]');
      expect(q('[data-chat-zoom]')).toBeNull();
    });

    it('shows the caption with the picture', () => {
      setup({ imageLoader: loader(), messages: [picture({ body: 'Here is the receipt' })] });

      expect(el().textContent).toContain('Here is the receipt');
      expect(q('[data-chat-image]')).not.toBeNull();
    });

    it('says "Photo removed" where a removed photo was, keeping the text', () => {
      setup({
        imageLoader: loader(),
        messages: [picture({ hasImage: false, imageRemoved: true, body: 'proof' })],
      });

      expect(q('[data-chat-photo-removed]')!.textContent).toContain('Photo removed');
      expect(q('[data-chat-image]')).toBeNull();
      expect(el().textContent).toContain('proof');
    });

    it('does not try to show a picture when the page cannot load them', () => {
      setup({ messages: [picture()] });

      expect(q('[data-chat-image]')).toBeNull();
    });
  });

  describe('staff removing a photo', () => {
    it('asks first, and only then removes', () => {
      setup({ imageLoader: loader(), canRemoveImages: true, messages: [picture()] });
      const removed = vi.fn();
      fixture.componentInstance.removeImage.subscribe(removed);

      click('[data-chat-remove-photo]');
      expect(removed).not.toHaveBeenCalled();
      expect(q('[data-chat-remove-confirm]')).not.toBeNull();

      click('[data-chat-remove-yes]');

      expect(removed).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
      expect(q('[data-chat-remove-confirm]')).toBeNull();
    });

    it('can keep the photo after all', () => {
      setup({ imageLoader: loader(), canRemoveImages: true, messages: [picture()] });
      const removed = vi.fn();
      fixture.componentInstance.removeImage.subscribe(removed);

      click('[data-chat-remove-photo]');
      click('[data-chat-remove-no]');

      expect(removed).not.toHaveBeenCalled();
      expect(q('[data-chat-remove-photo]')).not.toBeNull();
    });

    it('is not offered to the customer', () => {
      setup({ imageLoader: loader(), messages: [picture()] });

      expect(q('[data-chat-remove-photo]')).toBeNull();
    });
  });
});

describe('ChatImageComponent', () => {
  let fixture: ComponentFixture<ChatImageComponent>;
  const q = (selector: string) => (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLElement | null;

  function setup(load: () => unknown, message = picture()) {
    fixture = TestBed.createComponent(ChatImageComponent);
    fixture.componentRef.setInput('message', message);
    fixture.componentRef.setInput('loader', load);
    fixture.detectChanges();
  }

  it('turns a downloaded file into an address, and releases it when it goes away', () => {
    setup(() => of(new Blob(['x'], { type: 'image/jpeg' })));

    expect((q('[data-chat-image-loaded]') as HTMLImageElement).src).toContain('blob:preview');

    fixture.destroy();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('uses a plain address as it is, creating nothing to release', () => {
    setup(() => of('https://api.test/pic'));

    expect((q('[data-chat-image-loaded]') as HTMLImageElement).src).toBe('https://api.test/pic');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('tells the chat which address to show larger', () => {
    setup(() => of('https://api.test/pic'));
    const opened = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);

    q('[data-chat-image]')!.click();

    expect(opened).toHaveBeenCalledWith('https://api.test/pic');
  });

  it('cannot be tapped before the picture has loaded', () => {
    setup(() => of());

    expect((q('[data-chat-image]') as HTMLButtonElement).disabled).toBe(true);
    expect(q('[data-chat-image-loading]')).not.toBeNull();
  });

  it('says so when the picture cannot be loaded, and tries again on request', () => {
    const load = vi.fn().mockReturnValueOnce(throwError(() => new Error('no'))).mockReturnValue(of('https://api.test/pic'));
    setup(load);

    expect(q('[data-chat-image-failed]')).not.toBeNull();

    q('[data-chat-image-retry]')!.click();
    fixture.detectChanges();

    expect(load).toHaveBeenCalledTimes(2);
    expect(q('[data-chat-image-loaded]')).not.toBeNull();
    expect(q('[data-chat-image-failed]')).toBeNull();
  });

  it('falls back to a 4:3 shape when the size is unknown', () => {
    setup(() => of('x'), picture({ imageWidth: null, imageHeight: null }));

    expect((q('[data-chat-image]') as HTMLElement).style.aspectRatio.replace(/\s/g, '')).toBe('4/3');
  });

  it('waits until it is on screen before fetching', () => {
    const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          callbacks.push(callback);
        }
        public observe = vi.fn();
        public disconnect = vi.fn();
      },
    );
    const load = vi.fn(() => of('https://api.test/pic'));

    setup(load);
    expect(load).not.toHaveBeenCalled();

    callbacks[0]([{ isIntersecting: true }]);
    fixture.detectChanges();

    expect(load).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
