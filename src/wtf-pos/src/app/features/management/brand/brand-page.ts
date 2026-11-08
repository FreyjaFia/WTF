import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertService, BrandService } from '@core/services';
import { BrandDto } from '@shared/models/subscription.models';

@Component({
  selector: 'app-brand-page',
  imports: [ReactiveFormsModule],
  templateUrl: './brand-page.html',
  standalone: true,
})
export class BrandPageComponent implements OnInit {
  private readonly brandService = inject(BrandService);
  private readonly alertService = inject(AlertService);
  private readonly fb = inject(FormBuilder);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    shopName: ['', [Validators.required, Validators.maxLength(100)]],
    shortName: [''],
    tagline: [''],
    logoUrl: [''],
    address: [''],
    phone: [''],
    email: [''],
    receiptHeader: [''],
    receiptFooter: [''],
    registrationText: [''],
    primaryColor: ['#6f4e37', [Validators.required, Validators.pattern(/^#[0-9a-fA-F]{6}$/)]],
    timeZone: ['Asia/Manila'],
    currencySymbol: ['₱'],
    currencyCode: ['PHP'],
    currencyDecimals: [2],
  });

  private current: BrandDto | null = null;

  public ngOnInit(): void {
    this.brandService.getForEdit().subscribe({
      next: (brand) => {
        this.current = brand;
        this.form.patchValue(this.toForm(brand));
        this.isLoading.set(false);
      },
      error: () => {
        this.alertService.error('The shop details could not be loaded.');
        this.isLoading.set(false);
      },
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
      logoUrl: value.logoUrl || null,
      address: value.address || null,
      phone: value.phone || null,
      email: value.email || null,
      receiptHeader: value.receiptHeader || null,
      receiptFooter: value.receiptFooter || null,
      registrationText: value.registrationText || null,
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
      logoUrl: brand.logoUrl ?? '',
      address: brand.address ?? '',
      phone: brand.phone ?? '',
      email: brand.email ?? '',
      receiptHeader: brand.receiptHeader ?? '',
      receiptFooter: brand.receiptFooter ?? '',
      registrationText: brand.registrationText ?? '',
      primaryColor: brand.primaryColor,
      timeZone: brand.timeZone,
      currencySymbol: brand.currencySymbol,
      currencyCode: brand.currencyCode,
      currencyDecimals: brand.currencyDecimals,
    };
  }
}
