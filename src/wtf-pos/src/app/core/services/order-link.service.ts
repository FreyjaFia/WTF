import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { OrderingLinkAccessDto, OrderLinkDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class OrderLinkService {
  private static readonly MSG_NOT_AUTHORIZED = HttpErrorMessages.NotAuthorized;
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_CUSTOMER_NOT_FOUND = ServiceErrorMessages.Customer.CustomerNotFound;
  private static readonly MSG_LINK_NOT_FOUND = ServiceErrorMessages.OrderLink.LinkNotFound;
  private static readonly MSG_FETCH_LINKS_FAILED = ServiceErrorMessages.OrderLink.FetchLinksFailed;
  private static readonly MSG_CREATE_LINK_FAILED = ServiceErrorMessages.OrderLink.CreateLinkFailed;
  private static readonly MSG_REVOKE_LINK_FAILED = ServiceErrorMessages.OrderLink.RevokeLinkFailed;
  private static readonly MSG_UPDATE_ACCESS_FAILED =
    ServiceErrorMessages.OrderLink.UpdateAccessFailed;

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/customers`;

  public getLinks(customerId: string): Observable<OrderLinkDto[]> {
    return this.http.get<OrderLinkDto[]>(`${this.baseUrl}/${customerId}/ordering-links`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching ordering links:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, {
                fallback: OrderLinkService.MSG_FETCH_LINKS_FAILED,
                notFound: OrderLinkService.MSG_CUSTOMER_NOT_FOUND,
              }),
            ),
        );
      }),
    );
  }

  /** Creates a link. `expiresAt` is an ISO date-time; omit it for a link that never expires. */
  public createLink(customerId: string, expiresAt?: string | null): Observable<OrderLinkDto> {
    return this.http
      .post<OrderLinkDto>(`${this.baseUrl}/${customerId}/ordering-links`, {
        expiresAt: expiresAt ?? null,
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error creating ordering link:', error);
          return throwError(
            () =>
              new Error(
                this.getErrorMessage(error, {
                  fallback: OrderLinkService.MSG_CREATE_LINK_FAILED,
                  notFound: OrderLinkService.MSG_CUSTOMER_NOT_FOUND,
                }),
              ),
          );
        }),
      );
  }

  public revokeLink(customerId: string, linkId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${customerId}/ordering-links/${linkId}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error revoking ordering link:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, {
                fallback: OrderLinkService.MSG_REVOKE_LINK_FAILED,
                notFound: OrderLinkService.MSG_LINK_NOT_FOUND,
              }),
            ),
        );
      }),
    );
  }

  /** Enables or disables ordering for a customer. Disabling revokes all of their links. */
  public setAccess(customerId: string, allow: boolean): Observable<OrderingLinkAccessDto> {
    return this.http
      .put<OrderingLinkAccessDto>(`${this.baseUrl}/${customerId}/ordering-link-access`, { allow })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error updating ordering access:', error);
          return throwError(
            () =>
              new Error(
                this.getErrorMessage(error, {
                  fallback: OrderLinkService.MSG_UPDATE_ACCESS_FAILED,
                  notFound: OrderLinkService.MSG_CUSTOMER_NOT_FOUND,
                }),
              ),
          );
        }),
      );
  }

  private getErrorMessage(
    error: HttpErrorResponse,
    options: { fallback: string; notFound?: string },
  ): string {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return OrderLinkService.MSG_NETWORK_UNAVAILABLE;
    }

    const serverMessage = extractHttpErrorMessage(error);
    if (serverMessage) {
      return serverMessage;
    }

    if (error.status === 403) {
      return OrderLinkService.MSG_NOT_AUTHORIZED;
    }

    if (error.status === 404 && options.notFound) {
      return options.notFound;
    }

    return options.fallback;
  }
}
