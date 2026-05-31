import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  AddInventoryStockDto,
  CreateInventoryItemDto,
  InventoryItemDto,
  UpdateInventoryItemDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/inventory`;

  public getInventoryItems(query?: {
    searchTerm?: string | null;
    isActive?: boolean | null;
    includeInactive?: boolean | null;
  }): Observable<InventoryItemDto[]> {
    let params = new HttpParams();

    if (query?.searchTerm) {
      params = params.set('searchTerm', query.searchTerm);
    }

    if (query?.isActive !== undefined && query.isActive !== null) {
      params = params.set('isActive', String(query.isActive));
    }

    if (query?.includeInactive !== undefined && query.includeInactive !== null) {
      params = params.set('includeInactive', String(query.includeInactive));
    }

    return this.http
      .get<InventoryItemDto[]>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch inventory items.')));
  }

  public createInventoryItem(payload: CreateInventoryItemDto): Observable<InventoryItemDto> {
    return this.http
      .post<InventoryItemDto>(this.baseUrl, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to create inventory item.')));
  }

  public getInventoryItem(id: string): Observable<InventoryItemDto> {
    return this.http
      .get<InventoryItemDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch inventory item.')));
  }

  public updateInventoryItem(payload: UpdateInventoryItemDto): Observable<InventoryItemDto> {
    return this.http
      .put<InventoryItemDto>(`${this.baseUrl}/${payload.id}`, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to update inventory item.')));
  }

  public addStock(payload: AddInventoryStockDto): Observable<InventoryItemDto> {
    return this.http
      .post<InventoryItemDto>(`${this.baseUrl}/${payload.inventoryItemId}/stock`, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to add stock.')));
  }

  public deleteInventoryItem(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to delete inventory item.')));
  }

  private handleError(error: HttpErrorResponse, fallback: string) {
    console.error('Inventory API error:', error);
    const serverMessage = extractHttpErrorMessage(error);
    const message =
      error.status === 0 ? this.getNetworkErrorMessage() : serverMessage ? serverMessage : fallback;

    return throwError(() => new Error(message));
  }

  private getNetworkErrorMessage(): string {
    this.connectivity.checkNow();
    return 'Network unavailable. Please check your connection.';
  }
}
