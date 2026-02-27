import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { AppRole, AppRoleGroups, AppRoleLabels, AppRoles } from '@shared/constants/app-roles';
import { LoginDto, MeDto } from '@shared/models';
import { BehaviorSubject, Observable, Subject, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { db } from './db';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private static readonly MSG_REQUIRED_CREDENTIALS = ServiceErrorMessages.Auth.RequiredCredentials;
  private static readonly MSG_LOGIN_FAILED = ServiceErrorMessages.Auth.LoginFailed;
  private static readonly MSG_INVALID_CREDENTIALS = ServiceErrorMessages.Auth.InvalidCredentials;
  private static readonly MSG_SERVER_ERROR = ServiceErrorMessages.Auth.ServerError;
  private static readonly MSG_UNAUTHORIZED = HttpErrorMessages.Unauthorized;
  private static readonly MSG_INVALID_PASSWORD = ServiceErrorMessages.Auth.InvalidPassword;
  private static readonly MSG_FETCH_PROFILE_FAILED = ServiceErrorMessages.Auth.FetchProfileFailed;
  private static readonly MSG_UPDATE_PROFILE_FAILED = ServiceErrorMessages.Auth.UpdateProfileFailed;
  private static readonly MSG_UPLOAD_IMAGE_FAILED = ServiceErrorMessages.Auth.UploadImageFailed;
  private static readonly MSG_INVALID_FILE = HttpErrorMessages.InvalidFile;
  private static readonly MSG_NO_REFRESH_TOKEN = ServiceErrorMessages.Auth.NoRefreshToken;
  private static readonly MSG_REFRESH_TOKEN_FAILED = ServiceErrorMessages.Auth.RefreshTokenFailed;
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;

  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/auth`;
  private _isLoggedIn = new BehaviorSubject<boolean>(!!localStorage.getItem('token'));
  private readonly rolesSubject = new BehaviorSubject<string[]>([]);
  private readonly meRefreshSubject = new Subject<void>();
  public readonly isLoggedIn$ = this._isLoggedIn.asObservable();
  public readonly roles$ = this.rolesSubject.asObservable();
  public readonly meRefresh$ = this.meRefreshSubject.asObservable();

  constructor() {
    this.syncRolesFromToken();
  }

  public login(username: string, password: string): Observable<boolean> {
    if (!username || !password) {
      return throwError(() => new Error(AuthService.MSG_REQUIRED_CREDENTIALS));
    }

    return this.http.post<LoginDto>(`${this.baseUrl}/login`, { username, password }).pipe(
      tap((res) => {
        if (res?.accessToken) {
          localStorage.setItem('token', res.accessToken);

          if (res?.refreshToken) {
            localStorage.setItem('refreshToken', res.refreshToken);
          }

          this._isLoggedIn.next(true);
          this.syncRolesFromToken();
        }
      }),
      map((res) => {
        const hasToken = !!res?.accessToken;

        if (!hasToken) {
          console.warn('Login response missing accessToken:', res);
        }

        return hasToken;
      }),
      catchError((error: HttpErrorResponse) => {
        console.error('Login error:', error);
        console.error('Error status:', error.status);
        console.error('Error message:', error.message);

        let errorMessage: string = AuthService.MSG_LOGIN_FAILED;

        if (error.status === 401 || error.status === 400) {
          errorMessage = AuthService.MSG_INVALID_CREDENTIALS;
        } else if (error.status === 0) {
          errorMessage = AuthService.MSG_NETWORK_UNAVAILABLE;
        } else if (error.status >= 500) {
          errorMessage = AuthService.MSG_SERVER_ERROR;
        } else if (error.error?.message) {
          errorMessage = error.error.message;
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public getMe(): Observable<MeDto> {
    return this.http.get<MeDto>(`${this.baseUrl}/me`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Get me error:', error);

        const errorMessage =
          error.status === 401
            ? AuthService.MSG_UNAUTHORIZED
            : error.status === 0
              ? AuthService.MSG_NETWORK_UNAVAILABLE
              : AuthService.MSG_FETCH_PROFILE_FAILED;

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public updateMe(password: string): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/me`, { password }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Update me error:', error);

        let errorMessage: string = AuthService.MSG_UPDATE_PROFILE_FAILED;

        if (error.status === 401) {
          errorMessage = AuthService.MSG_UNAUTHORIZED;
        } else if (error.status === 400) {
          errorMessage = AuthService.MSG_INVALID_PASSWORD;
        } else if (error.status === 0) {
          errorMessage = AuthService.MSG_NETWORK_UNAVAILABLE;
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public uploadMeImage(file: File): Observable<{ imageUrl?: string | null }> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.put<{ imageUrl?: string | null }>(`${this.baseUrl}/me/image`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Upload profile image error:', error);

        let errorMessage: string = AuthService.MSG_UPLOAD_IMAGE_FAILED;

        if (error.status === 400) {
          errorMessage = AuthService.MSG_INVALID_FILE;
        } else if (error.status === 401) {
          errorMessage = AuthService.MSG_UNAUTHORIZED;
        } else if (error.status === 0) {
          errorMessage = AuthService.MSG_NETWORK_UNAVAILABLE;
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public notifyMeUpdated(): void {
    this.meRefreshSubject.next();
  }

  public logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    this._isLoggedIn.next(false);
    this.rolesSubject.next([]);
    db.carts.clear();
  }

  public getToken(): string | null {
    return localStorage.getItem('token');
  }

  public getRefreshToken(): string | null {
    return localStorage.getItem('refreshToken');
  }

  public isTokenExpired(): boolean {
    const token = this.getToken();

    if (!token) {
      return true;
    }

    try {
      const decoded = this.decodeToken(token);

      if (!decoded || !decoded['exp'] || typeof decoded['exp'] !== 'number') {
        return true;
      }

      const exp = decoded['exp'] as number;

      // Current time in seconds
      const currentTime = Math.floor(Date.now() / 1000);
      // Refresh token 5 minutes before expiration
      const expirationThreshold = exp - 5 * 60;

      return currentTime >= expirationThreshold;
    } catch {
      console.error('Error decoding token');
      return true;
    }
  }

  public isTokenValid(): boolean {
    const token = this.getToken();

    if (!token) {
      return false;
    }

    try {
      const decoded = this.decodeToken(token);

      if (!decoded || !decoded['exp'] || typeof decoded['exp'] !== 'number') {
        return false;
      }

      const exp = decoded['exp'] as number;
      const currentTime = Math.floor(Date.now() / 1000);
      return currentTime < exp;
    } catch {
      console.error('Error validating token');
      return false;
    }
  }

  public refreshToken(): Observable<boolean> {
    const refreshToken = this.getRefreshToken();

    if (!refreshToken) {
      return throwError(() => new Error(AuthService.MSG_NO_REFRESH_TOKEN));
    }

    return this.http
      .post<{
        accessToken: string;
        refreshToken?: string;
      }>(`${this.baseUrl}/refresh`, { refreshToken })
      .pipe(
        tap((res) => {
          if (res?.accessToken) {
            localStorage.setItem('token', res.accessToken);

            if (res?.refreshToken) {
              localStorage.setItem('refreshToken', res.refreshToken);
            }

            this._isLoggedIn.next(true);
            this.syncRolesFromToken();
          }
        }),
        map((res) => !!res?.accessToken),
        catchError((error: HttpErrorResponse) => {
          console.error('Token refresh error:', error);
          // If refresh fails, logout the user
          this.logout();
          return throwError(() => new Error(AuthService.MSG_REFRESH_TOKEN_FAILED));
        }),
      );
  }

  private decodeToken(token: string): Record<string, unknown> | null {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join(''),
      );

      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  public isAuthenticated(): boolean {
    return this._isLoggedIn.value || !!this.getToken();
  }

  public canReadCustomers(): boolean {
    return this.hasAnyRole(AppRoleGroups.CustomersRead);
  }

  public canWriteCustomers(): boolean {
    return this.hasAnyRole(AppRoleGroups.CustomersWrite);
  }

  public canAccessManagement(): boolean {
    return this.hasAnyRole(AppRoleGroups.ManagementRead);
  }

  public canWriteManagement(): boolean {
    return this.hasAnyRole(AppRoleGroups.ManagementWrite);
  }

  public isSuperAdmin(): boolean {
    return this.hasAnyRole(AppRoleGroups.AuditRead);
  }

  public canAccessAuditLogs(): boolean {
    return this.hasAnyRole(AppRoleGroups.AuditRead);
  }

  public canAccessSchemaScriptHistory(): boolean {
    return this.hasAnyRole(AppRoleGroups.SchemaScriptHistoryRead);
  }

  public canCreateCustomerInOrder(isEditMode: boolean): boolean {
    if (this.hasAnyRole(AppRoleGroups.CustomersWrite)) {
      return true;
    }

    return !isEditMode && this.hasAnyRole([AppRoles.Cashier]);
  }

  public canManageOrders(): boolean {
    return this.hasAnyRole(AppRoleGroups.OrdersManage);
  }

  public getCurrentRoleLabel(): string {
    const prioritizedRoles: readonly AppRole[] = [
      AppRoles.SuperAdmin,
      AppRoles.Admin,
      AppRoles.AdminViewer,
      AppRoles.Cashier,
    ];

    const matchedRole = prioritizedRoles.find((role) => this.hasRole(role));
    if (matchedRole) {
      return AppRoleLabels[matchedRole];
    }

    return 'Unknown';
  }

  public hasAnyRole(requiredRoles: readonly AppRole[]): boolean {
    return requiredRoles.some((role) => this.hasRole(role));
  }

  private syncRolesFromToken(): void {
    const token = this.getToken();
    if (!token) {
      this.rolesSubject.next([]);
      return;
    }

    const decoded = this.decodeToken(token);
    const roles = this.extractRoles(decoded);
    this.rolesSubject.next(roles);
  }

  private extractRoles(decoded: Record<string, unknown> | null): string[] {
    if (!decoded) {
      return [];
    }

    const rawRoleClaims: unknown[] = [];
    const roleClaimKeys = [
      'role',
      'roles',
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
    ];

    for (const key of roleClaimKeys) {
      const value = decoded[key];
      if (Array.isArray(value)) {
        rawRoleClaims.push(...value);
      } else if (value !== undefined && value !== null) {
        rawRoleClaims.push(value);
      }
    }

    const normalized = rawRoleClaims
      .map((role) => (typeof role === 'string' ? role.trim() : ''))
      .filter((role) => !!role);

    return Array.from(new Set(normalized));
  }

  private hasRole(role: AppRole): boolean {
    const normalizedRole = this.normalizeRole(role);
    const roleAliases = new Set<string>([normalizedRole]);

    if (normalizedRole === 'superadmin') {
      roleAliases.add('super admin');
    }

    if (normalizedRole === 'adminviewer') {
      roleAliases.add('admin viewer');
    }

    const currentRoles = this.rolesSubject.value.map((r) => this.normalizeRole(r));
    return currentRoles.some((r) => roleAliases.has(r));
  }

  private normalizeRole(role: string): string {
    return role.trim().toLowerCase();
  }
}
