import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BranchService } from '@core/services/branch.service';
import { ALL_BRANCHES } from '@shared/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IconsSpriteComponent } from '../icons/icons-sprite/icons-sprite';
import { BranchSwitcherComponent } from './branch-switcher';

describe('BranchSwitcherComponent', () => {
  const activeId = signal<string>('b-1');
  const switchTo = vi.fn();
  const select = vi.fn();

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
  };

  function setup() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IconsSpriteComponent],
      providers: [{ provide: BranchService, useValue: fake }],
    });
    const fixture = TestBed.createComponent(BranchSwitcherComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    activeId.set('b-1');
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
});
