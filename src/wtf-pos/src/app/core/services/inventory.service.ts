import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  AddItemStockDto,
  AdjustItemStockDto,
  CreateItemDto,
  ItemAlertRecipientsDto,
  ItemDto,
  OrderStockMovementDto,
  PagedStockMovementsDto,
  ProductItemLinkAssignmentDto,
  ProductItemLinkDto,
  RecipeCostDto,
  StockCoverageDto,
  UpdateItemDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/items`;

  public getInventoryItems(query?: {
    searchTerm?: string | null;
    isActive?: boolean | null;
    includeInactive?: boolean | null;
  }): Observable<ItemDto[]> {
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
      .get<ItemDto[]>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch items.')));
  }

  public createInventoryItem(payload: CreateItemDto): Observable<ItemDto> {
    return this.http
      .post<ItemDto>(this.baseUrl, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to create item.')));
  }

  public getInventoryItem(id: string): Observable<ItemDto> {
    return this.http
      .get<ItemDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch item.')));
  }

  public updateInventoryItem(payload: UpdateItemDto): Observable<ItemDto> {
    return this.http
      .put<ItemDto>(`${this.baseUrl}/${payload.id}`, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to update item.')));
  }

  public addStock(payload: AddItemStockDto): Observable<ItemDto> {
    return this.http
      .post<ItemDto>(`${this.baseUrl}/${payload.itemId}/stock`, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to add stock.')));
  }

  public adjustStock(payload: AdjustItemStockDto): Observable<ItemDto> {
    return this.http
      .post<ItemDto>(`${this.baseUrl}/${payload.itemId}/stock/adjust`, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to adjust stock.')));
  }

  public getItemMovements(
    itemId: string,
    query?: { type?: string | null; page?: number; pageSize?: number },
  ): Observable<PagedStockMovementsDto> {
    let params = new HttpParams();
    if (query?.type) {
      params = params.set('type', query.type);
    }
    if (query?.page) {
      params = params.set('page', String(query.page));
    }
    if (query?.pageSize) {
      params = params.set('pageSize', String(query.pageSize));
    }

    return this.http
      .get<PagedStockMovementsDto>(`${this.baseUrl}/${itemId}/movements`, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch stock history.')));
  }

  public getAlertRecipients(itemId: string): Observable<ItemAlertRecipientsDto> {
    return this.http
      .get<ItemAlertRecipientsDto>(`${this.baseUrl}/${itemId}/alert-recipients`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the alert recipients.')));
  }

  public setAlertRecipients(itemId: string, userIds: string[]): Observable<ItemAlertRecipientsDto> {
    return this.http
      .put<ItemAlertRecipientsDto>(`${this.baseUrl}/${itemId}/alert-recipients`, { userIds })
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the alert recipients.')));
  }

  public getStockCoverage(): Observable<StockCoverageDto> {
    return this.http
      .get<StockCoverageDto>(`${this.baseUrl}/coverage`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch stock coverage.')));
  }

  public getOrderStockMovements(orderId: string): Observable<OrderStockMovementDto[]> {
    return this.http
      .get<OrderStockMovementDto[]>(`${environment.apiUrl}/orders/${orderId}/stock-movements`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the stock movements.')));
  }

  public linkProductToItem(
    productId: string,
    itemId: string,
    quantityPerSale: number,
  ): Observable<ProductItemLinkDto> {
    return this.http
      .post<ProductItemLinkDto>(`${this.baseUrl}/product-links`, { productId, itemId, quantityPerSale })
      .pipe(catchError((error) => this.handleError(error, 'Unable to link the product to stock.')));
  }

  public assignProductItemLinks(
    itemId: string,
    productLinks: ProductItemLinkAssignmentDto[],
  ): Observable<ItemDto> {
    return this.http
      .put<ItemDto>(`${this.baseUrl}/${itemId}/product-links`, { itemId, productLinks })
      .pipe(catchError((error) => this.handleError(error, 'Unable to update item links.')));
  }

  public getProductRecipeCost(productId: string): Observable<RecipeCostDto> {
    return this.http
      .get<RecipeCostDto>(`${environment.apiUrl}/products/${productId}/recipe-cost`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the recipe cost.')));
  }

  public deleteInventoryItem(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to delete item.')));
  }

  public restoreInventoryItem(id: string): Observable<void> {
    return this.http
      .post<void>(`${this.baseUrl}/${id}/restore`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to restore item.')));
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
