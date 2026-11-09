import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { SEEDED_LOOKUPS } from '@app/testing/catalog-ids';
import {
  AlertService,
  AuthService,
  CatalogLookupService,
  InventoryService,
  ModalStackService,
} from '@core/services';
import { ItemDto, ProductIngredientsEditDto } from '@shared/models';
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

const sizedLatte: ProductIngredientsEditDto = {
  ...latte,
  sizes: [{ productId: 's1', name: 'Large' }],
  addOnOptions: [{ productId: 's1', name: 'Large', isSize: true, price: 30 }],
};

describe('IngredientEditorComponent', () => {
  function setup(options: { product?: ProductIngredientsEditDto; canWrite?: boolean } = {}) {
    const inventory = {
      getProductIngredientsEdit: vi.fn().mockReturnValue(of(options.product ?? latte)),
      getInventoryItems: vi.fn().mockReturnValue(of([milk, cup, syrup])),
      saveProductIngredients: vi.fn().mockReturnValue(of(options.product ?? latte)),
      setSuppliesCost: vi.fn().mockReturnValue(of(undefined)),
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
    TestBed.inject(CatalogLookupService).set(SEEDED_LOOKUPS);
    const fixture = TestBed.createComponent(IngredientEditorComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, inventory, alerts, el };
  }

  const choose = (
    fixture: { detectChanges: () => void },
    el: HTMLElement,
    testId: string,
    text: string,
  ) => {
    (el.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
    const option = [...el.querySelectorAll(`[data-testid="${testId}-option"]`)].find(
      (o) => o.textContent?.trim() === text,
    ) as HTMLButtonElement;
    option.click();
    fixture.detectChanges();
  };
  const optionTexts = (fixture: { detectChanges: () => void }, el: HTMLElement, testId: string) => {
    (el.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
    return [...el.querySelectorAll(`[data-testid="${testId}-option"]`)].map((o) =>
      o.textContent?.trim(),
    );
  };

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

  it('suggests the price for the wanted margin and says if the price is enough', () => {
    localStorage.removeItem('wtf.ingredients.targetMargin');
    const { fixture, el } = setup();

    expect(el.querySelector('[data-testid="suggested-price"]')?.textContent).toContain('105.00');
    expect(el.querySelector('[data-testid="price-gap"]')?.textContent).toContain('already reaches');

    setValue(fixture, el, 'target-margin', '90');

    expect(el.querySelector('[data-testid="suggested-price"]')?.textContent).toContain('315.00');
    expect(el.querySelector('[data-testid="price-gap"]')?.textContent).toContain('165.00');
    expect(el.querySelector('[data-testid="price-gap"]')?.textContent).toContain('too low');
    expect(localStorage.getItem('wtf.ingredients.targetMargin')).toBe('90');
    localStorage.removeItem('wtf.ingredients.targetMargin');
  });

  it('shows no price guidance for an add-on', () => {
    const { el } = setup({ product: { ...latte, isAddOn: true } });

    expect(el.querySelector('[data-testid="price-guidance"]')).toBeNull();
  });

  it('updates the cost live when the amount changes', () => {
    const { fixture, el } = setup();
    setValue(fixture, el, 'line-amount', '100');

    expect(el.querySelector('[data-testid="total-cost"]')?.textContent).toContain('15.75');
  });

  it('adds an ingredient and counts one with no cost as unknown', () => {
    const { fixture, el } = setup();
    choose(fixture, el, 'add-ingredient', 'Syrup');

    expect(el.querySelectorAll('[data-testid="ingredient-line"]').length).toBe(2);
    expect(el.querySelector('[data-testid="unknown-costs"]')?.textContent).toContain(
      '1 ingredient',
    );
  });

  it('does not offer an item that is already listed', () => {
    const { fixture, el } = setup();
    const options = optionTexts(fixture, el, 'add-ingredient');

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

  it('shows the size grid', () => {
    const { el } = setup({ product: sizedLatte });
    expect(el.querySelector('[data-testid="size-grid"]')).not.toBeNull();
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
    const { fixture, el } = setup({ product: sizedLatte });
    const option = el.querySelector('[data-testid="preview-option"]') as HTMLElement;
    option.click();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="preview-group"] h4')?.textContent).toContain('Sizes');
    expect(el.querySelector('[data-testid="preview-price"]')?.textContent).toContain('180.00');
    expect(el.querySelector('[data-testid="preview-cost"]')?.textContent).toContain('31.50');
  });

  it('counts an add-on once per quantity when stepped up', () => {
    const { fixture, el } = setup({
      product: {
        ...sizedLatte,
        addOnOptions: [
          {
            productId: 'x1',
            name: 'Extra Shot',
            isSize: false,
            addOnType: 4,
            price: 20,
            links: [
              { itemId: 'i3', itemName: 'Syrup', unitName: 'ml', quantityPerSale: 10, allowancePercent: 0, unitCost: 0.5 },
            ],
          },
        ],
      },
    });
    (el.querySelector('[data-testid="preview-option"]') as HTMLElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="preview-plus"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="preview-qty"]')?.textContent).toContain('2');
    expect(el.querySelector('[data-testid="preview-price"]')?.textContent).toContain('190.00');
    expect(el.querySelector('[data-testid="preview-cost"]')?.textContent).toContain('41.50');
    expect([...el.querySelectorAll('[data-testid="preview-line"]')].some((l) => l.textContent?.includes('Syrup'))).toBe(true);
  });

  it('names what is previewed and flags a size amount that replaces the base', () => {
    const { fixture, el } = setup({ product: sizedLatte });
    setValue(fixture, el, 'size-amount', '350');
    (el.querySelector('[data-testid="preview-option"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="preview-title"]')?.textContent).toContain('Large');
    expect(el.querySelector('[data-testid="own-amount-note"]')?.textContent).toContain("Large's own amount, not the base 200");
  });

  it('shows one cost summary: the sale preview replaces the base card when sizes exist', () => {
    const { el } = setup({ product: sizedLatte });

    expect(el.querySelector('[data-testid="total-cost"]')).toBeNull();
    expect(el.querySelector('[data-testid="preview-cost"]')).not.toBeNull();
  });

  describe('live preview', () => {
    it('follows the unsaved lines and supplies cost at once, without asking the API', () => {
      const { fixture, inventory, el } = setup({ product: sizedLatte });

      setValue(fixture, el, 'line-amount', '300');
      setValue(fixture, el, 'supplies-cost', '2');

      expect(el.querySelector('[data-testid="preview-cost"]')?.textContent).toContain('49.25');
      expect(inventory.saveProductIngredients).not.toHaveBeenCalled();
    });

    it('leaves out lines that have no amount yet', () => {
      const { fixture, el } = setup({ product: sizedLatte });

      setValue(fixture, el, 'line-amount', '');

      expect(el.querySelectorAll('[data-testid="preview-line"]').length).toBe(0);
      expect(el.querySelector('[data-testid="preview-cost"]')?.textContent).toContain('0.00');
    });
  });
});
