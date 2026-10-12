import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import {
  ConversationListDto,
  ConversationMessageDto,
  OrderConversationDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

/** Chat for staff: the envelope list and the chat of one customer link order. */
@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = environment.apiUrl;

  /** Every customer's conversations, ones with unread messages first. */
  public getConversations(): Observable<ConversationListDto> {
    return this.http
      .get<ConversationListDto>(`${this.baseUrl}/conversations`)
      .pipe(catchError((error) => this.fail(error, ServiceErrorMessages.Conversation.LoadListFailed)));
  }

  public getOrderConversation(orderId: string): Observable<OrderConversationDto> {
    return this.http
      .get<OrderConversationDto>(`${this.baseUrl}/orders/${orderId}/conversation`)
      .pipe(catchError((error) => this.fail(error, ServiceErrorMessages.Conversation.LoadChatFailed)));
  }

  public sendMessage(orderId: string, body: string): Observable<ConversationMessageDto> {
    return this.http
      .post<ConversationMessageDto>(`${this.baseUrl}/orders/${orderId}/messages`, { body })
      .pipe(catchError((error) => this.fail(error, ServiceErrorMessages.Conversation.SendFailed)));
  }

  /** A reply with a picture (and optional text). */
  public sendImageMessage(orderId: string, file: File, body: string): Observable<ConversationMessageDto> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('body', body);
    return this.http
      .post<ConversationMessageDto>(`${this.baseUrl}/orders/${orderId}/messages/image`, form)
      .pipe(catchError((error) => this.fail(error, ServiceErrorMessages.Conversation.SendImageFailed)));
  }

  /** The picture of one message. It needs the staff login, so it is fetched as a file and not linked to. */
  public getMessageImage(orderId: string, messageId: string): Observable<Blob> {
    return this.http
      .get(`${this.baseUrl}/orders/${orderId}/messages/${messageId}/image`, { responseType: 'blob' })
      .pipe(catchError((error) => this.fail(error, ServiceErrorMessages.Conversation.LoadImageFailed)));
  }

  /** Removes a message's picture. The message stays, as "photo removed". */
  public removeMessageImage(orderId: string, messageId: string): Observable<ConversationMessageDto> {
    return this.http
      .delete<ConversationMessageDto>(`${this.baseUrl}/orders/${orderId}/messages/${messageId}/image`)
      .pipe(catchError((error) => this.fail(error, ServiceErrorMessages.Conversation.RemoveImageFailed)));
  }

  /** The customer's messages were read: for every staff member, not only this one. */
  public markRead(orderId: string): Observable<void> {
    return this.http
      .post<void>(`${this.baseUrl}/orders/${orderId}/messages/read`, {})
      .pipe(catchError((error) => this.fail(error, ServiceErrorMessages.Conversation.MarkReadFailed)));
  }

  private fail(error: HttpErrorResponse, fallback: string): Observable<never> {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return throwError(() => new Error(HttpErrorMessages.NetworkUnavailable));
    }

    const serverMessage = extractHttpErrorMessage(error);
    if (serverMessage) {
      return throwError(() => new Error(serverMessage));
    }

    if (error.status === 404) {
      return throwError(() => new Error(ServiceErrorMessages.Conversation.OrderNotFound));
    }

    console.error('Conversation request failed:', error);
    return throwError(() => new Error(fallback));
  }
}
