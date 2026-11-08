import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { ParLevelRowDto, ReorderListDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class ReorderService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/reorder`;

  public getReorderList(): Observable<ReorderListDto> {
    return this.http
      .get<ReorderListDto>(this.baseUrl)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the reorder list.')));
  }

  public getParLevels(): Observable<ParLevelRowDto[]> {
    return this.http
      .get<ParLevelRowDto[]>(`${this.baseUrl}/par-levels`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the par levels.')));
  }

  public setParLevel(itemId: string, parLevel: number | null): Observable<ParLevelRowDto> {
    return this.http
      .put<ParLevelRowDto>(`${this.baseUrl}/par-levels/${itemId}`, { parLevel })
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the par level.')));
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
