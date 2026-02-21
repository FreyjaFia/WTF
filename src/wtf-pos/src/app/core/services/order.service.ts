import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '@environments/environment.development';
import { CreateOrderCommand, OrderDto, OrderStatusEnum, UpdateOrderCommand } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly http = inject(HttpClient);
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

        const errorMessage =
          error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to fetch orders. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public getOrder(id: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching order:', error);

        const errorMessage =
          error.status === 404
            ? 'Order not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to fetch order. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public createOrder(command: CreateOrderCommand): Observable<OrderDto> {
    return this.http.post<OrderDto>(this.baseUrl, command).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error creating order:', error);

        const errorMessage =
          error.status === 400
            ? 'Invalid order data. Please check your input.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to create order. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public updateOrder(command: UpdateOrderCommand): Observable<OrderDto> {
    return this.http.put<OrderDto>(`${this.baseUrl}/${command.id}`, command).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error updating order:', error);

        const errorMessage =
          error.status === 404
            ? 'Order not found.'
            : error.status === 400
              ? 'Invalid order data. Please check your input.'
              : error.status === 0
                ? 'Unable to connect to server. Please check your connection.'
                : 'Failed to update order. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public voidOrder(id: string): Observable<OrderDto> {
    return this.http.patch<OrderDto>(`${this.baseUrl}/${id}/void`, {}).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error voiding order:', error);

        const errorMessage =
          error.status === 404
            ? 'Order not found.'
            : error.status === 400
              ? 'This order cannot be voided.'
              : error.status === 0
                ? 'Unable to connect to server. Please check your connection.'
                : 'Failed to void order. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }
}
