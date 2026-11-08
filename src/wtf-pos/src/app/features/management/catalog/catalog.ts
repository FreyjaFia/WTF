import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { AlertService, AuthService, CatalogSetupService, ModalStackService } from '@core/services';
import { HttpErrorMessages } from '@core/messages';
import { BadgeComponent, ConnectionErrorComponent, IconComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { PullToRefreshComponent } from '@shared/components/pull-to-refresh/pull-to-refresh';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import {
  AddOnTypeSetupDto,
  CatalogSetupDto,
  CategorySetupDto,
  SubCategorySetupDto,
} from '@shared/models';
import { Observable } from 'rxjs';

export type CatalogSection = 'categories' | 'subcategories' | 'addon-types';
type Section = CatalogSection;
type DialogKind = 'edit' | 'toggle';
type Entry = CategorySetupDto | SubCategorySetupDto | AddOnTypeSetupDto;
type SortColumn = 'name' | 'status' | 'products' | 'subs' | 'category' | 'rule' | 'order';

@Component({
  selector: 'app-catalog',
  imports: [
    ConnectionErrorComponent,
    RouterLink,
    NgTemplateOutlet,
    ReactiveFormsModule,
    BadgeComponent,
    ConfirmDialogComponent,
    IconComponent,
    PullToRefreshComponent,
    SortHeaderComponent,
  ],
  templateUrl: './catalog.html',
  host: { class: 'flex-1 min-h-0' },
})
export class CatalogComponent implements OnInit, OnDestroy {
  private readonly setupService = inject(CatalogSetupService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  protected readonly authService = inject(AuthService);

  public readonly kind = input<Section | null>(null);
  public readonly backRoute = input<string | null>(null);

  protected readonly isAndroid = Capacitor.getPlatform() === 'android';
  protected readonly section = signal<Section>('categories');
  protected readonly setup = signal<CatalogSetupDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly dialog = signal<DialogKind | null>(null);
  protected readonly selected = signal<Entry | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly sortColumn = signal<SortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');

  protected readonly categories = computed(() => this.sorted(this.setup()?.categories ?? []));
  protected readonly subCategories = computed(() =>
    this.sorted([
      ...(this.setup()?.categories.flatMap((c) => c.subCategories) ?? []),
      ...(this.setup()?.unassignedSubCategories ?? []),
    ]),
  );
  protected readonly addOnTypes = computed(() => this.sorted(this.setup()?.addOnTypes ?? []));
  protected readonly activeCategories = computed(() => this.categories().filter((c) => c.isActive));

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(50)],
    }),
    sortOrder: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    categoryId: new FormControl<number | null>(null),
    isRequired: new FormControl(false, { nonNullable: true }),
    minSelect: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
    maxSelect: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
  });

  protected readonly title = computed(() => {
    switch (this.kind()) {
      case 'categories':
        return 'Categories';
      case 'subcategories':
        return 'Sub-categories';
      case 'addon-types':
        return 'Add-on Types';
      default:
        return 'Catalog';
    }
  });

  private modalStackId: number | null = null;

  public constructor() {
    effect(() => {
      const kind = this.kind();
      if (kind) {
        this.selectSection(kind);
      }
    });
  }

  public ngOnInit(): void {
    this.load();
  }

  public ngOnDestroy(): void {
    this.removeFromStack();
  }

  protected canWrite(): boolean {
    return this.authService.canWriteProducts();
  }

  protected selectSection(section: Section): void {
    this.section.set(section);
    this.sortColumn.set(null);
    this.sortDirection.set('asc');
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected categoryNameOf(id: number | null | undefined): string {
    return this.setup()?.categories.find((c) => c.id === id)?.name ?? 'No category';
  }

  protected ruleText(type: AddOnTypeSetupDto): string {
    const min = type.isRequired ? Math.max(type.minSelect, 1) : type.minSelect;
    const max = type.maxSelect > 0 ? type.maxSelect : null;
    if (max === 1) {
      return min >= 1 ? 'Required · Pick one' : 'Optional · Pick one';
    }

    const range = max === null ? 'any number' : `up to ${max}`;
    return `${min >= 1 ? `Required (at least ${min})` : 'Optional'} · ${range}`;
  }

  protected openAdd(): void {
    const list: { sortOrder: number }[] =
      this.section() === 'categories'
        ? this.categories()
        : this.section() === 'subcategories'
          ? this.subCategories()
          : this.addOnTypes();
    const next = list.reduce((max, e) => Math.max(max, e.sortOrder), 0) + 1;
    this.selected.set(null);
    this.form.reset({
      name: '',
      sortOrder: next,
      categoryId: this.activeCategories()[0]?.id ?? null,
      isRequired: false,
      minSelect: 0,
      maxSelect: 0,
    });
    this.openDialog('edit');
  }

  protected openEdit(entry: Entry): void {
    this.selected.set(entry);
    this.form.reset({
      name: entry.name,
      sortOrder: entry.sortOrder,
      categoryId: 'categoryId' in entry ? (entry.categoryId ?? null) : null,
      isRequired: 'isRequired' in entry ? entry.isRequired : false,
      minSelect: 'minSelect' in entry ? entry.minSelect : 0,
      maxSelect: 'maxSelect' in entry ? entry.maxSelect : 0,
    });
    this.openDialog('edit');
  }

  protected openToggle(entry: Entry): void {
    this.selected.set(entry);
    this.openDialog('toggle');
  }

  protected closeDialog(): void {
    if (this.isSaving()) {
      return;
    }

    this.dialog.set(null);
    this.selected.set(null);
    this.formError.set(null);
    this.removeFromStack();
  }

  protected save(): void {
    this.form.markAllAsTouched();
    const value = this.form.getRawValue();
    const name = value.name.trim();
    const section = this.section();
    if (
      name.length === 0 ||
      this.form.controls.name.invalid ||
      this.form.controls.sortOrder.invalid
    ) {
      this.formError.set('Enter a name of up to 50 characters and a sort order of 0 or more.');
      return;
    }

    if (section === 'subcategories' && value.categoryId === null) {
      this.formError.set('Choose the category this sub-category belongs to.');
      return;
    }

    if (section === 'addon-types' && value.maxSelect > 0 && value.minSelect > value.maxSelect) {
      this.formError.set('The minimum cannot be more than the maximum.');
      return;
    }

    const id = this.selected()?.id ?? null;
    const sortOrder = Number(value.sortOrder);
    let request: Observable<{ id: number }>;
    if (section === 'categories') {
      request = this.setupService.saveCategory(id, { name, sortOrder });
    } else if (section === 'subcategories') {
      request = this.setupService.saveSubCategory(id, {
        name,
        categoryId: Number(value.categoryId),
        sortOrder,
      });
    } else {
      request = this.setupService.saveAddOnType(id, {
        name,
        isRequired: value.isRequired,
        minSelect: Number(value.minSelect),
        maxSelect: Number(value.maxSelect),
        sortOrder,
      });
    }

    this.isSaving.set(true);
    this.formError.set(null);
    request.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.alertService.success(id === null ? 'Added.' : 'Saved.');
        this.closeDialog();
        this.load();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.formError.set(err.message);
      },
    });
  }

  protected confirmToggle(): void {
    const entry = this.selected();
    if (!entry) {
      return;
    }

    const isActive = !entry.isActive;
    const section = this.section();
    const request =
      section === 'categories'
        ? this.setupService.setCategoryActive(entry.id, isActive)
        : section === 'subcategories'
          ? this.setupService.setSubCategoryActive(entry.id, isActive)
          : this.setupService.setAddOnTypeActive(entry.id, isActive);

    this.isSaving.set(true);
    request.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.alertService.success(
          isActive ? `${entry.name} is restored.` : `${entry.name} is turned off.`,
        );
        this.closeDialog();
        this.load();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.closeDialog();
        this.alertService.error(err.message);
      },
    });
  }

  private sorted<T extends { isActive: boolean; sortOrder: number; name: string }>(
    items: T[],
  ): T[] {
    const column = this.sortColumn();
    const factor = this.sortDirection() === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      if (column) {
        const va = this.sortValue(a as unknown as Entry, column);
        const vb = this.sortValue(b as unknown as Entry, column);
        const byColumn =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb));
        if (byColumn !== 0) {
          return byColumn * factor;
        }
      }

      return (
        Number(b.isActive) - Number(a.isActive) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name)
      );
    });
  }

  private sortValue(entry: Entry, column: SortColumn): string | number {
    switch (column) {
      case 'name':
        return entry.name.toLowerCase();
      case 'status':
        return Number(entry.isActive);
      case 'products':
        return entry.productCount;
      case 'order':
        return entry.sortOrder;
      case 'subs':
        return 'subCategories' in entry ? entry.subCategories.length : 0;
      case 'category':
        return 'categoryId' in entry ? this.categoryNameOf(entry.categoryId).toLowerCase() : '';
      case 'rule':
        return 'isRequired' in entry ? this.ruleText(entry) : '';
    }
  }

  private openDialog(kind: DialogKind): void {
    this.formError.set(null);
    this.dialog.set(kind);
    this.removeFromStack();
    this.modalStackId = this.modalStack.push(() => this.closeDialog());
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  private load(): void {
    this.isLoading.set(!this.isRefreshing() && this.setup() === null);
    this.connectionFailed.set(false);
    this.setupService.getSetup().subscribe({
      next: (setup) => {
        this.setup.set(setup);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }
}
