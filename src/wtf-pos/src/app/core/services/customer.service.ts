import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '@environments/environment.development';
import { CreateCustomerDto, CustomerDto, UpdateCustomerDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class CustomerService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/customers`;

  public getCustomers(query?: {
    searchTerm?: string | null;
    isActive?: boolean | null;
  }): Observable<CustomerDto[]> {
    let params = new HttpParams();

    if (query?.searchTerm) {
      params = params.set('searchTerm', query.searchTerm);
    }

    if (query?.isActive !== undefined && query?.isActive !== null) {
      params = params.set('isActive', String(query.isActive));
    }

    return this.http.get<CustomerDto[]>(this.baseUrl, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching customers:', error);

        const errorMessage =
          error.status === 403
            ? 'Not authorized.'
            : error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to fetch customers. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public getCustomer(id: string): Observable<CustomerDto> {
    return this.http.get<CustomerDto>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching customer:', error);

        const errorMessage =
          error.status === 404
            ? 'Customer not found.'
            : error.status === 403
              ? 'Not authorized.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to fetch customer. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public createCustomer(customer: CreateCustomerDto): Observable<CustomerDto> {
    return this.http.post<CustomerDto>(this.baseUrl, customer).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error creating customer:', error);

        const errorMessage =
          error.status === 403
            ? 'Not authorized.'
            : error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to create customer. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public updateCustomer(customer: UpdateCustomerDto): Observable<CustomerDto> {
    return this.http.put<CustomerDto>(`${this.baseUrl}/${customer.id}`, customer).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error updating customer:', error);

        const errorMessage =
          error.status === 404
            ? 'Customer not found.'
            : error.status === 403
              ? 'Not authorized.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to update customer. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public deleteCustomer(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting customer:', error);

        const errorMessage =
          error.status === 404
            ? 'Customer not found.'
            : error.status === 403
              ? 'Not authorized.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to delete customer. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public uploadCustomerImage(id: string, file: File): Observable<CustomerDto> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<CustomerDto>(`${this.baseUrl}/${id}/image`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error uploading customer image:', error);
        const errorMessage =
          error.status === 403
            ? 'Not authorized.'
            : error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to upload image. Please try again later.';
        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public deleteCustomerImage(id: string): Observable<CustomerDto> {
    return this.http.delete<CustomerDto>(`${this.baseUrl}/${id}/image`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting customer image:', error);
        const errorMessage =
          error.status === 404
            ? 'Customer or image not found.'
            : error.status === 403
              ? 'Not authorized.'
              : error.status === 0
                ? 'Unable to connect to server. Please check your connection.'
                : 'Failed to delete image. Please try again later.';
        return throwError(() => new Error(errorMessage));
      }),
    );
  }
}
