import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '@environments/environment.development';
import { DashboardDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/dashboard`;

  public getDashboard(): Observable<DashboardDto> {
    return this.http.get<DashboardDto>(this.baseUrl).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching dashboard:', error);

        const errorMessage =
          error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to load dashboard. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }
}
