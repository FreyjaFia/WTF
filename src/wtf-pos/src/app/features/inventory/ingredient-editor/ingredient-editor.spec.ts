import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AlertService, AuthService, InventoryService, ModalStackService } from '@core/services';
import { ItemDto, ProductIngredientsEditDto, RecipePreviewDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { IngredientEditorComponent } from './ingredient-editor';

const milk = {
  id: 'i1',
  name: 'Milk',
  unitName: 'ml',
  usableCost: 0.15,
  isActive: true,
} as ItemDto;
const cup = { id: 'i2', name: 'Cup', unitName: 'pc', usableCost: 4, isActive: true } as ItemDto;
const syrup = {
  id: 'i3',
  name: 'Syrup',
  unitName: 'ml',
  usableCost: null,
  isActive: true,
} as ItemDto;

const latte: ProductIngredientsEditDto = {
  productId: 'p1',
  name: 'Latte',
  price: 150,
  isAddOn: false,
  recipeMultiplier: 1,
  showsCosts: true,
  suppliesCost: 0,
  lines: [
    {
      linkId: 'l1',
      itemId: 'i1',
      itemName: 'Milk',
      unitName: 'ml',
      quantityPerSale: 200,
      allowancePercent: 5,
      scalesWithSize: false,
      replacesItemId: null,
      replacesItemName: null,
      unitCost: 0.15,
      lineCost: 31.5,
    },
  ],
  totalCost: 31.5,
  unknownCostCount: 0,
  margin: 118.5,
  marginPercent: 79,
};

const preview: RecipePreviewDto = {
  productId: 'p1',
  productName: 'Latte',
  price: 180,
  addOnNames: ['Large'],
  lines: [
    {
      itemId: 'i1',
      itemName: 'Milk',
      unitName: 'ml',
      quantity: 300,
      unitCost: 0.15,
      lineCost: 45,
      sourceName: null,
    },
  ],
  replacedItemNames: [],
  suppliesCost: 0,
  totalCost: 45,
  unknownCostCount: 0,
  margin: 135,
  marginPercent: 75,
  warnings: [],
} as RecipePreviewDto;

const sizedLatte: ProductIngredientsEditDto = {
  ...latte,
  sizes: [{ productId: 's1', name: 'Large', recipeMultiplier: 1.5 }],
  addOnOptions: [{ productId: 's1', name: 'Large', isSize: true, recipeMultiplier: 1.5 }],
};

describe('IngredientEditorComponent', () => {
  function setup(options: { product?: ProductIngredientsEditDto; canWrite?: boolean } = {}) {
    const inventory = {
      getProductIngredientsEdit: vi.fn().mockReturnValue(of(options.product ?? latte)),
      getInventoryItems: vi.fn().mockReturnValue(of([milk, cup, syrup])),
      saveProductIngredients: vi.fn().mockReturnValue(of(options.product ?? latte)),
      setSuppliesCost: vi.fn().mockReturnValue(of(undefined)),
      getProductRecipePreview: vi.fn().mockReturnValue(of(preview)),
    };
    const alerts = { error: vi.fn(), success: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: { push: () => 1, remove: vi.fn() } },
        {
          provide: AuthService,
          useValue: {
            canWriteItems: () => options.canWrite ?? true,
            canWriteInventoryCosts: () => true,
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'p1' } } } },
      ],
    });
    const fixture = TestBed.createComponent(IngredientEditorComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, inventory, alerts, el };
  }

  const setValue = (
    fixture: { detectChanges: () => void },
    el: HTMLElement,
    testId: string,
    value: string,
  ) => {
    const input = el.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  it('shows the saved lines and the cost and margin', () => {
    const { el } = setup();

    expect(el.querySelectorAll('[data-testid="ingredient-line"]').length).toBe(1);
    expect(el.querySelector('[data-testid="total-cost"]')?.textContent).toContain('31.50');
    expect(el.querySelector('[data-testid="margin"]')?.textContent).toContain('118.50');
  });

  it('updates the cost live when the amount changes', () => {
    const { fixture, el } = setup();
    setValue(fixture, el, 'line-amount', '100');

    expect(el.querySelector('[data-testid="total-cost"]')?.textContent).toContain('15.75');
  });

  it('adds an ingredient and counts one with no cost as unknown', () => {
    const { fixture, el } = setup();
    const add = el.querySelector('[data-testid="add-ingredient"]') as HTMLSelectElement;
    add.value = 'i3';
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(el.querySelectorAll('[data-testid="ingredient-line"]').length).toBe(2);
    expect(el.querySelector('[data-testid="unknown-costs"]')?.textContent).toContain(
      '1 ingredient',
    );
  });

  it('does not offer an item that is already listed', () => {
    const { el } = setup();
    const options = [...el.querySelectorAll('[data-testid="add-ingredient"] option')].map((o) =>
      o.textContent?.trim(),
    );

    expect(options).not.toContain('Milk');
    expect(options).toContain('Cup');
  });

  it('removes a line', () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-testid="remove-line"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelectorAll('[data-testid="ingredient-line"]').length).toBe(0);
    expect(el.querySelector('[data-testid="ingredients-empty"]')).not.toBeNull();
  });

  it('saves the list, and the supplies cost when it changed', () => {
    const { fixture, inventory, alerts, el } = setup();
    setValue(fixture, el, 'supplies-cost', '2');
    (el.querySelector('[data-testid="save-ingredients"]') as HTMLButtonElement).click();

    expect(inventory.setSuppliesCost).toHaveBeenCalledWith('p1', 2);
    expect(inventory.saveProductIngredients).toHaveBeenCalledWith('p1', [
      {
        itemId: 'i1',
        quantityPerSale: 200,
        allowancePercent: 5,
        scalesWithSize: false,
        replacesItemId: null,
        sizeAmounts: [],
      },
    ]);
    expect(alerts.success).toHaveBeenCalled();
  });

  it('leaves the supplies cost alone when it did not change', () => {
    const { fixture, inventory, el } = setup();
    setValue(fixture, el, 'line-amount', '250');
    (el.querySelector('[data-testid="save-ingredients"]') as HTMLButtonElement).click();

    expect(inventory.setSuppliesCost).not.toHaveBeenCalled();
    expect(inventory.saveProductIngredients).toHaveBeenCalledTimes(1);
  });

  it('shows the server message when saving fails', () => {
    const { fixture, inventory, alerts, el } = setup();
    inventory.saveProductIngredients.mockReturnValue(throwError(() => new Error('Refused.')));
    setValue(fixture, el, 'line-amount', '250');
    (el.querySelector('[data-testid="save-ingredients"]') as HTMLButtonElement).click();

    expect(alerts.error).toHaveBeenCalledWith('Refused.');
  });

  it('only offers Replaces on an add-on', () => {
    const plain = setup();
    expect(plain.el.querySelector('[data-testid="line-replaces"]')).toBeNull();
    TestBed.resetTestingModule();

    const addOn = setup({ product: { ...latte, isAddOn: true } });
    expect(addOn.el.querySelector('[data-testid="line-replaces"]')).not.toBeNull();
  });

  it('hides costs and editing from roles that cannot see or write them', () => {
    const { el } = setup({
      product: { ...latte, showsCosts: false, suppliesCost: null },
      canWrite: false,
    });

    expect(el.querySelector('[data-testid="cost-summary"]')).toBeNull();
    expect(el.querySelector('[data-testid="save-ingredients"]')).toBeNull();
    expect(el.querySelector('[data-testid="add-ingredient"]')).toBeNull();
  });

  it('asks before leaving with unsaved changes', () => {
    const { fixture, el } = setup();
    expect(fixture.componentInstance['canDeactivate']()).toBe(true);

    setValue(fixture, el, 'line-amount', '250');

    expect(fixture.componentInstance.canDeactivate()).toBeInstanceOf(Promise);
  });

  it('shows the size grid and fills a size from the amount times its multiplier', () => {
    const { fixture, el } = setup({ product: sizedLatte });
    expect(el.querySelector('[data-testid="size-grid"]')).not.toBeNull();

    (el.querySelector('[data-testid="fill-size"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const cell = el.querySelector('[data-testid="size-amount"]') as HTMLInputElement;
    expect(cell.value).toBe('300');
  });

  it('does not scale a whole piece by a fraction when it fills a size', () => {
    const withCup: ProductIngredientsEditDto = {
      ...sizedLatte,
      lines: [
        ...sizedLatte.lines,
        {
          ...sizedLatte.lines[0],
          linkId: 'l2',
          itemId: 'i2',
          itemName: 'Cup',
          unitName: 'pc',
          quantityPerSale: 1,
        },
      ],
    };
    const { fixture, el } = setup({ product: withCup });

    (el.querySelector('[data-testid="fill-size"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const cells = [...el.querySelectorAll('[data-testid="size-amount"]')] as HTMLInputElement[];
    expect(cells.map((cell) => cell.value)).toEqual(['300', '']);
  });

  it('sends a typed size amount when saving', () => {
    const { fixture, inventory, el } = setup({ product: sizedLatte });
    setValue(fixture, el, 'size-amount', '350');
    (el.querySelector('[data-testid="save-ingredients"]') as HTMLButtonElement).click();

    expect(inventory.saveProductIngredients).toHaveBeenCalledWith('p1', [
      expect.objectContaining({ sizeAmounts: [{ sizeProductId: 's1', quantity: 350 }] }),
    ]);
  });

  it('shows the grid only when the product offers sizes', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="size-grid"]')).toBeNull();
  });

  it('previews a sale with the chosen size', () => {
    const { fixture, inventory, el } = setup({ product: sizedLatte });
    const select = el.querySelector('[data-testid="preview-size"]') as HTMLSelectElement;
    select.value = 's1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(inventory.getProductRecipePreview).toHaveBeenLastCalledWith('p1', ['s1']);
    expect(el.querySelector('[data-testid="preview-cost"]')?.textContent).toContain('45.00');
  });
});
