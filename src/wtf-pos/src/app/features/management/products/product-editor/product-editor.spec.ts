/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AlertService, ModalStackService, ProductService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  AddOnGroupDto,
  AddOnTypeEnum,
  ProductCategoryEnum,
  ProductDto,
  ProductSubCategoryEnum,
} from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductEditorComponent } from './product-editor';

function product(over: Partial<ProductDto> = {}): ProductDto {
  return {
    id: 'p1',
    name: 'Latte',
    code: 'LAT',
    description: 'Tasty',
    price: 100,
    category: ProductCategoryEnum.Drink,
    subCategory: ProductSubCategoryEnum.Coffee,
    isAddOn: false,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    createdBy: 'u',
    priceHistory: [],
    addOnCount: 0,
    imageUrl: 'http://img/x.png',
    ...over,
  };
}

function group(type: AddOnTypeEnum, items: { id: string; name: string; price?: number }[]): AddOnGroupDto {
  return {
    type,
    displayName: AddOnTypeEnum[type],
    options: items.map((i) => product({ id: i.id, name: i.name, price: i.price ?? 5, isAddOn: true })),
  };
}

function fileOf(type: string, size = 10, name = 'a.png'): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function fileEvent(file?: File): Event {
  return { target: { files: file ? [file] : [] } } as unknown as Event;
}

