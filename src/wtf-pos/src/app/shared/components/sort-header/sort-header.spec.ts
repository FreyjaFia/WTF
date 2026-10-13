import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SortHeaderComponent } from './sort-header';

describe('SortHeaderComponent', () => {
  let fixture: ComponentFixture<SortHeaderComponent>;

  const button = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');
  const arrowWrap = (): HTMLElement => fixture.nativeElement.querySelector('span');

  beforeEach(() => {
    fixture = TestBed.createComponent(SortHeaderComponent);
    fixture.componentRef.setInput('label', 'Name');
    fixture.detectChanges();
  });

  it('hides the arrow until its column is sorted', () => {
    expect(arrowWrap().classList).toContain('opacity-0');
    expect(button().getAttribute('aria-sort')).toBe('none');

    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();

    expect(arrowWrap().classList).toContain('opacity-100');
    expect(button().getAttribute('aria-sort')).toBe('ascending');
  });

  it('reports the direction to assistive technology', () => {
    fixture.componentRef.setInput('active', true);
    fixture.componentRef.setInput('direction', 'desc');
    fixture.detectChanges();

    expect(button().getAttribute('aria-sort')).toBe('descending');
  });

  it('emits when clicked', () => {
    let clicks = 0;
    fixture.componentInstance.sorted.subscribe(() => clicks++);

    button().click();

    expect(clicks).toBe(1);
  });
});
