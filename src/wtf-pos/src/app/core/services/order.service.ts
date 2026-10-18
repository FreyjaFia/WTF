import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import {
  CreateOrderCommand,
  OfflineSyncResultDto,
  OrderDto,
  OrderHistoryDto,
  OrderSourceEnum,
  OrderStatusEnum,
  PagedResultDto,
  UpdateOrderCommand,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_ORDER_NOT_FOUND = ServiceErrorMessages.Order.OrderNotFound;
  private static readonly MSG_INVALID_ORDER_DATA = ServiceErrorMessages.Order.InvalidOrderData;
  private static readonly MSG_INVALID_ORDER_BATCH_DATA =
    ServiceErrorMessages.Order.InvalidOrderBatchData;
  private static readonly MSG_ORDER_CANNOT_BE_VOIDED =
    ServiceErrorMessages.Order.OrderCannotBeVoided;
  private static readonly MSG_FETCH_ORDERS_FAILED = ServiceErrorMessages.Order.FetchOrdersFailed;
  private static readonly MSG_FETCH_ORDER_FAILED = ServiceErrorMessages.Order.FetchOrderFailed;
  private static readonly MSG_CREATE_ORDER_FAILED = ServiceErrorMessages.Order.CreateOrderFailed;
  private static readonly MSG_SYNC_ORDERS_FAILED = ServiceErrorMessages.Order.SyncOrdersFailed;
  private static readonly MSG_UPDATE_ORDER_FAILED = ServiceErrorMessages.Order.UpdateOrderFailed;
  private static readonly MSG_VOID_ORDER_FAILED = ServiceErrorMessages.Order.VoidOrderFailed;
  private static readonly MSG_OVERRIDE_ORDER_FAILED =
    ServiceErrorMessages.Order.OverrideOrderFailed;
  private static readonly MSG_APPROVE_ORDER_FAILED = ServiceErrorMessages.Order.ApproveOrderFailed;
  private static readonly MSG_REJECT_ORDER_FAILED = ServiceErrorMessages.Order.RejectOrderFailed;
  private static readonly MSG_ORDER_NOT_WAITING = ServiceErrorMessages.Order.OrderNotWaiting;
  private static readonly MSG_MARK_READY_FAILED = ServiceErrorMessages.Order.MarkReadyFailed;
  private static readonly MSG_CANNOT_MARK_READY =
    ServiceErrorMessages.Order.OrderCannotBeMarkedReady;

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/orders`;

  public getOrders(query?: {
    status?: OrderStatusEnum | null;
    customerId?: string | null;
  }): Observable<OrderDto[]> {
    let params = new HttpParams();

    if (
      query?.status !== undefined &&
      query?.status !== null &&
      query?.status !== OrderStatusEnum.All
    ) {
      params = params.set('status', String(query.status));
    }

    if (query?.customerId) {
      params = params.set('customerId', query.customerId);
    }

    return this.http.get<OrderDto[]>(this.baseUrl, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching orders:', error);
        return throwError(
          () => new Error(this.getErrorMessage(error, OrderService.MSG_FETCH_ORDERS_FAILED)),
        );
      }),
    );
  }

  public getOrdersPaged(query?: {
    status?: OrderStatusEnum | null;
    customerId?: string | null;
    searchTerm?: string | null;
    /** Only orders from this source; leave out for all. */
    source?: OrderSourceEnum | null;
    page?: number;
    pageSize?: number;
  }): Observable<PagedResultDto<OrderDto>> {
    let params = new HttpParams();

    if (
      query?.status !== undefined &&
      query?.status !== null &&
      query?.status !== OrderStatusEnum.All
    ) {
      params = params.set('status', String(query.status));
    }

    if (query?.customerId) {
      params = params.set('customerId', query.customerId);
    }

    if (query?.searchTerm && query.searchTerm.trim()) {
      params = params.set('searchTerm', query.searchTerm.trim());
    }

    if (query?.source !== undefined && query?.source !== null) {
      params = params.set('source', String(query.source));
    }

    if (query?.page !== undefined && query?.page !== null) {
      params = params.set('page', String(query.page));
    }

    if (query?.pageSize !== undefined && query?.pageSize !== null) {
      params = params.set('pageSize', String(query.pageSize));
    }

    return this.http.get<PagedResultDto<OrderDto>>(`${this.baseUrl}/paged`, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching paged orders:', error);
        return throwError(
          () => new Error(this.getErrorMessage(error, OrderService.MSG_FETCH_ORDERS_FAILED)),
        );
      }),
    );
  }

  /** Orders customers placed through their link that are waiting for staff to accept or reject them. */
  public getAwaitingOrders(): Observable<OrderDto[]> {
    return this.getOrdersPaged({
      status: OrderStatusEnum.PendingApproval,
      page: 1,
      pageSize: 50,
    }).pipe(map((result) => result.items));
  }

  /** Offline orders held for an Admin because the prices or the menu changed before they synced. */
  public getHeldOrders(): Observable<OrderDto[]> {
    return this.getOrdersPaged({
      status: OrderStatusEnum.PendingReview,
      page: 1,
      pageSize: 50,
    }).pipe(map((result) => result.items));
  }

  public getActiveOrders(query?: { customerId?: string | null }): Observable<OrderDto[]> {
    let params = new HttpParams();

    if (query?.customerId) {
      params = params.set('customerId', query.customerId);
    }

    return this.http.get<OrderDto[]>(`${this.baseUrl}/active`, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching active orders:', error);
        return throwError(
          () => new Error(this.getErrorMessage(error, OrderService.MSG_FETCH_ORDERS_FAILED)),
        );
      }),
    );
  }

  public getOrderHistory(query?: { customerId?: string | null }): Observable<OrderHistoryDto[]> {
    let params = new HttpParams();

    if (query?.customerId) {
      params = params.set('customerId', query.customerId);
    }

    return this.http.get<OrderHistoryDto[]>(`${this.baseUrl}/history`, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching order history:', error);
        return throwError(
          () => new Error(this.getErrorMessage(error, OrderService.MSG_FETCH_ORDERS_FAILED)),
        );
      }),
    );
  }

  public getOrder(id: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_FETCH_ORDER_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
              }),
            ),
        );
      }),
    );
  }

  public createOrder(command: CreateOrderCommand): Observable<OrderDto> {
    return this.http.post<OrderDto>(this.baseUrl, command).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error creating order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_CREATE_ORDER_FAILED, {
                badRequest: OrderService.MSG_INVALID_ORDER_DATA,
              }),
            ),
        );
      }),
    );
  }

  /** Sends orders sold offline. Each gets its own result, so one bad order does not stop the others. */
  public syncOfflineOrders(commands: CreateOrderCommand[]): Observable<OfflineSyncResultDto[]> {
    return this.http
      .post<OfflineSyncResultDto[]>(`${this.baseUrl}/sync`, { orders: commands })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error syncing offline orders:', error);
          return throwError(
            () =>
              new Error(
                this.getErrorMessage(error, OrderService.MSG_SYNC_ORDERS_FAILED, {
                  badRequest: OrderService.MSG_INVALID_ORDER_BATCH_DATA,
                }),
              ),
          );
        }),
      );
  }

  public createOrdersBatch(commands: CreateOrderCommand[]): Observable<OrderDto[]> {
    return this.http.post<OrderDto[]>(`${this.baseUrl}/batch`, { orders: commands }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error creating order batch:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_SYNC_ORDERS_FAILED, {
                badRequest: OrderService.MSG_INVALID_ORDER_BATCH_DATA,
              }),
            ),
        );
      }),
    );
  }

  public updateOrder(command: UpdateOrderCommand): Observable<OrderDto> {
    return this.http.put<OrderDto>(`${this.baseUrl}/${command.id}`, command).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error updating order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_UPDATE_ORDER_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
                badRequest: OrderService.MSG_INVALID_ORDER_DATA,
              }),
            ),
        );
      }),
    );
  }

  public overrideOrder(command: UpdateOrderCommand): Observable<OrderDto> {
    return this.http.put<OrderDto>(`${this.baseUrl}/${command.id}/override`, command).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error overriding order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_OVERRIDE_ORDER_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
                badRequest: OrderService.MSG_INVALID_ORDER_DATA,
              }),
            ),
        );
      }),
    );
  }

  public voidOrder(id: string, note?: string | null): Observable<OrderDto> {
    return this.http.patch<OrderDto>(`${this.baseUrl}/${id}/void`, { note: note ?? null }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error voiding order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_VOID_ORDER_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
                badRequest: OrderService.MSG_ORDER_CANNOT_BE_VOIDED,
              }),
            ),
        );
      }),
    );
  }

  /** Accepts an order a customer placed through their link: it joins the normal flow as Pending. */
  public approveOrder(id: string): Observable<OrderDto> {
    return this.http.post<OrderDto>(`${this.baseUrl}/${id}/approve`, {}).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error approving order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_APPROVE_ORDER_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
                badRequest: OrderService.MSG_ORDER_NOT_WAITING,
              }),
            ),
        );
      }),
    );
  }

  /** An Admin approves a held offline order: it becomes Completed at the prices the customer was quoted. */
  public approveHeldOrder(id: string): Observable<OrderDto> {
    return this.http.post<OrderDto>(`${this.baseUrl}/${id}/review/approve`, {}).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error approving held order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_APPROVE_ORDER_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
                badRequest: OrderService.MSG_ORDER_NOT_WAITING,
              }),
            ),
        );
      }),
    );
  }

  /** An Admin turns down a held offline order; the reason is required. */
  public rejectHeldOrder(id: string, reason: string): Observable<OrderDto> {
    return this.http.post<OrderDto>(`${this.baseUrl}/${id}/review/reject`, { reason }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error rejecting held order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_REJECT_ORDER_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
                badRequest: OrderService.MSG_ORDER_NOT_WAITING,
              }),
            ),
        );
      }),
    );
  }

  /** An accepted customer order is ready for pickup or delivery; the customer sees it on their order. */
  public markOrderReady(id: string): Observable<OrderDto> {
    return this.http.post<OrderDto>(`${this.baseUrl}/${id}/ready`, {}).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error marking order ready:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_MARK_READY_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
                badRequest: OrderService.MSG_CANNOT_MARK_READY,
              }),
            ),
        );
      }),
    );
  }

  /** Turns an order down. The reason is required and is shown to the customer. */
  public rejectOrder(id: string, reason: string): Observable<OrderDto> {
    return this.http.post<OrderDto>(`${this.baseUrl}/${id}/reject`, { reason }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error rejecting order:', error);
        return throwError(
          () =>
            new Error(
              this.getErrorMessage(error, OrderService.MSG_REJECT_ORDER_FAILED, {
                notFound: OrderService.MSG_ORDER_NOT_FOUND,
                badRequest: OrderService.MSG_ORDER_NOT_WAITING,
              }),
            ),
        );
      }),
    );
  }

  private getErrorMessage(
    error: HttpErrorResponse,
    fallback: string,
    options?: { badRequest?: string; notFound?: string },
  ): string {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return OrderService.MSG_NETWORK_UNAVAILABLE;
    }

    const serverMessage = extractHttpErrorMessage(error);
    if (serverMessage) {
      return serverMessage;
    }

    if (error.status === 400 && options?.badRequest) {
      return options.badRequest;
    }

    if (error.status === 404 && options?.notFound) {
      return options.notFound;
    }

    return fallback;
  }
}
