import { TestBed } from '@angular/core/testing';
import { HttpErrorMessages } from '@core/messages';
import { AlertService, AuthService, CatalogSetupService, ModalStackService } from '@core/services';
import { CatalogSetupDto } from '@shared/models';
import { fakeAlert, internals } from '@app/testing/management-spec-helpers';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogComponent } from './catalog';

const SETUP: CatalogSetupDto = {
  categories: [
    {
      id: 1,
      name: 'Drink',
      sortOrder: 1,
      isActive: true,
      productCount: 4,
      subCategories: [
        { id: 10, name: 'Coffee', categoryId: 1, sortOrder: 1, isActive: true, productCount: 3 },
      ],
    },
    {
      id: 2,
      name: 'Retired',
      sortOrder: 2,
      isActive: false,
      productCount: 0,
      subCategories: [],
    },
  ],
  unassignedSubCategories: [
    { id: 11, name: 'Loose', categoryId: null, sortOrder: 2, isActive: true, productCount: 0 },
  ],
  addOnTypes: [
    {
      id: 1,
      name: 'Size',
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 1,
      isActive: true,
      productCount: 5,
    },
    {
      id: 3,
      name: 'Topping',
      isRequired: false,
      minSelect: 0,
      maxSelect: 0,
      sortOrder: 2,
      isActive: true,
      productCount: 1,
    },
  ],
};

