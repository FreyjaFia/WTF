import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorMessages } from '@core/messages';
import { AlertService, AuthService, SupplierService } from '@core/services';
import {
  ConnectionErrorComponent,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  SideDrawerComponent,
} from '@shared/components';
import { BadgeComponent } from '@shared/components/badge/badge';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { AppRoutes } from '@shared/constants/app-routes';
import { SupplierSummaryDto } from '@shared/models';

@Component({
  selector: 'app-suppliers',
  imports: [
    BadgeComponent,
    ConnectionErrorComponent,
    FilterButtonComponent,
    IconComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    RouterLink,
    SearchInputComponent,
    SideDrawerComponent,
  ],
  templateUrl: './suppliers.html',
  host: { class: 'flex-1 min-h-0' },
})
export class SuppliersComponent implements OnInit {
  private readonly suppliersApi = inject(SupplierService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly setupRoute = AppRoutes.ManagementSetup;
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly search = signal('');
  protected readonly suppliers = signal<SupplierSummaryDto[]>([]);
  protected readonly filteredSuppliers = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.suppliers();
    }

    return this.suppliers().filter((supplier) =>
      [supplier.name, supplier.contactName, supplier.phone].some((field) =>
        field?.toLowerCase().includes(term),
      ),
    );
  });
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isFormOpen = signal(false);
  protected readonly showInactive = signal(false);
  protected readonly isFiltersOpen = signal(false);
  protected readonly activeFilterCount = computed(() => (this.showInactive() ? 1 : 0));
  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    contactName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    leadTimeDays: new FormControl<number | null>(null, [Validators.min(0), Validators.max(365)]),
    paymentTerms: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
  });

  public ngOnInit(): void {
    this.load();
  }

  protected supplierRoute(id: string): string {
    return AppRoutes.ManagementSupplierById(id);
  }

  protected openForm(): void {
    this.isFormOpen.set(true);
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
    this.form.reset();
  }

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected setShowInactive(value: boolean): void {
    this.showInactive.set(value);
    this.load();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected load(): void {
    this.connectionFailed.set(false);
    this.isLoading.set(true);
    this.suppliersApi.getSuppliers({ includeInactive: this.showInactive() }).subscribe({
      next: (suppliers) => {
        this.suppliers.set(suppliers);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected create(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isSaving()) {
      return;
    }

    const value = this.form.getRawValue();
    this.isSaving.set(true);
    this.suppliersApi
      .createSupplier({
        name: value.name.trim(),
        contactName: value.contactName.trim() || null,
        phone: value.phone.trim() || null,
        email: null,
        address: null,
        leadTimeDays: value.leadTimeDays,
        paymentTerms: value.paymentTerms.trim() || null,
        notes: null,
      })
      .subscribe({
        next: (supplier) => {
          this.isSaving.set(false);
          void this.router.navigateByUrl(AppRoutes.ManagementSupplierById(supplier.summary.id));
        },
        error: (err: Error) => {
          this.isSaving.set(false);
          this.alertService.error(err.message);
        },
      });
  }
}
