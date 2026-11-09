import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { AppRole, AppRoleLabels, AppRoles } from '@shared/constants/app-roles';
import {
  ManagementMenuPermissions,
  PermissionKey,
  Permissions,
  SetupPermissions,
  SystemRolePermissions,
} from '@shared/permissions';
import { LoginDto, MeDto } from '@shared/models';
import { BehaviorSubject, Observable, Subject, throwError } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { db } from './db';
import {
  currentTenantId,
  DEFAULT_TENANT_ID,
  readDeviceTenantId,
  saveDeviceTenantId,
} from './tenant-context';

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
  private readonly tokenRefreshedSubject = new Subject<void>();
  private refreshRequest$: Observable<boolean> | null = null;
  public readonly isLoggedIn$ = this._isLoggedIn.asObservable();
  public readonly roles$ = this.rolesSubject.asObservable();
  public readonly meRefresh$ = this.meRefreshSubject.asObservable();
  public readonly tokenRefreshed$ = this.tokenRefreshedSubject.asObservable();

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

          this.clearLocalDataWhenTheShopChanged();
          this._isLoggedIn.next(true);
          this.syncRolesFromToken();
          this.tokenRefreshedSubject.next();
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

        if (error.status === 400 && typeof error.error?.message === 'string' && error.error.message) {
          // The API explains why (for example, the shop is suspended); only a plain 401 means a wrong username or password.
          errorMessage = error.error.message;
        } else if (error.status === 401 || error.status === 400) {
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

  public updateMe(password: string, currentPassword: string): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/me`, { password, currentPassword }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Update me error:', error);

        let errorMessage: string = AuthService.MSG_UPDATE_PROFILE_FAILED;

        if (error.status === 401) {
          errorMessage = AuthService.MSG_UNAUTHORIZED;
        } else if (error.status === 400) {
          // The server says which rule failed (wrong current password, new password too short).
          errorMessage = error.error?.message ?? AuthService.MSG_INVALID_PASSWORD;
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

  private clearLocalDataWhenTheShopChanged(): void {
    const tenantId = currentTenantId();
    const previous = readDeviceTenantId() ?? DEFAULT_TENANT_ID;

    if (previous !== tenantId) {
      // Another shop signed in on this device: its menu, prices, images and cart must never show here.
      // Orders still waiting to sync stay queued, marked with their own shop, and only that shop's login sends them.
      void Promise.all([db.carts.clear(), db.catalog.clear(), db.images.clear()]);
    }

    saveDeviceTenantId(tenantId);
  }

  public logout(): void {
    localStorage.removeItem('impersonation');
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
    if (this.refreshRequest$) {
      return this.refreshRequest$;
    }

    const refreshToken = this.getRefreshToken();

    if (!refreshToken) {
      return throwError(() => new Error(AuthService.MSG_NO_REFRESH_TOKEN));
    }

    this.refreshRequest$ = this.http
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
            this.tokenRefreshedSubject.next();
          }
        }),
        map((res) => !!res?.accessToken),
        catchError((error: HttpErrorResponse) => {
          console.error('Token refresh error:', error);
          // If refresh fails, logout the user
          this.logout();
          return throwError(() => new Error(AuthService.MSG_REFRESH_TOKEN_FAILED));
        }),
        finalize(() => {
          this.refreshRequest$ = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    return this.refreshRequest$;
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
    return this.can(Permissions.CustomersRead);
  }

  public canWriteCustomers(): boolean {
    return this.can(Permissions.CustomersWrite);
  }

  public canReadProducts(): boolean {
    return this.can(Permissions.ProductsRead);
  }

  public canWriteProducts(): boolean {
    return this.can(Permissions.ProductsWrite);
  }

  public canReadUsers(): boolean {
    return this.can(Permissions.UsersRead);
  }

  public canWriteUsers(): boolean {
    return this.can(Permissions.UsersWrite);
  }

  public canReadPromotions(): boolean {
    return this.can(Permissions.PromotionsRead);
  }

  public canWritePromotions(): boolean {
    return this.can(Permissions.PromotionsWrite);
  }

  public canReadManagement(): boolean {
    return this.can(Permissions.DashboardRead);
  }

  public canOpenManagementMenu(): boolean {
    return this.canAny(ManagementMenuPermissions);
  }

  public canOpenSetup(): boolean {
    return this.canAny(SetupPermissions);
  }

  public canReadSuppliers(): boolean {
    return this.can(Permissions.SuppliersRead);
  }

  public canWriteSuppliers(): boolean {
    return this.can(Permissions.SuppliersWrite);
  }

  public canWriteManagement(): boolean {
    return (
      this.canWriteProducts() ||
      this.canWriteCustomers() ||
      this.canWriteUsers() ||
      this.canWritePromotions()
    );
  }

  public canAccessReports(): boolean {
    return this.can(Permissions.ReportsRead);
  }

  public isOwner(): boolean {
    return this.hasRole(AppRoles.Owner);
  }

  public canAccessAuditLogs(): boolean {
    return this.can(Permissions.AuditRead);
  }

  public canAccessSchemaScriptHistory(): boolean {
    return this.can(Permissions.SchemaScriptsRead);
  }

  public canCreateCustomerInOrder(_isEditMode: boolean): boolean {
    return this.can(Permissions.CustomersWrite);
  }

  public canReadOrders(): boolean {
    return this.can(Permissions.OrdersRead);
  }

  public canWriteOrders(): boolean {
    return this.can(Permissions.OrdersWrite);
  }

  public canManageOrderLinks(): boolean {
    return this.can(Permissions.OrderLinksManage);
  }

  public canGenerateReports(): boolean {
    return this.can(Permissions.ReportsGenerate);
  }

  public canOverrideOrders(): boolean {
    return this.can(Permissions.OrdersOverride);
  }

  public canReadInventory(): boolean {
    return this.canReadItems() || this.canReadStockMovements();
  }

  public canWriteInventory(): boolean {
    return this.canWriteItems() || this.canWriteStockMovements();
  }

  public canReadItems(): boolean {
    return this.can(Permissions.ItemsRead);
  }

  public canWriteItems(): boolean {
    return this.can(Permissions.ItemsWrite);
  }

  public canReadInventoryCosts(): boolean {
    return this.can(Permissions.InventoryCostsRead);
  }

  public canWriteInventoryCosts(): boolean {
    return this.can(Permissions.InventoryCostsWrite);
  }

  public canReadStockMovements(): boolean {
    return this.can(Permissions.StockRead);
  }

  public canWriteStockMovements(): boolean {
    return this.can(Permissions.StockWrite);
  }

  public canWriteStockWaste(): boolean {
    return this.can(Permissions.StockWasteRecord);
  }

  public canReviewStockWaste(): boolean {
    return this.can(Permissions.StockWasteReview);
  }

  public canManageSubscription(): boolean {
    return this.can(Permissions.SubscriptionBilling);
  }

  public canManageBrand(): boolean {
    return this.can(Permissions.BrandManage);
  }

  public canManageWasteReasons(): boolean {
    return this.can(Permissions.WasteReasonsManage);
  }

  public canReadExpenses(): boolean {
    return this.can(Permissions.ExpensesRead);
  }

  public canWriteExpenses(): boolean {
    return this.can(Permissions.ExpensesWrite);
  }

  public getCurrentRoleLabel(): string {
    const prioritizedRoles: readonly AppRole[] = [
      AppRoles.Owner,
      AppRoles.Admin,
      AppRoles.AdminViewer,
      AppRoles.Cashier,
      AppRoles.ItemManager,
      AppRoles.StockManager,
    ];

    const matchedRole = prioritizedRoles.find((role) => this.hasRole(role));
    if (matchedRole) {
      return AppRoleLabels[matchedRole];
    }

    return 'Unknown';
  }

  public can(permission: PermissionKey): boolean {
    return this.permissionsFor(this.rolesSubject.value).has(permission);
  }

  public canAny(permissions: readonly PermissionKey[]): boolean {
    const held = this.permissionsFor(this.rolesSubject.value);
    return permissions.some((permission) => held.has(permission));
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

  private permissionsFor(roles: readonly string[]): ReadonlySet<PermissionKey> {
    const held = new Set<PermissionKey>();

    for (const role of Object.keys(SystemRolePermissions)) {
      if (this.hasRole(role as AppRole, roles)) {
        SystemRolePermissions[role].forEach((permission) => held.add(permission));
      }
    }

    return held;
  }

  private hasRole(role: AppRole, currentRoleNames: readonly string[] = this.rolesSubject.value): boolean {
    const normalizedRole = this.normalizeRole(role);
    const roleAliases = new Set<string>([normalizedRole]);

    if (normalizedRole === 'adminviewer') {
      roleAliases.add('admin viewer');
    }

    const currentRoles = currentRoleNames.map((r) => this.normalizeRole(r));
    return currentRoles.some((r) => roleAliases.has(r));
  }

  private normalizeRole(role: string): string {
    return role.trim().toLowerCase();
  }
}
