import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import { SchemaScriptHistoryDto } from '@shared/models';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SchemaScriptHistoryService {
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_FETCH_FAILED =
    'Failed to fetch executed schema scripts. Please try again later.';

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/schema-script-history`;

  public getExecutedScripts(): Observable<SchemaScriptHistoryDto[]> {
    return this.http.get<SchemaScriptHistoryDto[]>(this.baseUrl).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching schema script history:', error);
        if (error.status === 0) {
          this.connectivity.checkNow();
          return throwError(() => new Error(SchemaScriptHistoryService.MSG_NETWORK_UNAVAILABLE));
        }

        return throwError(() => new Error(SchemaScriptHistoryService.MSG_FETCH_FAILED));
      }),
    );
  }
}
