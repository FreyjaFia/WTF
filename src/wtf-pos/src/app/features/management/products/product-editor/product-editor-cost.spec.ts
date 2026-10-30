/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AlertService, AuthService, InventoryService, ProductService } from '@core/services';
import { ProductCategoryEnum, ProductDto, RecipeCostDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductEditorComponent } from './product-editor';

const product = {
  id: 'p1',
  name: 'Latte',
  code: 'LAT',
  description: '',
  price: 150,
  category: ProductCategoryEnum.Drink,
  subCategory: null,
  isAddOn: false,
  isActive: true,
  priceHistory: [],
  createdAt: '2026-10-01T00:00:00Z',
} as unknown as ProductDto;

function makeCost(overrides: Partial<RecipeCostDto> = {}): RecipeCostDto {
  return {
    productId: 'p1',
    productName: 'Latte',
    price: 150,
    lines: [
      {
        linkId: 'l1',
        itemId: 'milk',
        itemName: 'Oat Milk',
        unitName: 'ml',
        quantityPerSale: 200,
        allowancePercent: 5,
        effectiveQuantity: 210,
        unitCost: 0.15,
        lineCost: 31.5,
      },
      {
        linkId: 'l2',
        itemId: 'cup',
        itemName: 'Cup',
        unitName: 'pc',
        quantityPerSale: 1,
        allowancePercent: 0,
        effectiveQuantity: 1,
        unitCost: 3,
        lineCost: 3,
      },
    ],
    totalCost: 34.5,
    unknownCostCount: 0,
    margin: 115.5,
    marginPercent: 77,
    ...overrides,
  };
}

describe('ProductEditorComponent: recipe cost card', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(options: { canReadCosts?: boolean; cost?: RecipeCostDto; fail?: boolean; id?: string | null } = {}) {
    const { canReadCosts = true, cost = makeCost(), fail = false, id = 'p1' } = options;
    const products = {
      getProduct: vi.fn(() => of(product)),
      getProducts: vi.fn(() => of([])),
      getProductAddOns: vi.fn(() => of([])),
      getProductAddOnPriceOverrides: vi.fn(() => of([])),
    };
    const inventory = {
      getInventoryItems: vi.fn(() => of([])),
      getProductRecipeCost: vi.fn(() => (fail ? throwError(() => new Error('403')) : of(cost))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: products },
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: { error: vi.fn() } },
        {
          provide: AuthService,
          useValue: { canWriteItems: () => false, canReadInventoryCosts: () => canReadCosts },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => id } } } },
      ],
    });
    const fixture = TestBed.createComponent(ProductEditorComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const card = (): HTMLElement | null => el.querySelector('[data-testid="recipe-cost"]');
    return { fixture, el, card, inventory, c: fixture.componentInstance as any };
  }

  it('loads and shows the card for roles that can read costs', () => {
    const { card, inventory } = setup();

    expect(inventory.getProductRecipeCost).toHaveBeenCalledWith('p1');
    expect(card()).not.toBeNull();
    expect(card()!.querySelectorAll('[data-testid="recipe-line"]')).toHaveLength(2);
  });

  it('hides the card and never asks for costs for other roles', () => {
    const { card, inventory } = setup({ canReadCosts: false });

    expect(inventory.getProductRecipeCost).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('hides the card for a new product', () => {
    const { card, inventory } = setup({ id: null });

    expect(inventory.getProductRecipeCost).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('shows the amount with its allowance, the total and the margin', () => {
    const { card } = setup();
    const text = card()!.textContent!.replace(/\s+/g, ' ');

    expect(text).toContain('200 ml (+5% = 210 ml)');
    expect(text).toContain('1 pc');
    expect(card()!.querySelectorAll('[data-testid="recipe-amount"]')[1].textContent).not.toContain('%');
    expect(card()!.querySelector('[data-testid="recipe-total"]')!.textContent).toContain('34.50');
    expect(card()!.querySelector('[data-testid="recipe-margin"]')!.textContent).toContain('115.50');
    expect(card()!.querySelector('[data-testid="recipe-margin-percent"]')!.textContent).toContain('77%');
    expect(card()!.querySelector('[data-testid="cost-incomplete"]')).toBeNull();
  });

  it('says what is missing when an item has no cost yet', () => {
    const cost = makeCost({ unknownCostCount: 1 });
    cost.lines[1] = { ...cost.lines[1], unitCost: null, lineCost: null };
    const { card } = setup({ cost });

    expect(card()!.querySelector('[data-testid="no-cost"]')!.textContent).toContain('No cost yet');
    expect(card()!.querySelector('[data-testid="cost-incomplete"]')!.textContent).toContain(
      'Cost is incomplete: 1 item has no cost yet',
    );
  });

  it('uses the plural in the incomplete warning', () => {
    const { card } = setup({ cost: makeCost({ unknownCostCount: 2 }) });

    expect(card()!.querySelector('[data-testid="cost-incomplete"]')!.textContent).toContain('2 items have no cost yet');
  });

  it('shows a dash when the margin percent is unknown', () => {
    const { card } = setup({ cost: makeCost({ marginPercent: null }) });

    expect(card()!.querySelector('[data-testid="recipe-margin-percent"]')!.textContent).toContain('(-)');
  });

  it('marks a negative margin in red', () => {
    const { card } = setup({ cost: makeCost({ margin: -10, marginPercent: -7 }) });
    const margin = card()!.querySelector('[data-testid="recipe-margin"]')!;

    expect(margin.classList.contains('text-red-600')).toBe(true);
  });

  it('does not use the red style for a positive margin', () => {
    const { card } = setup();

    expect(card()!.querySelector('[data-testid="recipe-margin"]')!.classList.contains('text-red-600')).toBe(false);
  });

  it('explains an empty recipe', () => {
    const { card } = setup({ cost: makeCost({ lines: [], totalCost: 0, margin: 150, marginPercent: 100 }) });

    expect(card()!.querySelector('[data-testid="recipe-empty"]')!.textContent).toContain(
      'No stock items linked, so no cost.',
    );
    expect(card()!.querySelector('[data-testid="recipe-total"]')).toBeNull();
  });

  it('hides the card quietly when the costs cannot be read', () => {
    const { card } = setup({ fail: true });

    expect(card()).toBeNull();
  });
});
