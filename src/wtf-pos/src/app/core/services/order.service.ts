import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import {
  CreateOrderCommand,
  OrderDto,
  OrderHistoryDto,
  OrderStatusEnum,
  PagedResultDto,
  UpdateOrderCommand,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
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
