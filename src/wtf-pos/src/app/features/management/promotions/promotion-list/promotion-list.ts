import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, ListStateService, PromotionService } from '@core/services';
import {
  AvatarComponent,
  BadgeComponent,
  FilterDropdownComponent,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  type FilterOption,
} from '@shared/components';
import { PromotionListItemDto, PromotionTypeEnum } from '@shared/models';
import { AppRoutes } from '@shared/constants/app-routes';
import { debounceTime, forkJoin } from 'rxjs';

type SortColumn = 'name' | 'type';
type SortDirection = 'asc' | 'desc';

interface PromotionListState {
  searchTerm: string;
  selectedTypes: string[];
  selectedStatuses: string[];
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
}

@Component({
  selector: 'app-promotion-list',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    AvatarComponent,
    BadgeComponent,
    IconComponent,
    FilterDropdownComponent,
    PullToRefreshComponent,
    SearchInputComponent,
  ],
  templateUrl: './promotion-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class PromotionListComponent implements OnInit {
  private readonly stateKey = 'management:promotion-list';
  private readonly promotionService = inject(PromotionService);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly listState = inject(ListStateService);
  private readonly router = inject(Router);
  protected readonly routes = AppRoutes;

  protected readonly PromotionTypeEnum = PromotionTypeEnum;
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isMobileFiltersOpen = signal(false);
  protected readonly promotions = signal<PromotionListItemDto[]>([]);
  protected readonly promotionsCache = signal<PromotionListItemDto[]>([]);

  protected readonly selectedTypes = signal<string[]>([]);
  protected readonly selectedStatuses = signal<string[]>(['active']);
  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly sortColumn = signal<SortColumn | null>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');

  protected readonly typeCounts = computed(() => {
    const cache = this.promotionsCache();
    return {
      fixedBundle: cache.filter((x) => x.typeId === PromotionTypeEnum.FixedBundle).length,
      mixMatch: cache.filter((x) => x.typeId === PromotionTypeEnum.MixMatch).length,
    };
  });

  protected readonly statusCounts = computed(() => {
    const cache = this.promotionsCache();
    return {
      active: cache.filter((x) => x.isActive).length,
      inactive: cache.filter((x) => !x.isActive).length,
    };
  });

  protected readonly typeOptions = computed<FilterOption[]>(() => [
    { id: 'fixed-bundle', label: 'Fixed Bundle', count: this.typeCounts().fixedBundle },
    { id: 'mix-match', label: 'Mix & Match', count: this.typeCounts().mixMatch },
  ]);

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'active', label: 'Active', count: this.statusCounts().active },
    { id: 'inactive', label: 'Inactive', count: this.statusCounts().inactive },
  ]);

  protected readonly sortedPromotions = computed(() => {
    const items = [...this.promotions()];
    if (this.sortColumn() === 'name') {
      items.sort((a, b) => {
        const result = a.name.localeCompare(b.name);
        return this.sortDirection() === 'asc' ? result : -result;
      });
    } else if (this.sortColumn() === 'type') {
      items.sort((a, b) => {
        const result = this.getTypeLabel(a.typeId).localeCompare(this.getTypeLabel(b.typeId));
        return this.sortDirection() === 'asc' ? result : -result;
      });
    }

    return items;
  });

  public ngOnInit(): void {
    this.restoreState();
    this.load();
    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.applyFiltersToCache();
      this.saveState();
    });
  }

  protected load(): void {
    this.isLoading.set(true);
    forkJoin({
      fixedBundles: this.promotionService.getFixedBundles(),
      mixMatch: this.promotionService.getMixMatchPromotions(),
    }).subscribe({
      next: ({ fixedBundles, mixMatch }) => {
        const all = [...fixedBundles, ...mixMatch];
        this.promotionsCache.set(all);
        this.applyFiltersToCache();
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }

  protected addPromotion(): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.router.navigateByUrl(AppRoutes.ManagementPromotionsNew);
  }

  protected editPromotion(promo: PromotionListItemDto): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (promo.typeId === PromotionTypeEnum.MixMatch) {
      this.router.navigateByUrl(AppRoutes.ManagementPromotionMixMatchEditById(promo.id));
      return;
    }

    this.router.navigateByUrl(AppRoutes.ManagementPromotionFixedBundleEditById(promo.id));
  }

  protected deletePromotion(promo: PromotionListItemDto): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const request$ =
      promo.typeId === PromotionTypeEnum.MixMatch
        ? this.promotionService.deleteMixMatch(promo.id)
        : this.promotionService.deleteFixedBundle(promo.id);

    request$.subscribe({
      next: () => {
        this.alertService.success('Promotion deleted.');
        this.load();
      },
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  protected getTypeLabel(typeId: PromotionTypeEnum): string {
    return typeId === PromotionTypeEnum.MixMatch ? 'Mix & Match' : 'Fixed Bundle';
  }

  protected onTypeFilterChange(selectedIds: (string | number)[]): void {
    this.selectedTypes.set(selectedIds as string[]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onTypeFilterReset(): void {
    this.selectedTypes.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onStatusFilterChange(selectedIds: (string | number)[]): void {
    this.selectedStatuses.set(selectedIds as string[]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected onStatusFilterReset(): void {
    this.selectedStatuses.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected openMobileFilters(): void {
    this.isMobileFiltersOpen.set(true);
  }

  protected closeMobileFilters(): void {
    this.isMobileFiltersOpen.set(false);
  }

  protected clearTypeSelections(): void {
    this.selectedTypes.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected clearStatusSelections(): void {
    this.selectedStatuses.set([]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected isTypeSelected(id: string): boolean {
    return this.selectedTypes().includes(id);
  }

  protected isStatusSelected(id: string): boolean {
    return this.selectedStatuses().includes(id);
  }

  protected toggleTypeSelection(id: string): void {
    const selected = this.selectedTypes();
    this.selectedTypes.set(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected toggleStatusSelection(id: string): void {
    const selected = this.selectedStatuses();
    this.selectedStatuses.set(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    this.applyFiltersToCache();
    this.saveState();
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }

    this.saveState();
  }

  private applyFiltersToCache(): void {
    const { searchTerm } = this.filterForm.value;
    let items = [...this.promotionsCache()];

    if (searchTerm && searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      items = items.filter((x) => x.name.toLowerCase().includes(q));
    }

    const types = this.selectedTypes();
    if (types.length > 0) {
      items = items.filter((x) => {
        if (types.includes('fixed-bundle') && x.typeId === PromotionTypeEnum.FixedBundle) {
          return true;
        }

        if (types.includes('mix-match') && x.typeId === PromotionTypeEnum.MixMatch) {
          return true;
        }

        return false;
      });
    }

    const statuses = this.selectedStatuses();
    if (statuses.length > 0) {
      items = items.filter((x) => {
        if (statuses.includes('active') && x.isActive) {
          return true;
        }

        if (statuses.includes('inactive') && !x.isActive) {
          return true;
        }

        return false;
      });
    }

    this.promotions.set(items);
  }

  private restoreState(): void {
    const state = this.listState.load<PromotionListState>(this.stateKey, {
      searchTerm: '',
      selectedTypes: [],
      selectedStatuses: ['active'],
      sortColumn: 'name',
      sortDirection: 'asc',
    });

    this.filterForm.patchValue(
      {
        searchTerm: state.searchTerm,
      },
      { emitEvent: false },
    );
    this.selectedTypes.set(state.selectedTypes);
    this.selectedStatuses.set(state.selectedStatuses);
    this.sortColumn.set(state.sortColumn);
    this.sortDirection.set(state.sortDirection);
  }

  private saveState(): void {
    this.listState.save<PromotionListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedTypes: this.selectedTypes(),
      selectedStatuses: this.selectedStatuses(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    });
  }
}
