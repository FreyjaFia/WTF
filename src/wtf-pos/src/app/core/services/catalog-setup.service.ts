import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import {
  CatalogSetupDto,
  SaveAddOnTypeRequest,
  SaveCategoryRequest,
  SaveSubCategoryRequest,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { CatalogLookupService } from './catalog-lookup.service';
import { ConnectivityService } from './connectivity.service';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class CatalogSetupService {
  private readonly http = inject(HttpClient);
  private readonly lookups = inject(CatalogLookupService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/catalog`;

  public getSetup(): Observable<CatalogSetupDto> {
    return this.http.get<CatalogSetupDto>(this.baseUrl).pipe(
      tap((setup) => this.lookups.setFromSetup(setup)),
      catchError((error) => this.fail(error, 'Could not load the catalog lists.')),
    );
  }

  public saveCategory(id: number | null, body: SaveCategoryRequest): Observable<{ id: number }> {
    const request =
      id === null
        ? this.http.post<{ id: number }>(`${this.baseUrl}/categories`, body)
        : this.http.put<{ id: number }>(`${this.baseUrl}/categories/${id}`, body);
    return request.pipe(catchError((error) => this.fail(error, 'Could not save the category.')));
  }

  public setCategoryActive(id: number, isActive: boolean): Observable<void> {
    return this.http
      .put<void>(`${this.baseUrl}/categories/${id}/active`, { isActive })
      .pipe(catchError((error) => this.fail(error, 'Could not update the category.')));
  }

  public saveSubCategory(
    id: number | null,
    body: SaveSubCategoryRequest,
  ): Observable<{ id: number }> {
    const request =
      id === null
        ? this.http.post<{ id: number }>(`${this.baseUrl}/subcategories`, body)
        : this.http.put<{ id: number }>(`${this.baseUrl}/subcategories/${id}`, body);
    return request.pipe(
      catchError((error) => this.fail(error, 'Could not save the sub-category.')),
    );
  }

  public setSubCategoryActive(id: number, isActive: boolean): Observable<void> {
    return this.http
      .put<void>(`${this.baseUrl}/subcategories/${id}/active`, { isActive })
      .pipe(catchError((error) => this.fail(error, 'Could not update the sub-category.')));
  }

  public saveAddOnType(id: number | null, body: SaveAddOnTypeRequest): Observable<{ id: number }> {
    const request =
      id === null
        ? this.http.post<{ id: number }>(`${this.baseUrl}/addon-types`, body)
        : this.http.put<{ id: number }>(`${this.baseUrl}/addon-types/${id}`, body);
    return request.pipe(catchError((error) => this.fail(error, 'Could not save the add-on type.')));
  }

  public setAddOnTypeActive(id: number, isActive: boolean): Observable<void> {
    return this.http
      .put<void>(`${this.baseUrl}/addon-types/${id}/active`, { isActive })
      .pipe(catchError((error) => this.fail(error, 'Could not update the add-on type.')));
  }

  private fail(error: unknown, fallback: string): Observable<never> {
    if (error instanceof HttpErrorResponse && error.status === 0) {
      this.connectivity.checkNow();
      return throwError(() => new Error(HttpErrorMessages.NetworkUnavailable));
    }

    const message = error instanceof HttpErrorResponse ? extractHttpErrorMessage(error) : null;
    return throwError(() => new Error(message ?? fallback));
  }
}
