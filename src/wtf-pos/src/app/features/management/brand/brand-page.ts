import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertService, BrandService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';
import { BrandDto } from '@shared/models/subscription.models';

type BrandField = {
  name: Exclude<keyof BrandDto, 'logoUrl' | 'seniorPwdEnabled' | 'vatRegistered'>;
  label: string;
  placeholder: string;
};

const BRAND_FIELDS: BrandField[] = [
  { name: 'shopName', label: 'Shop name', placeholder: '' },
  { name: 'shortName', label: 'Short name (shown in the menu)', placeholder: '' },
  { name: 'tagline', label: 'Tagline', placeholder: '' },
  { name: 'address', label: 'Address', placeholder: '' },
  { name: 'phone', label: 'Phone', placeholder: '' },
  { name: 'email', label: 'Email', placeholder: '' },
  { name: 'receiptHeader', label: 'Receipt header', placeholder: '' },
  { name: 'receiptFooter', label: 'Receipt footer', placeholder: '' },
  { name: 'registrationText', label: 'Registration text (receipt)', placeholder: '' },
  { name: 'primaryColor', label: 'Colour', placeholder: '#6f4e37' },
];

@Component({
  selector: 'app-brand-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  templateUrl: './brand-page.html',
  standalone: true,
})
export class BrandPageComponent implements OnInit {
  protected readonly shopRoute = AppRoutes.ManagementShop;

  private readonly brandService = inject(BrandService);
  private readonly alertService = inject(AlertService);
  private readonly fb = inject(FormBuilder);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    shopName: ['', [Validators.required, Validators.maxLength(100)]],
    shortName: [''],
    tagline: [''],
    address: [''],
    phone: [''],
    email: [''],
    receiptHeader: [''],
    receiptFooter: [''],
    registrationText: [''],
    primaryColor: ['#6f4e37', [Validators.required, Validators.pattern(/^#[0-9a-fA-F]{6}$/)]],
    seniorPwdEnabled: [false],
    vatRegistered: [false],
  });

  protected readonly logoUrl = signal<string | null>(null);
  protected readonly isUploading = signal(false);

  protected readonly fields = BRAND_FIELDS;

  private current: BrandDto | null = null;

  public ngOnInit(): void {
    this.brandService.getForEdit().subscribe({
      next: (brand) => {
        this.current = brand;
        this.logoUrl.set(brand.logoUrl);
        this.form.patchValue(this.toForm(brand));
        this.isLoading.set(false);
      },
      error: () => {
        this.alertService.error('The shop details could not be loaded.');
        this.isLoading.set(false);
      },
    });
  }

  protected chooseLogo(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file || this.isUploading()) {
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.alertService.error('Pick a picture under 5 MB.');
      return;
    }

    this.isUploading.set(true);
    this.brandService.uploadLogo(file).subscribe({
      next: (saved) => this.logoDone(saved, 'Logo saved.'),
      error: (err: unknown) => this.logoFailed(err),
    });
  }

  protected removeLogo(): void {
    if (this.isUploading()) {
      return;
    }

    this.isUploading.set(true);
    this.brandService.removeLogo().subscribe({
      next: (saved) => this.logoDone(saved, 'Logo removed.'),
      error: (err: unknown) => this.logoFailed(err),
    });
  }

  protected save(): void {
    if (this.form.invalid || this.isSaving() || !this.current) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const body: BrandDto = {
      ...this.current,
      ...value,
      shortName: value.shortName || null,
      tagline: value.tagline || null,
      address: value.address || null,
      phone: value.phone || null,
      email: value.email || null,
      receiptHeader: value.receiptHeader || null,
      receiptFooter: value.receiptFooter || null,
      registrationText: value.registrationText || null,
      seniorPwdEnabled: value.seniorPwdEnabled,
      vatRegistered: value.vatRegistered,
    };

    this.isSaving.set(true);
    this.brandService.save(body).subscribe({
      next: (saved) => {
        this.current = saved;
        this.form.markAsPristine();
        this.isSaving.set(false);
        this.alertService.success('Shop details saved.');
      },
      error: (err: unknown) => {
        this.isSaving.set(false);
        const message = (err as { error?: { message?: string } })?.error?.message;
        this.alertService.error(message ?? 'The shop details could not be saved.');
      },
    });
  }

  private toForm(brand: BrandDto): Partial<ReturnType<typeof this.form.getRawValue>> {
    return {
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
      seniorPwdEnabled: brand.seniorPwdEnabled ?? false,
      vatRegistered: brand.vatRegistered ?? false,
    };
  }

  private logoDone(saved: BrandDto, message: string): void {
    this.current = { ...(this.current ?? saved), logoUrl: saved.logoUrl };
    this.logoUrl.set(saved.logoUrl);
    this.isUploading.set(false);
    this.alertService.success(message);
  }

  private logoFailed(err: unknown): void {
    this.isUploading.set(false);
    const message = typeof err === 'object' && err !== null ? (err as { error?: { message?: string } }).error?.message : null;
    this.alertService.error(message ?? 'The logo could not be saved.');
  }
}
