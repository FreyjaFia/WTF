import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { ManagementComponent } from './management';

@Component({ selector: 'app-stub-x', template: 'stub page' })
class Stub {}

describe('ManagementComponent', () => {
  async function setup(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'management',
            component: ManagementComponent,
            children: [
              { path: '', component: Stub, pathMatch: 'full' },
              { path: 'products', component: Stub },
              { path: 'products/edit/:id', component: Stub },
              { path: 'setup', component: Stub },
              { path: 'setup/categories', component: Stub },
            ],
          },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    return { harness, el: harness.routeNativeElement as HTMLElement };
  }

  const back = (el: HTMLElement): HTMLAnchorElement | null =>
    el.querySelector<HTMLAnchorElement>('[data-testid="management-back"]');

  it('has no tab bar and no way back on the hub itself', async () => {
    const { el } = await setup('/management');
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(back(el)).toBeNull();
    expect(el.textContent).toContain('stub page');
  });

  it('offers the way back to the hub on the top screen of a section', async () => {
    const { el } = await setup('/management/products');
    expect(back(el)?.getAttribute('href')).toBe('/management');
    expect(back(el)?.className).toContain('sm:hidden');
  });

  it('leaves deeper pages to their own back arrow and follows navigation', async () => {
    const { harness, el } = await setup('/management/products/edit/5');
    expect(back(el)).toBeNull();

    await harness.navigateByUrl('/management/setup');
    harness.detectChanges();
    expect(back(el)).not.toBeNull();

    await harness.navigateByUrl('/management/setup/categories');
    harness.detectChanges();
    expect(back(el)).toBeNull();
  });
});
