import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { environment } from '@environments/environment.development';
import { BrandDto, PublicBrandDto } from '@shared/models/subscription.models';
import { Observable, tap } from 'rxjs';

export const DEFAULT_SHOP_NAME = 'WTF';

@Injectable({ providedIn: 'root' })
export class BrandService {
  private readonly http = inject(HttpClient);
  private readonly title = inject(Title);

  private readonly _brand = signal<PublicBrandDto | null>(null);

  public readonly brand = this._brand.asReadonly();
  public readonly displayName = computed(
    () => this._brand()?.shortName || this._brand()?.shopName || DEFAULT_SHOP_NAME,
  );

  public load(): void {
    this.http.get<BrandDto>(`${environment.apiUrl}/settings/brand`).subscribe({
      next: (brand) => this.apply(brand),
      error: () => undefined,
    });
  }

  public getForEdit(): Observable<BrandDto> {
    return this.http.get<BrandDto>(`${environment.apiUrl}/settings/brand`);
  }

  public save(brand: BrandDto): Observable<BrandDto> {
    return this.http
      .put<BrandDto>(`${environment.apiUrl}/settings/brand`, brand)
      .pipe(tap((saved) => this.apply(saved)));
  }

  public loadPublic(token: string): void {
    this.http
      .get<PublicBrandDto>(`${environment.apiUrl}/public/order-links/${encodeURIComponent(token)}/brand`)
      .subscribe({
        next: (brand) => this.apply(brand),
        error: () => undefined,
      });
  }

  private apply(brand: PublicBrandDto): void {
    this._brand.set(brand);
    this.title.setTitle(`${brand.shopName} POS`);

    if (brand.primaryColor) {
      document.documentElement.style.setProperty('--shop-primary', brand.primaryColor);
    }
  }
}
