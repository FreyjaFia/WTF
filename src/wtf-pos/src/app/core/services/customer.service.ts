import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { CreateCustomerDto, CustomerDto, UpdateCustomerDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class CustomerService {
  private static readonly MSG_NOT_AUTHORIZED = HttpErrorMessages.NotAuthorized;
  private static readonly MSG_CUSTOMER_NOT_FOUND = ServiceErrorMessages.Customer.CustomerNotFound;
  private static readonly MSG_CUSTOMER_OR_IMAGE_NOT_FOUND =
    ServiceErrorMessages.Customer.CustomerOrImageNotFound;
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_FETCH_CUSTOMERS_FAILED = ServiceErrorMessages.Customer.FetchCustomersFailed;
  private static readonly MSG_FETCH_CUSTOMER_FAILED = ServiceErrorMessages.Customer.FetchCustomerFailed;
  private static readonly MSG_CREATE_CUSTOMER_FAILED = ServiceErrorMessages.Customer.CreateCustomerFailed;
  private static readonly MSG_UPDATE_CUSTOMER_FAILED = ServiceErrorMessages.Customer.UpdateCustomerFailed;
  private static readonly MSG_DELETE_CUSTOMER_FAILED = ServiceErrorMessages.Customer.DeleteCustomerFailed;
  private static readonly MSG_UPLOAD_IMAGE_FAILED = ServiceErrorMessages.Customer.UploadImageFailed;
  private static readonly MSG_DELETE_IMAGE_FAILED = ServiceErrorMessages.Customer.DeleteImageFailed;

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
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
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, {
              fallback: CustomerService.MSG_FETCH_CUSTOMERS_FAILED,
              forbidden: CustomerService.MSG_NOT_AUTHORIZED,
            }),
          ),
        );
      }),
    );
  }

  public getCustomer(id: string): Observable<CustomerDto> {
    return this.http.get<CustomerDto>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching customer:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, {
              fallback: CustomerService.MSG_FETCH_CUSTOMER_FAILED,
              forbidden: CustomerService.MSG_NOT_AUTHORIZED,
              notFound: CustomerService.MSG_CUSTOMER_NOT_FOUND,
            }),
          ),
        );
      }),
    );
  }

  public createCustomer(customer: CreateCustomerDto): Observable<CustomerDto> {
    return this.http.post<CustomerDto>(this.baseUrl, customer).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error creating customer:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, {
              fallback: CustomerService.MSG_CREATE_CUSTOMER_FAILED,
              forbidden: CustomerService.MSG_NOT_AUTHORIZED,
            }),
          ),
        );
      }),
    );
  }

  public updateCustomer(customer: UpdateCustomerDto): Observable<CustomerDto> {
    return this.http.put<CustomerDto>(`${this.baseUrl}/${customer.id}`, customer).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error updating customer:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, {
              fallback: CustomerService.MSG_UPDATE_CUSTOMER_FAILED,
              forbidden: CustomerService.MSG_NOT_AUTHORIZED,
              notFound: CustomerService.MSG_CUSTOMER_NOT_FOUND,
            }),
          ),
        );
      }),
    );
  }

  public deleteCustomer(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting customer:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, {
              fallback: CustomerService.MSG_DELETE_CUSTOMER_FAILED,
              forbidden: CustomerService.MSG_NOT_AUTHORIZED,
              notFound: CustomerService.MSG_CUSTOMER_NOT_FOUND,
            }),
          ),
        );
      }),
    );
  }

  public uploadCustomerImage(id: string, file: File): Observable<CustomerDto> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<CustomerDto>(`${this.baseUrl}/${id}/image`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error uploading customer image:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, {
              fallback: CustomerService.MSG_UPLOAD_IMAGE_FAILED,
              forbidden: CustomerService.MSG_NOT_AUTHORIZED,
            }),
          ),
        );
      }),
    );
  }

  public deleteCustomerImage(id: string): Observable<CustomerDto> {
    return this.http.delete<CustomerDto>(`${this.baseUrl}/${id}/image`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting customer image:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, {
              fallback: CustomerService.MSG_DELETE_IMAGE_FAILED,
              forbidden: CustomerService.MSG_NOT_AUTHORIZED,
              notFound: CustomerService.MSG_CUSTOMER_OR_IMAGE_NOT_FOUND,
            }),
          ),
        );
      }),
    );
  }

  private getErrorMessage(
    error: HttpErrorResponse,
    options: { fallback: string; forbidden?: string; notFound?: string },
  ): string {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return CustomerService.MSG_NETWORK_UNAVAILABLE;
    }

    if (error.status === 403) {
      return options.forbidden ?? CustomerService.MSG_NOT_AUTHORIZED;
    }

    if (error.status === 404 && options.notFound) {
      return options.notFound;
    }

    return options.fallback;
  }
}