describe('CatalogComponent', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let alerts: ReturnType<typeof fakeAlert>;
  let canWrite: boolean;

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogSetupService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: { push: vi.fn(() => 1), remove: vi.fn() } },
        { provide: AuthService, useValue: { canWriteProducts: () => canWrite } },
      ],
    });
    const fixture = TestBed.createComponent(CatalogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  beforeEach(() => {
    canWrite = true;
    alerts = fakeAlert();
    service = {
      getSetup: vi.fn(() => of(SETUP)),
      saveCategory: vi.fn(() => of({ id: 9 })),
      saveSubCategory: vi.fn(() => of({ id: 9 })),
      saveAddOnType: vi.fn(() => of({ id: 9 })),
      setCategoryActive: vi.fn(() => of(undefined)),
      setSubCategoryActive: vi.fn(() => of(undefined)),
      setAddOnTypeActive: vi.fn(() => of(undefined)),
    };
  });

  it('shows the connection error panel when the network is down', () => {
    service['getSetup'].mockReturnValue(
      throwError(() => new Error(HttpErrorMessages.NetworkUnavailable)),
    );
    const fixture = create();
    expect(fixture.nativeElement.querySelector('app-connection-error')).not.toBeNull();
    expect(alerts.error).toHaveBeenCalledWith(HttpErrorMessages.NetworkUnavailable);
  });

  it('shows the empty state when there are no categories', () => {
    service['getSetup'].mockReturnValue(
      of({ categories: [], unassignedSubCategories: [], addOnTypes: [] }),
    );
    const fixture = create();
    expect(text(fixture)).toContain('No categories found');
  });

  it('lists categories with their product counts, active ones first', () => {
    const fixture = create();
    const names = internals(fixture.componentInstance)
      .categories()
      .map((c: { name: string }) => c.name);
    expect(names).toEqual(['Drink', 'Retired']);
    expect(text(fixture)).toContain('4 product(s)');
  });

  it('lists sub-categories from every category and the unassigned ones', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.selectSection('subcategories');
    fixture.detectChanges();

    expect(c.subCategories().map((s: { name: string }) => s.name)).toEqual(['Coffee', 'Loose']);
    expect(text(fixture)).toContain('In Drink');
    expect(text(fixture)).toContain('No category');
  });

  it('shows sortable headers per list and sorts by name, resetting when the tab changes', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    const headers = () =>
      Array.from(
        fixture.nativeElement.querySelectorAll('app-sort-header') as NodeListOf<HTMLElement>,
      ).map((h) => h.textContent?.trim());
    expect(headers()).toEqual(['Name', 'Status', 'Products', 'Subs', 'Order']);

    c.toggleSort('name');
    c.toggleSort('name');
    expect(c.categories().map((x: { name: string }) => x.name)).toEqual(['Retired', 'Drink']);

    c.selectSection('subcategories');
    fixture.detectChanges();
    expect(headers()).toEqual(['Name', 'Status', 'Category', 'Products', 'Order']);
    expect(c.sortColumn()).toBeNull();

    c.selectSection('addon-types');
    fixture.detectChanges();
    expect(headers()).toEqual(['Name', 'Status', 'Rule', 'Products', 'Order']);
  });

  it('describes the add-on type rules', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.selectSection('addon-types');
    fixture.detectChanges();

    expect(text(fixture)).toContain('Required · Pick one');
    expect(text(fixture)).toContain('Optional · any number');
    expect(c.ruleText({ isRequired: true, minSelect: 2, maxSelect: 4 })).toBe(
      'Required (at least 2) · up to 4',
    );
  });

  it('hides the actions without write access', () => {
    canWrite = false;
    const fixture = create();
    expect(fixture.nativeElement.querySelector('[data-testid="add-catalog-entry"]')).toBeNull();
    expect(text(fixture)).not.toContain('Turn Off');
  });

  it('adds a category with the next sort order', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    expect(c.form.controls.sortOrder.value).toBe(3);
    c.form.controls.name.setValue('  Bakery ');
    c.save();

    expect(service['saveCategory']).toHaveBeenCalledWith(null, { name: 'Bakery', sortOrder: 3 });
    expect(alerts.success).toHaveBeenCalled();
    expect(service['getSetup']).toHaveBeenCalledTimes(2);
  });

  it('refuses an empty name and a sub-category without a category', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.save();
    expect(service['saveCategory']).not.toHaveBeenCalled();
    expect(c.formError()).toContain('Enter a name');

    c.selectSection('subcategories');
    c.openAdd();
    c.form.controls.name.setValue('Tea');
    c.form.controls.categoryId.setValue(null);
    c.save();
    expect(c.formError()).toContain('Choose the category');
  });

  it('saves a sub-category under the chosen category', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.selectSection('subcategories');
    c.openAdd();
    c.form.controls.name.setValue('Tea');
    c.form.controls.categoryId.setValue(1);
    c.save();

    expect(service['saveSubCategory']).toHaveBeenCalledWith(null, {
      name: 'Tea',
      categoryId: 1,
      sortOrder: 3,
    });
  });

  it('saves an add-on type with its rules and checks min against max', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.selectSection('addon-types');
    c.openAdd();
    c.form.controls.name.setValue('Temperature');
    c.form.controls.isRequired.setValue(true);
    c.form.controls.minSelect.setValue(3);
    c.form.controls.maxSelect.setValue(2);
    c.save();
    expect(c.formError()).toContain('minimum');
    expect(service['saveAddOnType']).not.toHaveBeenCalled();

    c.form.controls.minSelect.setValue(1);
    c.form.controls.maxSelect.setValue(1);
    c.save();
    expect(service['saveAddOnType']).toHaveBeenCalledWith(null, {
      name: 'Temperature',
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 3,
    });
  });

  it('edits an existing entry by id and shows a server refusal in the dialog', () => {
    service['saveCategory'].mockReturnValue(throwError(() => new Error('That name is taken.')));
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openEdit(SETUP.categories[0]);
    expect(c.form.controls.name.value).toBe('Drink');
    c.save();

    expect(service['saveCategory']).toHaveBeenCalledWith(1, { name: 'Drink', sortOrder: 1 });
    expect(c.formError()).toBe('That name is taken.');
    expect(c.dialog()).toBe('edit');
  });

  it('turns an entry off and restores it after a confirmation', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openToggle(SETUP.categories[0]);
    c.confirmToggle();
    expect(service['setCategoryActive']).toHaveBeenCalledWith(1, false);

    c.openToggle(SETUP.categories[1]);
    c.confirmToggle();
    expect(service['setCategoryActive']).toHaveBeenCalledWith(2, true);
  });

  it('shows the server message when turning an entry off is refused', () => {
    service['setAddOnTypeActive'].mockReturnValue(
      throwError(() => new Error('Size is still used by 5 products.')),
    );
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.selectSection('addon-types');
    c.openToggle(SETUP.addOnTypes[0]);
    c.confirmToggle();

    expect(alerts.error).toHaveBeenCalledWith('Size is still used by 5 products.');
    expect(c.dialog()).toBeNull();
  });
});
