import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CreateTenantRequest,
  CreatedTenantDto,
  DeletionPreviewDto,
  ImpersonationDto,
  ImpersonationInfo,
  PasswordResetDto,
  PlatformAuditLogDto,
  PlatformTenantDto,
  PlatformTenantUserDto,
} from '@shared/models/platform.models';
import {
  BrandDto,
  PlanDto,
  SetSubscriptionRequest,
  TenantSubscriptionDto,
  UpdatePlanRequest,
} from '@shared/models/subscription.models';
import { environment } from '@environments/environment.development';
import { Observable, map } from 'rxjs';

interface LoginResponse {
  accessToken: string;
}

@Injectable({ providedIn: 'root' })
export class PlatformService {
  public static readonly TOKEN_KEY = 'platformToken';
  public static readonly IMPERSONATION_KEY = 'impersonation';

  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/platform`;

  public login(username: string, password: string): Observable<void> {
    return this.http
      .post<LoginResponse>(`${this.baseUrl}/auth/login`, { username, password })
      .pipe(
        map((res) => {
          sessionStorage.setItem(PlatformService.TOKEN_KEY, res.accessToken);
        }),
      );
  }

  public logout(): void {
    sessionStorage.removeItem(PlatformService.TOKEN_KEY);
  }

  public getToken(): string | null {
    return sessionStorage.getItem(PlatformService.TOKEN_KEY);
  }

  public isSignedIn(): boolean {
    const token = this.getToken();

    if (!token) {
      return false;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));

      return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  public getPlans(): Observable<PlanDto[]> {
    return this.http.get<PlanDto[]>(`${this.baseUrl}/plans`);
  }

  public updatePlan(id: number, request: UpdatePlanRequest): Observable<PlanDto> {
    return this.http.put<PlanDto>(`${this.baseUrl}/plans/${id}`, request);
  }

  public getBrand(tenantId: string): Observable<BrandDto> {
    return this.http.get<BrandDto>(`${this.baseUrl}/tenants/${tenantId}/brand`);
  }

  public setBrand(tenantId: string, brand: BrandDto): Observable<BrandDto> {
    return this.http.put<BrandDto>(`${this.baseUrl}/tenants/${tenantId}/brand`, brand);
  }

  public getSubscription(tenantId: string): Observable<TenantSubscriptionDto> {
    return this.http.get<TenantSubscriptionDto>(`${this.baseUrl}/tenants/${tenantId}/subscription`);
  }

  public setSubscription(tenantId: string, request: SetSubscriptionRequest): Observable<TenantSubscriptionDto> {
    return this.http.put<TenantSubscriptionDto>(`${this.baseUrl}/tenants/${tenantId}/subscription`, request);
  }

  public createInvoice(
    tenantId: string,
    request: { months: number; reference: string | null; dueDate: string | null; notes: string | null },
  ): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/tenants/${tenantId}/invoices`, request);
  }

  public markInvoicePaid(invoiceId: string, reference: string | null): Observable<TenantSubscriptionDto> {
    return this.http.post<TenantSubscriptionDto>(`${this.baseUrl}/invoices/${invoiceId}/mark-paid`, { reference });
  }

  public voidInvoice(invoiceId: string): Observable<TenantSubscriptionDto> {
    return this.http.post<TenantSubscriptionDto>(`${this.baseUrl}/invoices/${invoiceId}/void`, {});
  }

  public getTenants(): Observable<PlatformTenantDto[]> {
    return this.http.get<PlatformTenantDto[]>(`${this.baseUrl}/tenants`);
  }

  public createTenant(request: CreateTenantRequest): Observable<CreatedTenantDto> {
    return this.http.post<CreatedTenantDto>(`${this.baseUrl}/tenants`, request);
  }

  public changeStatus(
    tenantId: string,
    change: 'suspend' | 'resume' | 'cancel',
    reason: string,
  ): Observable<PlatformTenantDto> {
    return this.http.post<PlatformTenantDto>(`${this.baseUrl}/tenants/${tenantId}/${change}`, { reason });
  }

  public getUsers(tenantId: string): Observable<PlatformTenantUserDto[]> {
    return this.http.get<PlatformTenantUserDto[]>(`${this.baseUrl}/tenants/${tenantId}/users`);
  }

  public resetPassword(tenantId: string, userId: string): Observable<PasswordResetDto> {
    return this.http.post<PasswordResetDto>(
      `${this.baseUrl}/tenants/${tenantId}/users/${userId}/reset-password`,
      {},
    );
  }

  public impersonate(
    tenantId: string,
    userId: string,
    reason: string,
    allowWrites: boolean,
  ): Observable<ImpersonationDto> {
    return this.http.post<ImpersonationDto>(
      `${this.baseUrl}/tenants/${tenantId}/users/${userId}/impersonate`,
      { reason, allowWrites },
    );
  }

  public exportTenant(tenantId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/tenants/${tenantId}/export`, { responseType: 'blob' });
  }

  public getDeletionPreview(tenantId: string): Observable<DeletionPreviewDto> {
    return this.http.get<DeletionPreviewDto>(`${this.baseUrl}/tenants/${tenantId}/deletion-preview`);
  }

  public deleteTenant(tenantId: string, slug: string, adminPassword: string): Observable<DeletionPreviewDto> {
    return this.http.post<DeletionPreviewDto>(`${this.baseUrl}/tenants/${tenantId}/delete`, {
      slug,
      adminPassword,
    });
  }

  public getAuditLogs(tenantId?: string): Observable<PlatformAuditLogDto[]> {
    const query = tenantId ? `?tenantId=${tenantId}` : '';

    return this.http.get<PlatformAuditLogDto[]>(`${this.baseUrl}/audit-logs${query}`);
  }

  // Replaces the shop session of this browser with the short-lived one; leaving it (or its expiry) signs it out.
  public startImpersonation(dto: ImpersonationDto): void {
    const info: ImpersonationInfo = {
      expiresAt: dto.expiresAt,
      username: dto.username,
      tenantName: dto.tenantName,
      readOnly: dto.readOnly,
    };

    localStorage.setItem('token', dto.accessToken);
    localStorage.removeItem('refreshToken');
    localStorage.setItem(PlatformService.IMPERSONATION_KEY, JSON.stringify(info));
  }

  public getImpersonation(): ImpersonationInfo | null {
    const raw = localStorage.getItem(PlatformService.IMPERSONATION_KEY);

    if (!raw) {
      return null;
    }

    try {
      const info = JSON.parse(raw) as ImpersonationInfo;

      if (new Date(info.expiresAt).getTime() <= Date.now()) {
        this.endImpersonation();

        return null;
      }

      return info;
    } catch {
      this.endImpersonation();

      return null;
    }
  }

  public endImpersonation(): void {
    localStorage.removeItem(PlatformService.IMPERSONATION_KEY);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  }

  public static messageOf(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const message = (error.error as { message?: string } | null)?.message;

      return message ?? fallback;
    }

    return fallback;
  }
}