describe('ProductEditorComponent', () => {
  let fixture: ComponentFixture<ProductEditorComponent>;
  let c: any;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let alerts: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(id: string | null = null): void {
    service = {
      getProduct: vi.fn(() => of(product())),
      createProduct: vi.fn((dto: any) => of(product({ id: 'new', ...dto }))),
      updateProduct: vi.fn(() => of(product())),
      uploadProductImage: vi.fn(() => of(product({ imageUrl: 'http://img/new.png' }))),
      deleteProductImage: vi.fn(() => of(product({ imageUrl: null }))),
      getProductAddOns: vi.fn(() => of([])),
      getLinkedProducts: vi.fn(() => of([])),
      getProducts: vi.fn(() => of([])),
      getProductAddOnPriceOverrides: vi.fn(() => of([])),
      assignProductAddOns: vi.fn(() => of(undefined)),
      assignLinkedProducts: vi.fn(() => of(undefined)),
      createProductAddOnPriceOverride: vi.fn((p: any) => of({ ...p })),
      updateProductAddOnPriceOverride: vi.fn((p: any) => of({ ...p })),
      deleteProductAddOnPriceOverride: vi.fn(() => of(undefined)),
    };
    alerts = {};
    for (const m of [
      'error',
      'successCreated',
      'successUpdated',
      'successDeleted',
      'successSaved',
      'errorInvalidImageType',
      'errorFileTooLarge',
    ]) {
      alerts[m] = vi.fn();
    }
    alerts['getDeleteErrorMessage'] = vi.fn(() => 'del-default');
    alerts['getUpdateErrorMessage'] = vi.fn((x: string) => `upd-${x}`);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => id } } } },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(ProductEditorComponent);
    c = fixture.componentInstance;
  }

  function fillValid(over: Record<string, unknown> = {}): void {
    c.productForm.patchValue({
      name: 'Mocha',
      code: 'MOC1',
      description: 'd',
      price: 55,
      category: ProductCategoryEnum.Drink,
      subCategory: ProductSubCategoryEnum.Coffee,
      ...over,
    });
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create mode', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('starts as a pristine, invalid form in create mode', () => {
      expect(c.isEditMode()).toBe(false);
      expect(service['getProduct']).not.toHaveBeenCalled();
      expect(c.productForm.invalid).toBe(true);
      expect(c.productForm.controls.code.enabled).toBe(true);
    });

    describe('validation', () => {
      it('requires name, code and a valid price', () => {
        const f = c.productForm.controls;
        expect(f.name.errors?.['required']).toBeTruthy();
        expect(f.code.errors?.['required']).toBeTruthy();
        f.name.setValue('x'.repeat(101));
        expect(f.name.errors?.['maxlength']).toBeTruthy();
        f.description.setValue('x'.repeat(501));
        expect(f.description.errors?.['maxlength']).toBeTruthy();
        f.price.setValue(-1);
        expect(f.price.errors?.['min']).toBeTruthy();
        f.price.setValue(1000000);
        expect(f.price.errors?.['max']).toBeTruthy();
        f.price.setValue(999999.99);
        expect(f.price.valid).toBe(true);
      });

      it('code must be uppercase alphanumeric, max 10', () => {
        const code = c.productForm.controls.code;
        code.setValue('abc');
        expect(code.errors?.['pattern']).toBeTruthy();
        code.setValue('AB-1');
        expect(code.errors?.['pattern']).toBeTruthy();
        code.setValue('ABC123');
        expect(code.valid).toBe(true);
        code.setValue('ABCDEFGHIJK');
        expect(code.errors?.['maxlength']).toBeTruthy();
      });

      it('getErrorMessage only reports touched controls', () => {
        expect(c.getErrorMessage('name')).toBeNull();
        c.productForm.controls.name.markAsTouched();
        expect(c.getErrorMessage('name')).toBe('Product name is required');
        expect(c.hasError('name')).toBe(true);
        expect(c.hasError('missing')).toBe(false);
        expect(c.getErrorMessage('missing')).toBeNull();
      });

      it('getErrorMessage covers min, max and pattern', () => {
        const f = c.productForm.controls;
        f.price.markAsTouched();
        f.price.setValue(-5);
        expect(c.getErrorMessage('price')).toBe('Price must be at least 0');
        f.price.setValue(2000000);
        expect(c.getErrorMessage('price')).toBe('Price cannot exceed 999999.99');
        f.code.markAsTouched();
        f.code.setValue('bad');
        expect(c.getErrorMessage('code')).toBe(
          'Product code must contain only uppercase letters and numbers',
        );
        f.description.markAsTouched();
        f.description.setValue('x'.repeat(501));
        // description has no pattern/required, so only maxlength applies
        expect(c.getErrorMessage('description')).toBe(
          'description cannot exceed 500 characters',
        );
      });

      it('getErrorMessage reports max length violations', () => {
        const name = c.productForm.controls.name;
        name.setValue('x'.repeat(101));
        name.markAsTouched();
        expect(c.getErrorMessage('name')).toBe('Product name cannot exceed 100 characters');
      });
    });

    it('uppercases the code input', () => {
      const input = { value: 'abc1' };
      c.onCodeInput({ target: input } as unknown as Event);
      expect(c.productForm.controls.code.value).toBe('ABC1');
    });

    it('selecting add-on forces category Other and disables category/subcategory', () => {
      c.productForm.controls.isAddOn.setValue(true);
      expect(c.productForm.controls.category.value).toBe(ProductCategoryEnum.Other);
      expect(c.productForm.controls.category.disabled).toBe(true);
      expect(c.productForm.controls.subCategory.disabled).toBe(true);
      c.productForm.controls.isAddOn.setValue(false);
      expect(c.productForm.controls.category.enabled).toBe(true);
    });

    describe('saveProduct', () => {
      it('does not submit an invalid form and marks it touched', () => {
        c.saveProduct();
        expect(service['createProduct']).not.toHaveBeenCalled();
        expect(c.productForm.controls.name.touched).toBe(true);
        expect(c.isSaving()).toBe(false);
      });

      it('ignores save while busy', () => {
        fillValid();
        c.isUploading.set(true);
        c.saveProduct();
        expect(service['createProduct']).not.toHaveBeenCalled();
      });

      it('isBusy is true while any override is saving', () => {
        expect(c.isBusy()).toBe(false);
        c.addOnOverrideSaving.set({ a: true });
        expect(c.isBusy()).toBe(true);
      });

      it('creates with the raw form payload then navigates to details', () => {
        fillValid();
        c.saveProduct();
        expect(service['createProduct']).toHaveBeenCalledWith({
          name: 'Mocha',
          code: 'MOC1',
          description: 'd',
          price: 55,
          category: ProductCategoryEnum.Drink,
          subCategory: ProductSubCategoryEnum.Coffee,
          isAddOn: false,
          isActive: true,
        });
        expect(alerts['successCreated']).toHaveBeenCalledWith('Product');
        expect(router.navigateByUrl).toHaveBeenCalledWith(
          AppRoutes.ManagementProductDetailsById('new'),
        );
        expect(c.isSaving()).toBe(false);
      });

      it('creates an add-on with category Other and no subcategory', () => {
        fillValid();
        c.productForm.controls.isAddOn.setValue(true);
        c.saveProduct();
        const dto = service['createProduct'].mock.calls[0][0];
        expect(dto.isAddOn).toBe(true);
        expect(dto.category).toBe(ProductCategoryEnum.Other);
        expect(dto.subCategory).toBeNull();
      });

      it('uploads the selected image after creating, then navigates', () => {
        fillValid();
        const file = fileOf('image/png');
        c.selectedFile.set(file);
        c.saveProduct();
        expect(service['uploadProductImage']).toHaveBeenCalledWith('new', file);
        expect(alerts['successCreated']).toHaveBeenCalledWith('Product');
        expect(router.navigateByUrl).toHaveBeenCalledWith(
          AppRoutes.ManagementProductDetailsById('new'),
        );
        expect(c.selectedFile()).toBeNull();
        expect(c.isSaving()).toBe(false);
        expect(c.isUploading()).toBe(false);
      });

      it('reports a create error and re-enables saving', () => {
        fillValid();
        service['createProduct'].mockReturnValue(throwError(() => new Error('dup code')));
        c.saveProduct();
        expect(alerts['error']).toHaveBeenCalledWith('dup code');
        expect(c.isSaving()).toBe(false);
        expect(router.navigateByUrl).not.toHaveBeenCalled();
      });

      it('reports an upload error without navigating', () => {
        fillValid();
        c.selectedFile.set(fileOf('image/png'));
        service['uploadProductImage'].mockReturnValue(throwError(() => new Error('up fail')));
        c.saveProduct();
        expect(alerts['error']).toHaveBeenCalledWith('up fail');
        expect(c.isSaving()).toBe(false);
        expect(c.isUploading()).toBe(false);
        expect(router.navigateByUrl).not.toHaveBeenCalled();
      });

      it('is saving while the request is in flight', () => {
        fillValid();
        const s = new Subject<ProductDto>();
        service['createProduct'].mockReturnValue(s);
        c.saveProduct();
        expect(c.isSaving()).toBe(true);
        c.saveProduct();
        expect(service['createProduct']).toHaveBeenCalledTimes(1);
      });
    });

    describe('add-on / linked managers', () => {
      it('require the product to be saved first', () => {
        c.openAddOnsManager();
        c.openProductsManager();
        expect(alerts['error']).toHaveBeenCalledTimes(2);
      });

      it('removeAddOn, removeLinkedProduct, override saves are no-ops without id', () => {
        c.removeAddOn('x');
        c.removeLinkedProduct('x');
        c.saveAddOnPriceOverride('x', 1);
        c.clearAddOnPriceOverride('x');
        expect(service['assignProductAddOns']).not.toHaveBeenCalled();
        expect(service['assignLinkedProducts']).not.toHaveBeenCalled();
      });
    });

    it('goBack in create mode returns to list', () => {
      c.goBack();
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementProducts);
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      setup('p1');
    });

    it('loads the product and patches the form', () => {
      fixture.detectChanges();
      expect(c.isEditMode()).toBe(true);
      expect(service['getProduct']).toHaveBeenCalledWith('p1');
      expect(c.productForm.getRawValue()).toMatchObject({
        name: 'Latte',
        code: 'LAT',
        description: 'Tasty',
        price: 100,
        isActive: true,
      });
      expect(c.productName()).toBe('Latte');
      expect(c.currentImageUrl()).toBe('http://img/x.png');
      expect(c.lastUpdatedAt()).toBe('2024-01-01T00:00:00Z');
      expect(c.productForm.controls.code.disabled).toBe(true);
      expect(c.productForm.controls.isAddOn.disabled).toBe(true);
      expect(service['getProductAddOns']).toHaveBeenCalledWith('p1');
      expect(c.isLoading()).toBe(false);
    });

    it('uses updatedAt for lastUpdatedAt and fills defaults for missing fields', () => {
      service['getProduct'].mockReturnValue(
        of(product({ updatedAt: '2025-02-02', description: null, subCategory: null, imageUrl: null })),
      );
      fixture.detectChanges();
      expect(c.lastUpdatedAt()).toBe('2025-02-02');
      expect(c.productForm.controls.description.value).toBe('');
      expect(c.productForm.controls.subCategory.value).toBeNull();
      expect(c.currentImageUrl()).toBeNull();
    });

    it('alerts when the product fails to load', () => {
      service['getProduct'].mockReturnValue(throwError(() => new Error('gone')));
      fixture.detectChanges();
      expect(alerts['error']).toHaveBeenCalledWith('gone');
      expect(c.isLoading()).toBe(false);
    });

    it('for add-on products loads linked products and locks category fields', () => {
      service['getProduct'].mockReturnValue(of(product({ isAddOn: true, category: ProductCategoryEnum.Other })));
      service['getLinkedProducts'].mockReturnValue(
        of([group(AddOnTypeEnum.Size, [{ id: 'z', name: 'Zed' }, { id: 'a', name: 'Alpha' }])]),
      );
      fixture.detectChanges();
      expect(service['getLinkedProducts']).toHaveBeenCalledWith('p1');
      expect(service['getProductAddOns']).not.toHaveBeenCalled();
      expect(c.productForm.controls.category.disabled).toBe(true);
      expect(c.totalLinkedCount()).toBe(2);
      expect(c.sortedLinkedProducts()[0].options[0].name).toBe('Alpha');
    });

    it('linked products load failure yields empty list', () => {
      service['getProduct'].mockReturnValue(of(product({ isAddOn: true })));
      service['getLinkedProducts'].mockReturnValue(throwError(() => new Error('x')));
      fixture.detectChanges();
      expect(c.linkedProducts()).toEqual([]);
    });

    it('goBack in edit mode returns to details', () => {
      fixture.detectChanges();
      c.goBack();
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementProductDetailsById('p1'));
    });

    describe('saveProduct', () => {
      beforeEach(() => {
        fixture.detectChanges();
      });

      it('updates with id and raw values (including disabled code) then navigates', () => {
        c.productForm.controls.name.setValue('Latte 2');
        c.saveProduct();
        expect(service['updateProduct']).toHaveBeenCalledWith({
          id: 'p1',
          name: 'Latte 2',
          code: 'LAT',
          description: 'Tasty',
          price: 100,
          category: ProductCategoryEnum.Drink,
          subCategory: ProductSubCategoryEnum.Coffee,
          isAddOn: false,
          isActive: true,
        });
        expect(service['createProduct']).not.toHaveBeenCalled();
        expect(alerts['successUpdated']).toHaveBeenCalledWith('Product');
        expect(router.navigateByUrl).toHaveBeenCalledWith(
          AppRoutes.ManagementProductDetailsById('p1'),
        );
      });

      it('update of an add-on forces category Other', () => {
        service['getProduct'].mockReturnValue(of(product({ isAddOn: true, category: ProductCategoryEnum.Food })));
        c.ngOnInit();
        c.saveProduct();
        const dto = service['updateProduct'].mock.calls[0][0];
        expect(dto.category).toBe(ProductCategoryEnum.Other);
        expect(dto.subCategory).toBeNull();
      });

      it('uploads the selected image after update, then navigates once', () => {
        const file = fileOf('image/webp');
        c.selectedFile.set(file);
        c.saveProduct();
        expect(service['uploadProductImage']).toHaveBeenCalledWith('p1', file);
        expect(alerts['successUpdated']).toHaveBeenCalledTimes(1);
        expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(c.currentImageUrl()).toBe('http://img/new.png');
      });

      it('reports update errors', () => {
        service['updateProduct'].mockReturnValue(throwError(() => new Error('conflict')));
        c.saveProduct();
        expect(alerts['error']).toHaveBeenCalledWith('conflict');
        expect(c.isSaving()).toBe(false);
        expect(router.navigateByUrl).not.toHaveBeenCalled();
      });
    });

    describe('current image removal', () => {
      beforeEach(() => {
        fixture.detectChanges();
      });

      it('deletes the image', () => {
        c.removeCurrentImage();
        expect(service['deleteProductImage']).toHaveBeenCalledWith('p1');
        expect(c.currentImageUrl()).toBeNull();
        expect(alerts['successDeleted']).toHaveBeenCalledWith('Image');
        expect(c.isDeletingImage()).toBe(false);
      });

      it('falls back to the default message on empty error', () => {
        service['deleteProductImage'].mockReturnValue(throwError(() => new Error('')));
        c.removeCurrentImage();
        expect(alerts['error']).toHaveBeenCalledWith('del-default');
        expect(c.currentImageUrl()).toBe('http://img/x.png');
        expect(c.isDeletingImage()).toBe(false);
      });

      it('shows server error message when present', () => {
        service['deleteProductImage'].mockReturnValue(throwError(() => new Error('srv')));
        c.removeCurrentImage();
        expect(alerts['error']).toHaveBeenCalledWith('srv');
      });

      it('is a no-op without an image or while deleting', () => {
        c.isDeletingImage.set(true);
        c.removeCurrentImage();
        c.isDeletingImage.set(false);
        c.currentImageUrl.set(null);
        c.removeCurrentImage();
        expect(service['deleteProductImage']).not.toHaveBeenCalled();
      });
    });

    describe('assigned add-ons and price overrides', () => {
      const groups = [
        group(AddOnTypeEnum.Extra, [{ id: 'e1', name: 'Zzz', price: 7 }]),
        group(AddOnTypeEnum.Size, [
          { id: 's2', name: 'Small', price: 10 },
          { id: 's1', name: 'Large', price: 20 },
        ]),
      ];

      beforeEach(() => {
        service['getProductAddOns'].mockReturnValue(of(groups));
        service['getProducts'].mockReturnValue(
          of([
            product({ id: 's1', price: 25, isAddOn: true }),
            product({ id: 'other', price: 99, isAddOn: true }),
          ]),
        );
        service['getProductAddOnPriceOverrides'].mockReturnValue(
          of([
            { productId: 'p1', addOnId: 's2', price: 8, isActive: true },
            { productId: 'p1', addOnId: 'e1', price: 1, isActive: false },
          ]),
        );
        fixture.detectChanges();
      });

      it('sorts assigned groups and options, counts them', () => {
        expect(c.sortedAssignedAddOns()[0].type).toBe(AddOnTypeEnum.Size);
        expect(c.sortedAssignedAddOns()[0].options.map((o: ProductDto) => o.name)).toEqual([
          'Large',
          'Small',
        ]);
        expect(c.totalAssignedAddOnsCount()).toBe(3);
      });

      it('loads base prices only for assigned add-ons and active overrides only', () => {
        expect(service['getProducts']).toHaveBeenCalledWith({ isAddOn: true });
        expect(c.addOnBasePrices()).toEqual({ s1: 25 });
        expect(Object.keys(c.addOnPriceOverrides())).toEqual(['s2']);
        expect(c.getAddOnOverrideDraft('s2')).toBe('8');
        expect(c.getAddOnOverrideDraft('s1')).toBe('');
        expect(c.hasAddOnPriceOverride('s2')).toBe(true);
        expect(c.isAddOnOverridden('s1')).toBe(false);
      });

      it('computes base and effective prices', () => {
        expect(c.getAddOnBasePrice('s1', 20)).toBe(25);
        expect(c.getAddOnBasePrice('s2', 10)).toBe(10);
        expect(c.getAddOnEffectivePrice('s2', 10)).toBe(8);
        expect(c.getAddOnEffectivePrice('s1', 20)).toBe(25);
      });

      it('handles failures when loading add-ons', () => {
        service['getProductAddOns'].mockReturnValue(throwError(() => new Error('x')));
        c.ngOnInit();
        expect(c.assignedAddOns()).toEqual([]);
        expect(c.addOnPriceOverrides()).toEqual({});
      });

      it('handles failures loading base prices and overrides', () => {
        service['getProducts'].mockReturnValue(throwError(() => new Error('x')));
        service['getProductAddOnPriceOverrides'].mockReturnValue(throwError(() => new Error('x')));
        c.ngOnInit();
        expect(c.addOnBasePrices()).toEqual({});
        expect(c.addOnOverrideDrafts()).toEqual({});
      });

      it('skips base price request when nothing is assigned', () => {
        service['getProducts'].mockClear();
        service['getProductAddOns'].mockReturnValue(of([]));
        c.ngOnInit();
        expect(service['getProducts']).not.toHaveBeenCalled();
        expect(c.addOnBasePrices()).toEqual({});
      });

      it('removeAddOn does optimistic update and posts remaining assignments', () => {
        c.removeAddOn('s2');
        expect(service['assignProductAddOns']).toHaveBeenCalledWith('p1', [
          { addOnId: 'e1', addOnType: AddOnTypeEnum.Extra },
          { addOnId: 's1', addOnType: AddOnTypeEnum.Size },
        ]);
        expect(c.totalAssignedAddOnsCount()).toBe(2);
        expect(alerts['successDeleted']).toHaveBeenCalledWith('Add-on');
      });

      it('removeAddOn drops empty groups and reloads on failure', () => {
        service['assignProductAddOns'].mockReturnValue(throwError(() => new Error('x')));
        service['getProductAddOns'].mockClear();
        c.removeAddOn('e1');
        expect(alerts['error']).toHaveBeenCalledWith('upd-product add-ons');
        expect(service['getProductAddOns']).toHaveBeenCalledWith('p1');
      });

      it('onAddOnOverrideInput updates the draft', () => {
        c.onAddOnOverrideInput('s1', { target: { value: '12.5' } } as unknown as Event);
        expect(c.getAddOnOverrideDraft('s1')).toBe('12.5');
      });

      it('creates a new override when none exists', () => {
        c.onAddOnOverrideInput('s1', { target: { value: '15' } } as unknown as Event);
        c.saveAddOnPriceOverride('s1', 20);
        expect(service['createProductAddOnPriceOverride']).toHaveBeenCalledWith({
          productId: 'p1',
          addOnId: 's1',
          price: 15,
          isActive: true,
        });
        expect(c.hasAddOnPriceOverride('s1')).toBe(true);
        expect(c.getAddOnOverrideDraft('s1')).toBe('15');
        expect(c.isAddOnOverrideSaving('s1')).toBe(false);
        expect(alerts['successSaved']).toHaveBeenCalledWith('Add-on price override');
      });

      it('updates an existing override', () => {
        c.onAddOnOverrideInput('s2', { target: { value: '9' } } as unknown as Event);
        c.saveAddOnPriceOverride('s2', 10);
        expect(service['updateProductAddOnPriceOverride']).toHaveBeenCalledWith({
          productId: 'p1',
          addOnId: 's2',
          price: 9,
          isActive: true,
        });
        expect(service['createProductAddOnPriceOverride']).not.toHaveBeenCalled();
      });

      it('does not create an override equal to the default price', () => {
        c.onAddOnOverrideInput('s1', { target: { value: '20' } } as unknown as Event);
        c.saveAddOnPriceOverride('s1', 20);
        expect(service['createProductAddOnPriceOverride']).not.toHaveBeenCalled();
      });

      it('rejects non numeric drafts', () => {
        c.onAddOnOverrideInput('s1', { target: { value: 'abc' } } as unknown as Event);
        c.saveAddOnPriceOverride('s1', 20);
        expect(alerts['error']).toHaveBeenCalledWith('Override price must be a valid amount.');
        expect(service['createProductAddOnPriceOverride']).not.toHaveBeenCalled();
      });

      it('an empty draft clears an existing override and does nothing otherwise', () => {
        c.saveAddOnPriceOverride('s1', 20);
        expect(service['deleteProductAddOnPriceOverride']).not.toHaveBeenCalled();
        c.onAddOnOverrideInput('s2', { target: { value: '  ' } } as unknown as Event);
        c.saveAddOnPriceOverride('s2', 10);
        expect(service['deleteProductAddOnPriceOverride']).toHaveBeenCalledWith('p1', 's2');
        expect(c.hasAddOnPriceOverride('s2')).toBe(false);
        expect(c.getAddOnOverrideDraft('s2')).toBe('');
        expect(alerts['successDeleted']).toHaveBeenCalledWith('Add-on price override');
      });

      it('shows errors from override save and clear', () => {
        service['updateProductAddOnPriceOverride'].mockReturnValue(throwError(() => new Error('')));
        c.onAddOnOverrideInput('s2', { target: { value: '9' } } as unknown as Event);
        c.saveAddOnPriceOverride('s2', 10);
        expect(alerts['error']).toHaveBeenLastCalledWith('upd-override');
        expect(c.isAddOnOverrideSaving('s2')).toBe(false);

        service['deleteProductAddOnPriceOverride'].mockReturnValue(throwError(() => new Error('nope')));
        c.clearAddOnPriceOverride('s2');
        expect(alerts['error']).toHaveBeenLastCalledWith('nope');
        expect(c.hasAddOnPriceOverride('s2')).toBe(true);
        expect(c.isAddOnOverrideSaving('s2')).toBe(false);
      });

      it('clear falls back to default delete message', () => {
        service['deleteProductAddOnPriceOverride'].mockReturnValue(throwError(() => new Error('')));
        c.clearAddOnPriceOverride('s2');
        expect(alerts['error']).toHaveBeenLastCalledWith('del-default');
      });

      it('clear is a no-op when there is no override', () => {
        c.clearAddOnPriceOverride('s1');
        expect(service['deleteProductAddOnPriceOverride']).not.toHaveBeenCalled();
      });
    });

    describe('linked products for add-ons', () => {
      beforeEach(() => {
        service['getProduct'].mockReturnValue(of(product({ isAddOn: true })));
        service['getLinkedProducts'].mockReturnValue(
          of([
            group(AddOnTypeEnum.Size, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]),
            group(AddOnTypeEnum.Extra, [{ id: 'c', name: 'C' }]),
          ]),
        );
        fixture.detectChanges();
      });

      it('removeLinkedProduct updates optimistically and posts assignments', () => {
        c.removeLinkedProduct('a');
        expect(service['assignLinkedProducts']).toHaveBeenCalledWith('p1', [
          { productId: 'b', addOnType: AddOnTypeEnum.Size },
          { productId: 'c', addOnType: AddOnTypeEnum.Extra },
        ]);
        expect(alerts['successDeleted']).toHaveBeenCalledWith('Linked product');
        expect(c.totalLinkedCount()).toBe(2);
      });

      it('reloads linked products on failure', () => {
        service['assignLinkedProducts'].mockReturnValue(throwError(() => new Error('x')));
        service['getLinkedProducts'].mockClear();
        c.removeLinkedProduct('c');
        expect(alerts['error']).toHaveBeenCalledWith('upd-linked products');
        expect(service['getLinkedProducts']).toHaveBeenCalledWith('p1');
      });
    });

    describe('swapper modals', () => {
      let showModal: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        showModal = vi.fn();
        (HTMLDialogElement.prototype as any).showModal = showModal;
        (HTMLDialogElement.prototype as any).close = vi.fn();
        fixture.detectChanges();
      });

      afterEach(() => {
        delete (HTMLDialogElement.prototype as any).showModal;
        delete (HTMLDialogElement.prototype as any).close;
      });

      it('opens the add-ons manager and reloads add-ons on close', () => {
        const modal = document.querySelector('#addons-swapper-modal') as HTMLDialogElement;
        expect(modal).not.toBeNull();
        service['getProductAddOns'].mockClear();
        c.openAddOnsManager();
        expect(showModal).toHaveBeenCalled();
        modal.dispatchEvent(new Event('close'));
        expect(service['getProductAddOns']).toHaveBeenCalledWith('p1');
      });

      it('opens the products manager and reloads linked on close', () => {
        const modal = document.querySelector('#products-swapper-modal') as HTMLDialogElement;
        expect(modal).not.toBeNull();
        service['getLinkedProducts'].mockClear();
        c.openProductsManager();
        expect(showModal).toHaveBeenCalled();
        modal.dispatchEvent(new Event('close'));
        expect(service['getLinkedProducts']).toHaveBeenCalledWith('p1');
      });
    });
  });

  describe('image selection', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it.each(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'])(
      'accepts %s and creates a preview',
      async (type) => {
        const f = fileOf(type);
        c.onFileSelected(fileEvent(f));
        expect(c.selectedFile()).toBe(f);
        await vi.waitFor(() => expect(c.imagePreview()).toContain('data:'));
      },
    );

    it('rejects invalid types and oversized files', () => {
      c.onFileSelected(fileEvent(fileOf('application/pdf')));
      expect(alerts['errorInvalidImageType']).toHaveBeenCalled();
      c.onFileSelected(fileEvent(fileOf('image/png', 5 * 1024 * 1024 + 1)));
      expect(alerts['errorFileTooLarge']).toHaveBeenCalled();
      expect(c.selectedFile()).toBeNull();
    });

    it('accepts exactly 5MB and ignores empty selection', () => {
      c.onFileSelected(fileEvent());
      expect(c.selectedFile()).toBeNull();
      const f = fileOf('image/png', 5 * 1024 * 1024);
      c.onFileSelected(fileEvent(f));
      expect(c.selectedFile()).toBe(f);
    });

    it('removeImage clears the selection', () => {
      c.selectedFile.set(fileOf('image/png'));
      c.imagePreview.set('data:x');
      c.removeImage();
      expect(c.selectedFile()).toBeNull();
      expect(c.imagePreview()).toBeNull();
    });

    describe('drag and drop', () => {
      function dropEvent(file?: File): DragEvent {
        return {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          dataTransfer: { files: file ? [file] : [] },
        } as unknown as DragEvent;
      }

      it('tracks dragging state', () => {
        const ev = dropEvent();
        c.onDragOver(ev);
        expect(c.isDragging()).toBe(true);
        expect(ev.preventDefault).toHaveBeenCalled();
        c.onDragLeave(dropEvent());
        expect(c.isDragging()).toBe(false);
      });

      it('accepts a valid dropped file', async () => {
        const f = fileOf('image/png');
        c.isDragging.set(true);
        c.onFileDrop(dropEvent(f));
        expect(c.isDragging()).toBe(false);
        expect(c.selectedFile()).toBe(f);
        await vi.waitFor(() => expect(c.imagePreview()).toContain('data:'));
      });

      it('rejects invalid type, large file, and empty drop', () => {
        c.onFileDrop(dropEvent(fileOf('text/plain')));
        expect(alerts['errorInvalidImageType']).toHaveBeenCalled();
        c.onFileDrop(dropEvent(fileOf('image/png', 6 * 1024 * 1024)));
        expect(alerts['errorFileTooLarge']).toHaveBeenCalled();
        c.onFileDrop(dropEvent());
        expect(c.selectedFile()).toBeNull();
      });
    });

    it('uploadImage does nothing without a file or id', () => {
      c.uploadImage();
      c.selectedFile.set(fileOf('image/png'));
      c.uploadImage();
      expect(service['uploadProductImage']).not.toHaveBeenCalled();
    });
  });

  describe('unsaved changes guard', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('allows leaving when pristine', () => {
      expect(c.canDeactivate()).toBe(true);
    });

    it('allows leaving after a successful save', () => {
      fillValid();
      c.productForm.markAsDirty();
      c.saveProduct();
      expect(c.canDeactivate()).toBe(true);
    });

    it('prompts when dirty, and resolves true on discard', async () => {
      c.productForm.markAsDirty();
      const result = c.canDeactivate() as Promise<boolean>;
      expect(c.showDiscardModal()).toBe(true);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(true);
      c.confirmDiscard();
      await expect(result).resolves.toBe(true);
      expect(c.showDiscardModal()).toBe(false);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('resolves false on keep editing, including via the modal stack', async () => {
      c.productForm.markAsDirty();
      const first = c.canDeactivate() as Promise<boolean>;
      c.cancelDiscard();
      await expect(first).resolves.toBe(false);
      const second = c.canDeactivate() as Promise<boolean>;
      TestBed.inject(ModalStackService).pop();
      await expect(second).resolves.toBe(false);
      expect(c.showDiscardModal()).toBe(false);
    });

    it('confirm/cancel without a pending prompt are safe', () => {
      c.confirmDiscard();
      c.cancelDiscard();
      expect(c.showDiscardModal()).toBe(false);
    });
  });

  it('toggles the price history drawer', () => {
    setup();
    fixture.detectChanges();
    c.openPriceHistory();
    expect(c.isHistoryOpen()).toBe(true);
    c.closePriceHistory();
    expect(c.isHistoryOpen()).toBe(false);
  });
});
