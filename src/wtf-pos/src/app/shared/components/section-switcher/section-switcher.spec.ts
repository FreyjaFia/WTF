import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HubGroup } from '@shared/navigation/hub-groups';
import { describe, expect, it } from 'vitest';
import { SectionSwitcherComponent } from './section-switcher';

@Component({ selector: 'app-switcher-host', template: '' })
class Stub {}

const card = (id: string, label: string, extra: Partial<HubGroup['cards'][number]> = {}) => ({
  id,
  label,
  description: '',
  route: `/inventory/${id}`,
  canShow: () => true,
  ...extra,
});

describe('SectionSwitcherComponent', () => {
  async function setup(groups: HubGroup[], url = '/inventory/items') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'inventory/items', component: Stub },
          { path: 'inventory/waste', component: Stub },
          { path: 'inventory/items/edit/:id', component: Stub },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    const fixture = TestBed.createComponent(SectionSwitcherComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('hubLabel', 'Inventory');
    fixture.componentRef.setInput('hubRoute', '/inventory');
    fixture.componentRef.setInput('testIdPrefix', 'inventory');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { harness, fixture, el };
  }

  const groups = (): HubGroup[] => [
    {
      name: 'Stock',
      description: '',
      cards: [
        card('items', 'Items'),
        card('waste', 'Waste', { badge: () => 2, urgent: () => false }),
      ],
    },
  ];

  const button = (el: HTMLElement): HTMLButtonElement =>
    el.querySelector('[data-testid="inventory-switcher-button"]') as HTMLButtonElement;
  const panel = (el: HTMLElement): HTMLElement | null =>
    el.querySelector('[data-testid="inventory-switcher-panel"]');

  it('starts closed and opens a list of every screen on tap', async () => {
    const { fixture, el } = await setup(groups());
    expect(panel(el)).toBeNull();
    expect(button(el).getAttribute('aria-expanded')).toBe('false');

    button(el).click();
    fixture.detectChanges();

    expect(panel(el)).not.toBeNull();
    expect(button(el).getAttribute('aria-expanded')).toBe('true');
    const labels = Array.from(panel(el)!.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(labels).toEqual(['Items', 'Waste2', 'All of Inventory']);
  });

  it('marks the screen you are on, including on a deeper page of it', async () => {
    const { fixture, el } = await setup(groups(), '/inventory/items/edit/3');
    button(el).click();
    fixture.detectChanges();

    const current = panel(el)!.querySelector('[aria-current="page"]');
    expect(current?.getAttribute('data-testid')).toBe('inventory-switcher-item-items');
  });

  it('shows a badge only on the screens that have one', async () => {
    const { fixture, el } = await setup(groups());
    button(el).click();
    fixture.detectChanges();

    const waste = el.querySelector('[data-testid="inventory-switcher-item-waste"]')!;
    const items = el.querySelector('[data-testid="inventory-switcher-item-items"]')!;
    expect(waste.textContent).toContain('2');
    expect(waste.querySelector('.bg-amber-500')).not.toBeNull();
    expect(items.querySelector('span.rounded-full')).toBeNull();
  });

  it('closes on Escape, on the backdrop and after choosing a screen', async () => {
    const { fixture, el } = await setup(groups());

    button(el).click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(panel(el)).toBeNull();

    button(el).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="inventory-switcher-backdrop"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(panel(el)).toBeNull();

    button(el).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="inventory-switcher-item-waste"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(panel(el)).toBeNull();
  });

  it('is not shown when there is nothing to switch to', async () => {
    const { el } = await setup([
      { name: 'Stock', description: '', cards: [card('items', 'Items')] },
    ]);
    expect(button(el)).toBeNull();
  });
});
