import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { PermissionPlanDto, RoleDetailDto, RoleDto, SaveRoleDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/roles`;

  public getRoles(): Observable<RoleDto[]> {
    return this.http
      .get<RoleDto[]>(this.baseUrl)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the roles.')));
  }

  public getPermissionPlans(): Observable<PermissionPlanDto[]> {
    return this.http
      .get<PermissionPlanDto[]>(`${this.baseUrl}/permissions`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the plan details.')));
  }

  public getRole(id: number): Observable<RoleDetailDto> {
    return this.http
      .get<RoleDetailDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the role.')));
  }

  public createRole(dto: SaveRoleDto): Observable<RoleDetailDto> {
    return this.http
      .post<RoleDetailDto>(this.baseUrl, dto)
      .pipe(catchError((error) => this.handleError(error, 'Unable to create the role.')));
  }

  public updateRole(id: number, dto: SaveRoleDto): Observable<RoleDetailDto> {
    return this.http
      .put<RoleDetailDto>(`${this.baseUrl}/${id}`, { id, ...dto })
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the role.')));
  }

  public duplicateRole(id: number): Observable<RoleDetailDto> {
    return this.http
      .post<RoleDetailDto>(`${this.baseUrl}/${id}/duplicate`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to duplicate the role.')));
  }

  public deleteRole(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to delete the role.')));
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
