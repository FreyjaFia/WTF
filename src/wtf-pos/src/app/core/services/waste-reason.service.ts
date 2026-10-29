import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { SaveWasteReasonDto, WasteReasonDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class WasteReasonService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/waste-reasons`;

  public getReasons(includeInactive = false): Observable<WasteReasonDto[]> {
    const params = new HttpParams().set('includeInactive', String(includeInactive));
    return this.http
      .get<WasteReasonDto[]>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the waste reasons.')));
  }

  public createReason(dto: SaveWasteReasonDto): Observable<WasteReasonDto> {
    return this.http
      .post<WasteReasonDto>(this.baseUrl, dto)
      .pipe(catchError((error) => this.handleError(error, 'Unable to add the waste reason.')));
  }

  public updateReason(id: number, dto: SaveWasteReasonDto): Observable<WasteReasonDto> {
    return this.http
      .put<WasteReasonDto>(`${this.baseUrl}/${id}`, dto)
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the waste reason.')));
  }

  public deactivateReason(id: number): Observable<WasteReasonDto> {
    return this.http
      .post<WasteReasonDto>(`${this.baseUrl}/${id}/deactivate`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to turn off the waste reason.')));
  }

  public restoreReason(id: number): Observable<WasteReasonDto> {
    return this.http
      .post<WasteReasonDto>(`${this.baseUrl}/${id}/restore`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to restore the waste reason.')));
  }

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
    const serverMessage = extractHttpErrorMessage(error);
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    const message =
      error.status === 0
        ? 'Network unavailable. Please check your connection.'
        : serverMessage || fallback;
    return throwError(() => new Error(message));
  }
}
