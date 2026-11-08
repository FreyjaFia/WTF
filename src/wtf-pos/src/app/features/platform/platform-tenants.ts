import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PlatformService } from '@core/services';
import { filterShops } from '@shared/calculations';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { SideDrawerComponent } from '@shared/components/side-drawer/side-drawer';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { AppRoutes } from '@shared/constants/app-routes';
import { PLATFORM_STATUS, PlatformTenantDto } from '@shared/models/platform.models';
import { PlatformChipComponent } from './platform-chip';
import { statusTone, warningLabel, warningTone } from './platform-labels';
import { PlatformSecret, PlatformSecretDialogComponent } from './platform-secret-dialog';

type SortColumn = 'name' | 'status' | 'plan' | 'paidUntil' | 'people' | 'orders' | 'lastOrder';

interface StatusOption {
  id: number;
  label: string;
}

@Component({
  selector: 'app-platform-tenants',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    RouterLink,
    SearchInputComponent,
    FilterButtonComponent,
    SideDrawerComponent,
    SortHeaderComponent,
    IconComponent,
    PlatformChipComponent,
    PlatformSecretDialogComponent,
  ],
  templateUrl: './platform-tenants.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformTenantsComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly statusOptions: StatusOption[] = [
    { id: PLATFORM_STATUS.Active, label: 'Active' },
    { id: PLATFORM_STATUS.Trial, label: 'Trial' },
    { id: PLATFORM_STATUS.Suspended, label: 'Suspended' },
    { id: PLATFORM_STATUS.Cancelled, label: 'Cancelled' },
  ];

  protected readonly tenants = signal<PlatformTenantDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly secret = signal<PlatformSecret | null>(null);
  protected readonly filtersOpen = signal(false);
  protected readonly selectedStatuses = signal<number[]>([]);
  protected readonly sortColumn = signal<SortColumn>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');

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
  protected readonly visible = computed(() => {
    const rows = filterShops(this.tenants(), this.query() ?? '', this.selectedStatuses());
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const column = this.sortColumn();

    return [...rows].sort((a, b) => direction * this.compare(a, b, column));
  });
  protected readonly activeFilterCount = computed(() => (this.selectedStatuses().length > 0 ? 1 : 0));

  public ngOnInit(): void {
    this.load();

    if (this.route.snapshot.queryParamMap.has('new')) {
      this.openCreate();
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  protected load(): void {
    this.loading.set(true);
    this.fetch();
  }

  protected refresh(): void {
    this.refreshing.set(true);
    this.fetch();
  }

  protected countFor(status: number): number {
    return this.tenants().filter((t) => t.status === status).length;
  }

  protected isStatusSelected(status: number): boolean {
    return this.selectedStatuses().includes(status);
  }

  protected toggleStatus(status: number): void {
    this.selectedStatuses.update((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    );
  }

  protected clearStatuses(): void {
    this.selectedStatuses.set([]);
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');

      return;
    }

    this.sortColumn.set(column);
    this.sortDirection.set('asc');
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

  private fetch(): void {
    this.platform.getTenants().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: (err: unknown) => {
        this.error.set(PlatformService.messageOf(err, 'Could not load the shops.'));
        this.loading.set(false);
        this.refreshing.set(false);
      },
    });
  }

  private compare(a: PlatformTenantDto, b: PlatformTenantDto, column: SortColumn): number {
    switch (column) {
      case 'status':
        return a.status - b.status;
      case 'plan':
        return (a.planName ?? '').localeCompare(b.planName ?? '');
      case 'paidUntil':
        return this.time(a.periodEnd) - this.time(b.periodEnd);
      case 'people':
        return a.userCount - b.userCount;
      case 'orders':
        return a.orderCount - b.orderCount;
      case 'lastOrder':
        return this.time(a.lastOrderAt) - this.time(b.lastOrderAt);
      default:
        return a.name.localeCompare(b.name);
    }
  }

  private time(value: string | null | undefined): number {
    return value ? new Date(value).getTime() : 0;
  }
}
