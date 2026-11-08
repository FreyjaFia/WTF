import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PlatformService } from '@core/services';
import { filterShops } from '@shared/calculations';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { AppRoutes } from '@shared/constants/app-routes';
import { PLATFORM_STATUS, PlatformTenantDto } from '@shared/models/platform.models';
import { PlatformChipComponent } from './platform-chip';
import { statusTone, warningLabel, warningTone } from './platform-labels';
import { PlatformSecret, PlatformSecretDialogComponent } from './platform-secret-dialog';

interface StatusFilter {
  label: string;
  value: number | null;
}

@Component({
  selector: 'app-platform-tenants',
  imports: [ReactiveFormsModule, DatePipe, RouterLink, SearchInputComponent, PlatformChipComponent, PlatformSecretDialogComponent],
  templateUrl: './platform-tenants.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformTenantsComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly filters: StatusFilter[] = [
    { label: 'All', value: null },
    { label: 'Active', value: PLATFORM_STATUS.Active },
    { label: 'Trial', value: PLATFORM_STATUS.Trial },
    { label: 'Suspended', value: PLATFORM_STATUS.Suspended },
    { label: 'Cancelled', value: PLATFORM_STATUS.Cancelled },
  ];

  protected readonly tenants = signal<PlatformTenantDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly secret = signal<PlatformSecret | null>(null);
  protected readonly statusFilter = signal<number | null>(null);

  protected readonly search = new FormControl<string | null>('');
  protected readonly createForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    slug: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/)] }),
    ownerFirstName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ownerLastName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ownerUsername: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    isTrial: new FormControl(false, { nonNullable: true }),
  });

  protected readonly statusTone = statusTone;
  protected readonly warningLabel = warningLabel;
  protected readonly warningTone = warningTone;

  private readonly query = toSignal(this.search.valueChanges, { initialValue: '' });
  protected readonly visible = computed(() => filterShops(this.tenants(), this.query() ?? '', this.statusFilter()));

  public ngOnInit(): void {
    this.load();

    if (this.route.snapshot.queryParamMap.has('new')) {
      this.openCreate();
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  protected load(): void {
    this.loading.set(true);
    this.platform.getTenants().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(PlatformService.messageOf(err, 'Could not load the shops.'));
        this.loading.set(false);
      },
    });
  }

  protected countFor(value: number | null): number {
    return value === null ? this.tenants().length : this.tenants().filter((t) => t.status === value).length;
  }

  protected shopLink(tenant: PlatformTenantDto): string {
    return AppRoutes.PlatformShopById(tenant.id);
  }

  protected openCreate(): void {
    this.createForm.reset();
    this.dialogError.set(null);
    this.creating.set(true);
  }

  protected closeCreate(): void {
    this.creating.set(false);
  }

  protected closeSecret(): void {
    this.secret.set(null);
  }

  protected createShop(): void {
    if (this.createForm.invalid || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.dialogError.set(null);
    this.platform.createTenant(this.createForm.getRawValue()).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.creating.set(false);
        this.secret.set({
          title: `${result.tenant.name} is ready`,
          username: result.ownerUsername,
          password: result.temporaryPassword,
        });
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.dialogError.set(PlatformService.messageOf(err, 'That did not work. Try again.'));
      },
    });
  }
}
