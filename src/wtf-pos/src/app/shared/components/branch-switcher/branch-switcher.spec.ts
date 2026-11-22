import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BranchService } from '@core/services/branch.service';
import { ConnectivityService } from '@core/services/connectivity.service';
import { ALL_BRANCHES } from '@shared/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IconsSpriteComponent } from '../icons/icons-sprite/icons-sprite';
import { BranchSwitcherComponent } from './branch-switcher';

describe('BranchSwitcherComponent', () => {
  const activeId = signal<string>('b-1');
  const switchTo = vi.fn();
  const select = vi.fn();
  const online = signal(true);
  const cachedBranchId = signal<string | null | undefined>('b-1');

  const fake = {
    isMultiBranch: () => true,
    canSeeAll: () => true,
    branches: () => [
      { id: 'b-1', name: 'Makati Main Branch', code: 'MKT', isActive: true },
      { id: 'b-2', name: 'BGC Taguig', code: 'BGC', isActive: true },
    ],
    activeId,
    isAllSelected: () => activeId() === ALL_BRANCHES,
    activeCode: () => (activeId() === ALL_BRANCHES ? 'All' : activeId() === 'b-1' ? 'MKT' : 'BGC'),
    activeLabel: () =>
      activeId() === ALL_BRANCHES ? 'All branches' : activeId() === 'b-1' ? 'Makati Main Branch' : 'BGC Taguig',
    switchTo,
    select,
    menuBranchId: cachedBranchId,
  };

  function setup() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IconsSpriteComponent],
      providers: [
        { provide: BranchService, useValue: fake },
        { provide: ConnectivityService, useValue: { isOnline: online } },
      ],
    });
    const fixture = TestBed.createComponent(BranchSwitcherComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    activeId.set('b-1');
    online.set(true);
    cachedBranchId.set('b-1');
    switchTo.mockReset();
    select.mockReset();
  });

  it('shows only the branch code on the closed button, with the full name as its label', () => {
    const button = setup().querySelector('[data-testid="branch-switcher-button"]')!;

    expect(button.textContent!.trim()).toBe('MKT');
    expect(button.getAttribute('aria-label')).toContain('Makati Main Branch');
  });

  it('shows "All" on the closed button when all branches are selected', () => {
    activeId.set(ALL_BRANCHES);
    const button = setup().querySelector('[data-testid="branch-switcher-button"]')!;

    expect(button.textContent!.trim()).toBe('All');
  });

  it('keeps the full names in the open list', () => {
    const menu = setup().querySelector('[data-testid="branch-switcher-menu"]')!;

    expect(menu.textContent).toContain('Makati Main Branch');
    expect(menu.textContent).toContain('BGC Taguig');
  });

  it('saves the choice without changing the shown branch before the reload', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const el = setup();

    (el.querySelector('[data-testid="branch-option-all"]') as HTMLElement).click();

    expect(switchTo).toHaveBeenCalledWith(ALL_BRANCHES);
    expect(select).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('offline, only lets the person open the branch whose menu is saved on the device', () => {
    online.set(false);
    cachedBranchId.set('b-2');
    const el = setup();

    const bgc = el.querySelector('[data-testid="branch-option-BGC"]') as HTMLButtonElement;
    const makati = el.querySelector('[data-testid="branch-option-MKT"]') as HTMLButtonElement;

    expect(bgc.disabled).toBe(false);
    expect(makati.disabled).toBe(true);
    expect((el.querySelector('[data-testid="branch-option-all"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-testid="branch-offline-note"]')).not.toBeNull();
  });

  it('does not switch to a branch with no saved menu while offline', () => {
    online.set(false);
    cachedBranchId.set('b-1');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const el = setup();

    (el.querySelector('[data-testid="branch-option-BGC"]') as HTMLElement).click();

    expect(switchTo).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('lets the person open any branch online', () => {
    const el = setup();

    expect((el.querySelector('[data-testid="branch-option-BGC"]') as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('[data-testid="branch-offline-note"]')).toBeNull();
  });
});
