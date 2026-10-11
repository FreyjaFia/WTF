import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { ItemsComponent } from './items';

@Component({ selector: 'app-child', template: '<p id="child">child content</p>' })
class ChildComponent {}

describe('ItemsComponent', () => {
  it('hosts child routes inside its router outlet', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'items', component: ItemsComponent, children: [{ path: '', component: ChildComponent }] }]),
      ],
    });
    const harness = await RouterTestingHarness.create('/items');
    expect(harness.routeNativeElement?.querySelector('#child')?.textContent).toBe('child content');
    expect(TestBed.inject(Router).url).toBe('/items');
  });

  it('applies layout host classes', () => {
    const fixture = TestBed.createComponent(ItemsComponent);
    expect((fixture.nativeElement as HTMLElement).className).toContain('flex-1');
  });
});
