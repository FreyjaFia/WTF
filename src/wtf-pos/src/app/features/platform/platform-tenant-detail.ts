import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, PlatformService } from '@core/services';
import { isLiveShop } from '@shared/calculations';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  DeletionPreviewDto,
  PLATFORM_STATUS,
  PasswordResetDto,
  PlatformAuditLogDto,
  PlatformTenantDto,
  PlatformTenantUserDto,
} from '@shared/models/platform.models';
import { BrandDto, PlanDto, TenantSubscriptionDto } from '@shared/models/subscription.models';
import { Observable, forkJoin } from 'rxjs';
import { PlatformChipComponent } from './platform-chip';
import { invoiceTone, statusTone, warningLabel, warningTone } from './platform-labels';
import { PlatformSecret, PlatformSecretDialogComponent } from './platform-secret-dialog';

type DetailTab = 'overview' | 'people' | 'billing' | 'brand' | 'log';
type DialogKind = 'status' | 'signin' | 'delete';
type StatusChange = 'suspend' | 'resume' | 'cancel';

const INVOICE_PENDING = 1;

@Component({
  selector: 'app-platform-tenant-detail',
  imports: [ReactiveFormsModule, DatePipe, CurrencyPipe, RouterLink, PlatformChipComponent, PlatformSecretDialogComponent],
  templateUrl: './platform-tenant-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformTenantDetailComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly alerts = inject(AlertService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly shopsLink = AppRoutes.PlatformShops;
  protected readonly tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'people', label: 'People' },
    { id: 'billing', label: 'Billing' },
    { id: 'brand', label: 'Brand' },
    { id: 'log', label: 'Log' },
  ];

  protected readonly tenant = signal<PlatformTenantDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<DetailTab>('overview');
  protected readonly dialog = signal<DialogKind | null>(null);
  protected readonly pendingChange = signal<StatusChange>('suspend');
  protected readonly secret = signal<PlatformSecret | null>(null);

  protected readonly users = signal<PlatformTenantUserDto[] | null>(null);
  protected readonly signInUser = signal<PlatformTenantUserDto | null>(null);
  protected readonly plans = signal<PlanDto[]>([]);
  protected readonly billing = signal<TenantSubscriptionDto | null>(null);
  protected readonly brand = signal<BrandDto | null>(null);
  protected readonly audit = signal<PlatformAuditLogDto[] | null>(null);
  protected readonly preview = signal<DeletionPreviewDto | null>(null);

  protected readonly live = computed(() => {
    const t = this.tenant();

    return t !== null && isLiveShop(t.status);
  });
  protected readonly canDelete = computed(() => {
    const t = this.tenant();

    return t !== null && (t.status === PLATFORM_STATUS.Suspended || t.status === PLATFORM_STATUS.Cancelled);
  });
  protected readonly previewRows = computed(() => Object.entries(this.preview()?.rowCounts ?? {}));
  protected readonly pendingInvoices = INVOICE_PENDING;

  protected readonly reasonForm = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(5)] }),
    allowWrites: new FormControl(false, { nonNullable: true }),
  });
  protected readonly deleteForm = new FormGroup({
    slug: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly billingForm = new FormGroup({
    planId: new FormControl(0, { nonNullable: true, validators: [Validators.required] }),
    periodEnd: new FormControl('', { nonNullable: true }),
    graceDays: new FormControl(7, { nonNullable: true, validators: [Validators.min(0), Validators.max(60)] }),
    discountPercent: new FormControl(0, { nonNullable: true, validators: [Validators.min(0), Validators.max(100)] }),
    notes: new FormControl('', { nonNullable: true }),
  });
  protected readonly invoiceForm = new FormGroup({
    months: new FormControl(1, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(24)] }),
    reference: new FormControl('', { nonNullable: true }),
    dueDate: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });
  protected readonly brandForm = new FormGroup({
    shopName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    shortName: new FormControl('', { nonNullable: true }),
    tagline: new FormControl('', { nonNullable: true }),
    address: new FormControl('', { nonNullable: true }),
    phone: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    receiptHeader: new FormControl('', { nonNullable: true }),
    receiptFooter: new FormControl('', { nonNullable: true }),
    registrationText: new FormControl('', { nonNullable: true }),
    primaryColor: new FormControl('#6f4e37', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^#[0-9a-fA-F]{6}$/)] }),
  });

  protected readonly status = PLATFORM_STATUS;
  protected readonly statusTone = statusTone;
  protected readonly warningLabel = warningLabel;
  protected readonly warningTone = warningTone;
  protected readonly invoiceTone = invoiceTone;

  public ngOnInit(): void {
    this.reload();
  }

  protected selectTab(tab: DetailTab): void {
    this.tab.set(tab);
    this.error.set(null);

    switch (tab) {
      case 'people':
        if (this.users() === null) {
          this.loadUsers();
        }
        break;
      case 'billing':
        if (this.billing() === null) {
          this.loadBilling();
        }
        break;
      case 'brand':
        if (this.brand() === null) {
          this.loadBrand();
        }
        break;
      case 'log':
        if (this.audit() === null) {
          this.loadAudit();
        }
        break;
    }
  }

  protected reload(): void {
    const id = this.route.snapshot.paramMap.get('id');

    this.platform.getTenants().subscribe({
      next: (tenants) => {
        const found = tenants.find((t) => t.id === id) ?? null;

        this.tenant.set(found);
        this.notFound.set(found === null);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(PlatformService.messageOf(err, 'Could not load the shop.'));
        this.loading.set(false);
      },
    });
  }

  protected closeDialog(): void {
    this.dialog.set(null);
    this.error.set(null);
  }

  protected closeSecret(): void {
    this.secret.set(null);
  }

  protected openStatus(change: StatusChange): void {
    this.reasonForm.reset();
    this.pendingChange.set(change);
    this.error.set(null);
    this.dialog.set('status');
  }

  protected confirmStatus(): void {
    const tenant = this.tenant();

    if (!tenant || this.reasonForm.invalid || this.busy()) {
      return;
    }

    this.run(this.platform.changeStatus(tenant.id, this.pendingChange(), this.reasonForm.controls.reason.value), () => {
      this.closeDialog();
      this.audit.set(null);
      this.alerts.success('Shop updated.');
      this.reload();
    });
  }

  protected exportShop(): void {
    const tenant = this.tenant();

    if (!tenant) {
      return;
    }

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
      error: (err: unknown) => this.error.set(PlatformService.messageOf(err, 'Could not export the shop.')),
    });
  }

  protected openDelete(): void {
    const tenant = this.tenant();

    if (!tenant) {
      return;
    }

    this.deleteForm.reset();
    this.preview.set(null);
    this.error.set(null);
    this.dialog.set('delete');
    this.run(this.platform.getDeletionPreview(tenant.id), (preview) => this.preview.set(preview));
  }

  protected confirmDelete(): void {
    const tenant = this.tenant();

    if (!tenant || this.deleteForm.invalid || this.busy()) {
      return;
    }

    const { slug, password } = this.deleteForm.getRawValue();

    this.run(this.platform.deleteTenant(tenant.id, slug, password), () => {
      this.alerts.success(`${tenant.name} was deleted.`);
      this.router.navigateByUrl(AppRoutes.PlatformShops);
    });
  }

  protected resetPassword(user: PlatformTenantUserDto): void {
    const tenant = this.tenant();

    if (!tenant || this.busy()) {
      return;
    }

    this.run(this.platform.resetPassword(tenant.id, user.id), (result: PasswordResetDto) => {
      this.audit.set(null);
      this.secret.set({ title: 'New one-time password', username: result.username, password: result.temporaryPassword });
    });
  }

  protected openSignIn(user: PlatformTenantUserDto): void {
    this.reasonForm.reset();
    this.signInUser.set(user);
    this.error.set(null);
    this.dialog.set('signin');
  }

  protected confirmSignIn(): void {
    const tenant = this.tenant();
    const user = this.signInUser();

    if (!tenant || !user || this.reasonForm.invalid || this.busy()) {
      return;
    }

    const { reason, allowWrites } = this.reasonForm.getRawValue();

    this.run(this.platform.impersonate(tenant.id, user.id, reason, allowWrites), (result) => {
      this.platform.startImpersonation(result);
      // A full page load, so the app reads the new shop token from scratch. Navigating inside the running app kept the
      // platform session's empty roles, and the role guard and login guard sent each other back and forth forever.
      this.platform.openShopApp();
    });
  }

  protected saveBilling(): void {
    const tenant = this.tenant();

    if (!tenant || this.billingForm.invalid || this.busy()) {
      return;
    }

    const v = this.billingForm.getRawValue();

    this.run(
      this.platform.setSubscription(tenant.id, {
        planId: Number(v.planId),
        periodEnd: v.periodEnd ? new Date(v.periodEnd).toISOString() : null,
        graceDays: Number(v.graceDays),
        discountPercent: Number(v.discountPercent),
        notes: v.notes || null,
      }),
      (sub) => {
        this.applyBilling(sub);
        this.alerts.success('Billing saved.');
        this.reload();
      },
    );
  }

  protected addInvoice(): void {
    const tenant = this.tenant();

    if (!tenant || this.invoiceForm.invalid || this.busy()) {
      return;
    }

    const v = this.invoiceForm.getRawValue();
    const request = {
      months: Number(v.months),
      reference: v.reference || null,
      dueDate: v.dueDate ? new Date(v.dueDate).toISOString() : null,
      notes: v.notes || null,
    };

    this.run(this.platform.createInvoice(tenant.id, request), () => {
      this.invoiceForm.reset({ months: 1, reference: '', dueDate: '', notes: '' });
      this.alerts.success('Invoice created.');
      this.loadBilling();
    });
  }

  protected markPaid(invoiceId: string): void {
    this.run(this.platform.markInvoicePaid(invoiceId, null), (sub) => {
      this.applyBilling(sub);
      this.alerts.success('Invoice marked paid.');
      this.reload();
    });
  }

  protected voidInvoice(invoiceId: string): void {
    this.run(this.platform.voidInvoice(invoiceId), (sub) => {
      this.applyBilling(sub);
      this.alerts.success('Invoice voided.');
    });
  }

  protected saveBrand(): void {
    const tenant = this.tenant();
    const current = this.brand();

    if (!tenant || !current || this.brandForm.invalid || this.busy()) {
      this.brandForm.markAllAsTouched();

      return;
    }

    const v = this.brandForm.getRawValue();
    const body: BrandDto = {
      ...current,
      ...v,
      shortName: v.shortName || null,
      tagline: v.tagline || null,
      address: v.address || null,
      phone: v.phone || null,
      email: v.email || null,
      receiptHeader: v.receiptHeader || null,
      receiptFooter: v.receiptFooter || null,
      registrationText: v.registrationText || null,
    };

    this.run(this.platform.setBrand(tenant.id, body), (saved) => {
      this.applyBrand(saved);
      this.alerts.success('Brand saved.');
    });
  }

  private loadUsers(): void {
    const tenant = this.tenant();

    if (tenant) {
      this.run(this.platform.getUsers(tenant.id), (users) => this.users.set(users));
    }
  }

  private loadBilling(): void {
    const tenant = this.tenant();

    if (tenant) {
      this.run(forkJoin([this.platform.getPlans(), this.platform.getSubscription(tenant.id)]), ([plans, sub]) => {
        this.plans.set(plans);
        this.applyBilling(sub);
      });
    }
  }

  private loadBrand(): void {
    const tenant = this.tenant();

    if (tenant) {
      this.run(this.platform.getBrand(tenant.id), (brand) => this.applyBrand(brand));
    }
  }

  private loadAudit(): void {
    const tenant = this.tenant();

    if (tenant) {
      this.run(this.platform.getAuditLogs(tenant.id), (logs) => this.audit.set(logs));
    }
  }

  private applyBilling(sub: TenantSubscriptionDto): void {
    this.billing.set(sub);
    this.billingForm.patchValue({
      planId: sub.planId,
      periodEnd: sub.periodEnd.slice(0, 10),
      graceDays: sub.graceDays,
      discountPercent: sub.discountPercent,
      notes: sub.notes ?? '',
    });
  }

  private applyBrand(brand: BrandDto): void {
    this.brand.set(brand);
    this.brandForm.reset({
      shopName: brand.shopName,
      shortName: brand.shortName ?? '',
      tagline: brand.tagline ?? '',
      address: brand.address ?? '',
      phone: brand.phone ?? '',
      email: brand.email ?? '',
      receiptHeader: brand.receiptHeader ?? '',
      receiptFooter: brand.receiptFooter ?? '',
      registrationText: brand.registrationText ?? '',
      primaryColor: brand.primaryColor,
    });
  }

  private run<T>(source: Observable<T>, onDone: (value: T) => void): void {
    this.busy.set(true);
    this.error.set(null);
    source.subscribe({
      next: (value) => {
        this.busy.set(false);
        onDone(value);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(PlatformService.messageOf(err, 'That did not work. Try again.'));
      },
    });
  }
}
