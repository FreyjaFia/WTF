import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { PromotionsComponent } from './promotions';

describe('PromotionsComponent', () => {
  it('renders without errors and hosts a router outlet', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PromotionsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });

  it('applies the layout host classes', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PromotionsComponent);
    expect(fixture.nativeElement.classList.contains('flex-1')).toBe(true);
    expect(fixture.nativeElement.classList.contains('flex-col')).toBe(true);
  });
});
