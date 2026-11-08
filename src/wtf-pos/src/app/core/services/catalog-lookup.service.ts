import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '@environments/environment.development';
import { AddOnTypeRule } from '@shared/calculations';
import {
  AddOnTypeLookupDto,
  applyAddOnTypeOrder,
  CatalogLookupsDto,
  CatalogSetupDto,
  CategoryLookupDto,
  formatSubCategoryName,
  SubCategoryLookupDto,
} from '@shared/models';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CatalogLookupService {
  private readonly http = inject(HttpClient);

  private readonly categoriesState = signal<CategoryLookupDto[]>([]);
  private readonly subCategoriesState = signal<SubCategoryLookupDto[]>([]);
  private readonly addOnTypesState = signal<AddOnTypeLookupDto[]>([]);
  private readonly loadedState = signal(false);
  private loading: Promise<void> | null = null;

  public readonly categories = this.categoriesState.asReadonly();
  public readonly subCategories = this.subCategoriesState.asReadonly();
  public readonly addOnTypes = this.addOnTypesState.asReadonly();
  public readonly loaded = this.loadedState.asReadonly();

  public readonly activeCategories = computed(() =>
    this.categoriesState().filter((c) => c.isActive),
  );
  public readonly activeSubCategories = computed(() =>
    this.subCategoriesState().filter((s) => s.isActive),
  );
  public readonly activeAddOnTypes = computed(() =>
    this.addOnTypesState().filter((t) => t.isActive),
  );

  public set(lookups: CatalogLookupsDto | null | undefined): void {
    if (!lookups) {
      return;
    }

    this.categoriesState.set(sortLookups(lookups.categories));
    this.subCategoriesState.set(sortLookups(lookups.subCategories));
    this.addOnTypesState.set(sortLookups(lookups.addOnTypes));
    applyAddOnTypeOrder(this.addOnTypesState());
    this.loadedState.set(true);
  }

  public setFromSetup(setup: CatalogSetupDto): void {
    this.set({
      categories: setup.categories,
      subCategories: [
        ...setup.categories.flatMap((c) => c.subCategories),
        ...setup.unassignedSubCategories,
      ],
      addOnTypes: setup.addOnTypes,
    });
  }

  public async ensureLoaded(): Promise<void> {
    if (this.loadedState()) {
      return;
    }

    this.loading ??= this.refresh().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  public async refresh(): Promise<void> {
    try {
      const setup = await firstValueFrom(
        this.http.get<CatalogSetupDto>(`${environment.apiUrl}/catalog`),
      );
      this.setFromSetup(setup);
    } catch {
      // Offline or not allowed: the lists from the last catalog sync stay in use.
    }
  }

  public categoryName(id: number | null | undefined): string {
    return this.categoriesState().find((c) => c.id === id)?.name ?? '';
  }

  public subCategoryName(id: number | null | undefined): string {
    return formatSubCategoryName(this.subCategoriesState().find((s) => s.id === id)?.name);
  }

  public addOnTypeName(id: number | null | undefined): string {
    return this.addOnTypesState().find((t) => t.id === id)?.name ?? '';
  }

  public addOnRule(id: number | null | undefined): AddOnTypeRule | null {
    const type = this.addOnTypesState().find((t) => t.id === id);
    if (!type) {
      return null;
    }

    return {
      name: type.name,
      isRequired: type.isRequired,
      minSelect: type.minSelect,
      maxSelect: type.maxSelect,
    };
  }
}

function sortLookups<T extends { sortOrder: number; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
