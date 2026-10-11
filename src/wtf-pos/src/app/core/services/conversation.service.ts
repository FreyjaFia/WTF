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
