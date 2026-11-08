import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  ItemSupplierDto,
  SaveItemSupplierDto,
  SupplierDto,
  SupplierFieldsDto,
  SupplierSummaryDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class SupplierService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/suppliers`;
  private readonly itemsUrl = `${environment.apiUrl}/items`;

  public getSuppliers(query?: {
    includeInactive?: boolean;
    search?: string | null;
  }): Observable<SupplierSummaryDto[]> {
    let params = new HttpParams();
    if (query?.includeInactive) {
      params = params.set('includeInactive', 'true');
    }

    if (query?.search) {
      params = params.set('search', query.search);
    }

    return this.http
      .get<SupplierSummaryDto[]>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the suppliers.')));
  }

  public getSupplier(id: string): Observable<SupplierDto> {
    return this.http
      .get<SupplierDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the supplier.')));
  }

  public createSupplier(fields: SupplierFieldsDto): Observable<SupplierDto> {
    return this.http
      .post<SupplierDto>(this.baseUrl, fields)
      .pipe(catchError((error) => this.handleError(error, 'Unable to create the supplier.')));
  }

  public updateSupplier(id: string, fields: SupplierFieldsDto): Observable<SupplierDto> {
    return this.http
      .put<SupplierDto>(`${this.baseUrl}/${id}`, fields)
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the supplier.')));
  }

  public deactivateSupplier(id: string): Observable<SupplierDto> {
    return this.http
      .post<SupplierDto>(`${this.baseUrl}/${id}/deactivate`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to deactivate the supplier.')));
  }

  public restoreSupplier(id: string): Observable<SupplierDto> {
    return this.http
      .post<SupplierDto>(`${this.baseUrl}/${id}/restore`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to restore the supplier.')));
  }

  public getItemSuppliers(itemId: string): Observable<ItemSupplierDto[]> {
    return this.http
      .get<ItemSupplierDto[]>(`${this.itemsUrl}/${itemId}/suppliers`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the item suppliers.')));
  }

  public saveItemSupplier(
    itemId: string,
    supplierId: string,
    payload: SaveItemSupplierDto,
  ): Observable<ItemSupplierDto[]> {
    return this.http
      .put<ItemSupplierDto[]>(`${this.itemsUrl}/${itemId}/suppliers/${supplierId}`, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the supplier link.')));
  }

  public removeItemSupplier(itemId: string, supplierId: string): Observable<ItemSupplierDto[]> {
    return this.http
      .delete<ItemSupplierDto[]>(`${this.itemsUrl}/${itemId}/suppliers/${supplierId}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to remove the supplier link.')));
  }

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
    const serverMessage = extractHttpErrorMessage(error);
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    const message =
      error.status === 0 ? HttpErrorMessages.NetworkUnavailable : serverMessage || fallback;
    return throwError(() => new Error(message));
  }
}
