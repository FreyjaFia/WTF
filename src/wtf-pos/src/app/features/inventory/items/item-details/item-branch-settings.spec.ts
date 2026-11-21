import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AlertService, AuthService, InventoryService } from '@core/services';
import { ItemDto } from '@shared/models';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemBranchSettingsComponent } from './item-branch-settings';

function makeItem(): ItemDto {
  return {
    id: 'i1',
    name: 'Oat Milk',
    unitName: 'milliliter',
    currentQuantity: 1900,
    costPrice: 0.02,
    warningQuantity: 500,
    criticalQuantity: 200,
    isActive: true,
    allowNegativeStock: false,
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'u',
    priceHistory: [],
    productLinks: [],
    recentMovements: [],
    branchStocks: [
      { branchId: 'b1', branchCode: 'MKT', branchName: 'Makati', quantity: 1000, status: 'ok' },
      { branchId: 'b2', branchCode: 'BGC', branchName: 'BGC', quantity: 900, status: 'ok', warningQuantity: 1000, criticalQuantity: 400 },
    ],
  } as ItemDto;
}

describe('ItemBranchSettingsComponent', () => {
  const inventory = { saveItemBranchSettings: vi.fn(), getItemBranchSettings: vi.fn() };
  const alerts = { success: vi.fn(), error: vi.fn() };
  const auth = { canWriteItems: vi.fn(() => true), canReadInventoryCosts: vi.fn(() => true) };

  beforeEach(() => {
    vi.clearAllMocks();
    inventory.saveItemBranchSettings.mockReturnValue(of([]));
    inventory.getItemBranchSettings.mockReturnValue(of(makeItem().branchStocks));
    TestBed.configureTestingModule({
      providers: [
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: auth },
      ],
    });
  });

  function create(): { fixture: ReturnType<typeof TestBed.createComponent<ItemBranchSettingsComponent>>; ref: ComponentRef<ItemBranchSettingsComponent> } {
    const fixture = TestBed.createComponent(ItemBranchSettingsComponent);
    fixture.componentRef.setInput('item', makeItem());
    fixture.detectChanges();
    return { fixture, ref: fixture.componentRef };
  }

  it('shows one row per branch and the branch values that were set', () => {
    const { fixture } = create();
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="branch-settings-row"]');

    expect(rows.length).toBe(2);
    expect((fixture.nativeElement.querySelector('[data-testid="branch-warning-BGC"]') as HTMLInputElement).value).toBe('1000');
    expect((fixture.nativeElement.querySelector('[data-testid="branch-warning-MKT"]') as HTMLInputElement).value).toBe('');
  });

  it('shows the shop value in an empty box', () => {
    const { fixture } = create();

    expect((fixture.nativeElement.querySelector('[data-testid="branch-warning-MKT"]') as HTMLInputElement).placeholder).toBe('500');
    expect((fixture.nativeElement.querySelector('[data-testid="branch-cost-MKT"]') as HTMLInputElement).placeholder).toBe('0.02');
  });

  it('hides the cost boxes from a person who may not read costs', () => {
    auth.canReadInventoryCosts.mockReturnValue(false);
    const { fixture } = create();

    expect(fixture.nativeElement.querySelector('[data-testid="branch-cost-MKT"]')).toBeNull();
    auth.canReadInventoryCosts.mockReturnValue(true);
  });

  it('saves every branch with blanks as null', () => {
    const { fixture } = create();
    const input = fixture.nativeElement.querySelector('[data-testid="branch-cost-MKT"]') as HTMLInputElement;
    input.value = '0.03';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="branch-settings-save"]') as HTMLButtonElement).click();

    expect(inventory.saveItemBranchSettings).toHaveBeenCalledWith('i1', [
      { branchId: 'b1', warningQuantity: null, criticalQuantity: null, parLevel: null, costPrice: 0.03 },
      { branchId: 'b2', warningQuantity: 1000, criticalQuantity: 400, parLevel: null, costPrice: null },
    ]);
    expect(alerts.success).toHaveBeenCalled();
  });

  it('keeps Save off until something changed', () => {
    const { fixture } = create();

    expect((fixture.nativeElement.querySelector('[data-testid="branch-settings-save"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
