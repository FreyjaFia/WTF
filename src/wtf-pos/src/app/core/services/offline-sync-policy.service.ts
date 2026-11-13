import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { OfflineSyncPolicyDto, SaveOfflineSyncPolicyDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class OfflineSyncPolicyService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly url = `${environment.apiUrl}/orders/sync-policy`;

  public get(): Observable<OfflineSyncPolicyDto> {
    return this.http
      .get<OfflineSyncPolicyDto>(this.url)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the offline sync policy.')));
  }

  public save(policy: SaveOfflineSyncPolicyDto): Observable<OfflineSyncPolicyDto> {
    return this.http
      .put<OfflineSyncPolicyDto>(this.url, policy)
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the offline sync policy.')));
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
