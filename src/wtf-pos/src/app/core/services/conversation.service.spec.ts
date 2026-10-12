import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { ConversationService } from './conversation.service';

afterEach(() => vi.restoreAllMocks());

describe('ConversationService', () => {
  const base = environment.apiUrl;
  const msgs = ServiceErrorMessages.Conversation;

  it('loads the envelope list', () => {
    const { service, http } = setupHttpService(ConversationService);
    const result = capture(service.getConversations());

    const req = http.expectOne(`${base}/conversations`);
    expect(req.request.method).toBe('GET');
    req.flush({ unreadConversations: 2, items: [] });

    expect(result.value).toEqual({ unreadConversations: 2, items: [] });
  });

  it('loads the chat of one order', () => {
    const { service, http } = setupHttpService(ConversationService);
    const result = capture(service.getOrderConversation('o1'));

    const req = http.expectOne(`${base}/orders/o1/conversation`);
    expect(req.request.method).toBe('GET');
    req.flush({ orderId: 'o1', orderNumber: 5, messages: [] });

    expect(result.value).toMatchObject({ orderId: 'o1' });
  });

  it('sends a reply as the message body only', () => {
    const { service, http } = setupHttpService(ConversationService);
    const result = capture(service.sendMessage('o1', 'Ready at 5'));

    const req = http.expectOne(`${base}/orders/o1/messages`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ body: 'Ready at 5' });
    req.flush({ id: 'm1', sender: 'staff', body: 'Ready at 5', createdAt: '2026-10-12T09:00:00Z' });

    expect(result.value).toMatchObject({ id: 'm1' });
  });

  it('sends a picture and its text as a form, with the file under "file"', () => {
    const { service, http } = setupHttpService(ConversationService);
    const file = new File([new Uint8Array([1, 2, 3])], 'proof.png', { type: 'image/png' });
    const result = capture(service.sendImageMessage('o1', file, 'Your drink'));

    const req = http.expectOne(`${base}/orders/o1/messages/image`);
    expect(req.request.method).toBe('POST');
    const form = req.request.body as FormData;
    expect((form.get('file') as File).name).toBe('proof.png');
    expect(form.get('body')).toBe('Your drink');
    req.flush({ id: 'm2', sender: 'staff', body: 'Your drink', createdAt: '2026-10-13T09:00:00Z', hasImage: true });

    expect(result.value).toMatchObject({ id: 'm2', hasImage: true });
  });

  it('fetches a picture as a file', () => {
    const { service, http } = setupHttpService(ConversationService);
    const result = capture(service.getMessageImage('o1', 'm2'));

    const req = http.expectOne(`${base}/orders/o1/messages/m2/image`);
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x'], { type: 'image/jpeg' }));

    expect(result.value).toBeInstanceOf(Blob);
  });

  it('removes a picture', () => {
    const { service, http } = setupHttpService(ConversationService);
    const result = capture(service.removeMessageImage('o1', 'm2'));

    const req = http.expectOne(`${base}/orders/o1/messages/m2/image`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ id: 'm2', imageRemoved: true });

    expect(result.value).toMatchObject({ imageRemoved: true });
  });

  it('explains a refused picture with the server words, and falls back otherwise', () => {
    const { service, http } = setupHttpService(ConversationService);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const refused = capture(service.sendImageMessage('o1', file, ''));
    failWith(http.expectOne(`${base}/orders/o1/messages/image`), 400, { message: 'The picture is too big.' });
    const broken = capture(service.sendImageMessage('o1', file, ''));
    failWith(http.expectOne(`${base}/orders/o1/messages/image`), 500);
    const missing = capture(service.getMessageImage('o1', 'm2'));
    failWith(http.expectOne(`${base}/orders/o1/messages/m2/image`), 500);
    const notRemoved = capture(service.removeMessageImage('o1', 'm2'));
    failWith(http.expectOne(`${base}/orders/o1/messages/m2/image`), 500);

    expect(refused.error).toBe('The picture is too big.');
    expect(broken.error).toBe(msgs.SendImageFailed);
    expect(missing.error).toBe(msgs.LoadImageFailed);
    expect(notRemoved.error).toBe(msgs.RemoveImageFailed);
  });

  it('marks a chat read', () => {
    const { service, http } = setupHttpService(ConversationService);
    service.markRead('o1').subscribe();

    const req = http.expectOne(`${base}/orders/o1/messages/read`);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  describe('errors', () => {
    it('prefers what the server says', () => {
      const { service, http } = setupHttpService(ConversationService);
      const result = capture(service.sendMessage('o1', 'x'));

      failWith(http.expectOne(`${base}/orders/o1/messages`), 400, {
        message: 'This order is finished, so the chat is closed.',
      });

      expect(result.error).toBe('This order is finished, so the chat is closed.');
    });

    it('says the order was not found for a 404 without a message', () => {
      const { service, http } = setupHttpService(ConversationService);
      const result = capture(service.getOrderConversation('o1'));

      failWith(http.expectOne(`${base}/orders/o1/conversation`), 404);

      expect(result.error).toBe(msgs.OrderNotFound);
    });

    it('falls back to a plain message for each call', () => {
      const { service, http } = setupHttpService(ConversationService);
      const list = capture(service.getConversations());
      failWith(http.expectOne(`${base}/conversations`), 500);
      const chat = capture(service.getOrderConversation('o1'));
      failWith(http.expectOne(`${base}/orders/o1/conversation`), 500);
      const send = capture(service.sendMessage('o1', 'x'));
      failWith(http.expectOne(`${base}/orders/o1/messages`), 500);
      const read = capture(service.markRead('o1'));
      failWith(http.expectOne(`${base}/orders/o1/messages/read`), 500);

      expect(list.error).toBe(msgs.LoadListFailed);
      expect(chat.error).toBe(msgs.LoadChatFailed);
      expect(send.error).toBe(msgs.SendFailed);
      expect(read.error).toBe(msgs.MarkReadFailed);
    });

    it('says the network is unavailable and checks the connection again', () => {
      const { service, http, connectivity } = setupHttpService(ConversationService);
      const result = capture(service.sendMessage('o1', 'x'));

      failNetwork(http.expectOne(`${base}/orders/o1/messages`));

      expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(connectivity.checkNow).toHaveBeenCalled();
    });
  });
});
