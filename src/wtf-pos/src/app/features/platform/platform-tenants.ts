import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { PlatformService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  DeletionPreviewDto,
  PLATFORM_STATUS,
  PasswordResetDto,
  PlatformAuditLogDto,
  PlatformTenantDto,
  PlatformTenantUserDto,
} from '@shared/models/platform.models';

type DialogKind = 'create' | 'users' | 'secret' | 'delete' | 'signin' | 'status' | 'audit';

@Component({
  selector: 'app-platform-tenants',
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './platform-tenants.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformTenantsComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);

  protected readonly status = PLATFORM_STATUS;
  protected readonly tenants = signal<PlatformTenantDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dialog = signal<DialogKind | null>(null);
  protected readonly selected = signal<PlatformTenantDto | null>(null);
  protected readonly users = signal<PlatformTenantUserDto[]>([]);
  protected readonly secret = signal<{ title: string; username: string; password: string } | null>(null);
  protected readonly preview = signal<DeletionPreviewDto | null>(null);
  protected readonly audit = signal<PlatformAuditLogDto[]>([]);
  protected readonly pendingChange = signal<'suspend' | 'resume' | 'cancel'>('suspend');
  protected readonly signInUser = signal<PlatformTenantUserDto | null>(null);
  protected readonly previewRows = computed(() => Object.entries(this.preview()?.rowCounts ?? {}));

  protected readonly createForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    slug: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/)] }),
    ownerFirstName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ownerLastName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ownerUsername: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    isTrial: new FormControl(false, { nonNullable: true }),
  });

  protected readonly reasonForm = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(5)] }),
    allowWrites: new FormControl(false, { nonNullable: true }),
  });

  protected readonly deleteForm = new FormGroup({
    slug: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  public ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.platform.getTenants().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.loading.set(false);
      },
      error: (err: unknown) => this.fail(err, 'Could not load the shops.', true),
    });
  }

  protected signOut(): void {
    this.platform.logout();
    this.router.navigateByUrl(AppRoutes.PlatformLogin, { replaceUrl: true });
  }

  protected close(): void {
    this.dialog.set(null);
    this.error.set(null);
    this.secret.set(null);
  }

  protected openCreate(): void {
    this.createForm.reset();
    this.open('create', null);
  }

  protected createShop(): void {
    if (this.createForm.invalid || this.busy()) {
      return;
    }

    this.run(this.platform.createTenant(this.createForm.getRawValue()), (result) => {
      this.secret.set({
        title: `${result.tenant.name} is ready`,
        username: result.ownerUsername,
        password: result.temporaryPassword,
      });
      this.dialog.set('secret');
      this.load();
    });
  }

  protected openStatus(tenant: PlatformTenantDto, change: 'suspend' | 'resume' | 'cancel'): void {
    this.reasonForm.reset();
    this.pendingChange.set(change);
    this.open('status', tenant);
  }

  protected confirmStatus(): void {
    const tenant = this.selected();

    if (!tenant || this.busy()) {
      return;
    }

    this.run(this.platform.changeStatus(tenant.id, this.pendingChange(), this.reasonForm.controls.reason.value), () => {
      this.close();
      this.load();
    });
  }

  protected openUsers(tenant: PlatformTenantDto): void {
    this.users.set([]);
    this.open('users', tenant);
    this.run(this.platform.getUsers(tenant.id), (users) => this.users.set(users));
  }

  protected resetPassword(user: PlatformTenantUserDto): void {
    const tenant = this.selected();

    if (!tenant || this.busy()) {
      return;
    }

    this.run(this.platform.resetPassword(tenant.id, user.id), (result: PasswordResetDto) => {
      this.secret.set({
        title: 'New one-time password',
        username: result.username,
        password: result.temporaryPassword,
      });
      this.dialog.set('secret');
    });
  }

  protected openSignIn(user: PlatformTenantUserDto): void {
    this.reasonForm.reset();
    this.signInUser.set(user);
    this.dialog.set('signin');
  }

  protected confirmSignIn(): void {
    const tenant = this.selected();
    const user = this.signInUser();

    if (!tenant || !user || this.reasonForm.invalid || this.busy()) {
      return;
    }

    const { reason, allowWrites } = this.reasonForm.getRawValue();

    this.run(this.platform.impersonate(tenant.id, user.id, reason, allowWrites), (result) => {
      this.platform.startImpersonation(result);
      this.router.navigateByUrl(AppRoutes.Dashboard);
    });
  }

  protected exportShop(tenant: PlatformTenantDto): void {
    this.error.set(null);
    this.platform.exportTenant(tenant.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = `${tenant.slug}-export.zip`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err: unknown) => this.fail(err, 'Could not export the shop.', true),
    });
  }

  protected openDelete(tenant: PlatformTenantDto): void {
    this.deleteForm.reset();
    this.preview.set(null);
    this.open('delete', tenant);
    this.run(this.platform.getDeletionPreview(tenant.id), (preview) => this.preview.set(preview));
  }

  protected confirmDelete(): void {
    const tenant = this.selected();

    if (!tenant || this.deleteForm.invalid || this.busy()) {
      return;
    }

    const { slug, password } = this.deleteForm.getRawValue();

    this.run(this.platform.deleteTenant(tenant.id, slug, password), () => {
      this.close();
      this.load();
    });
  }

  protected openAudit(tenant: PlatformTenantDto | null): void {
    this.audit.set([]);
    this.open('audit', tenant);
    this.run(this.platform.getAuditLogs(tenant?.id), (logs) => this.audit.set(logs));
  }

  protected canDelete(tenant: PlatformTenantDto): boolean {
    return tenant.status === PLATFORM_STATUS.Suspended || tenant.status === PLATFORM_STATUS.Cancelled;
  }

  protected isLive(tenant: PlatformTenantDto): boolean {
    return tenant.status === PLATFORM_STATUS.Trial || tenant.status === PLATFORM_STATUS.Active;
  }

  private open(kind: DialogKind, tenant: PlatformTenantDto | null): void {
    this.error.set(null);
    this.selected.set(tenant);
    this.dialog.set(kind);
  }

  private run<T>(source: Observable<T>, onDone: (value: T) => void): void {
    this.busy.set(true);
    this.error.set(null);
    source.subscribe({
      next: (value) => {
        this.busy.set(false);
        onDone(value);
      },
      error: (err: unknown) => this.fail(err, 'That did not work. Try again.', false),
    });
  }

  private fail(err: unknown, fallback: string, stopLoading: boolean): void {
    this.busy.set(false);

    if (stopLoading) {
      this.loading.set(false);
    }

    this.error.set(PlatformService.messageOf(err, fallback));
  }
}
