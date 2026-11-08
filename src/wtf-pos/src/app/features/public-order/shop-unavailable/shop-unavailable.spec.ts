import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ShopUnavailableComponent } from './shop-unavailable';

describe('ShopUnavailableComponent', () => {
  function create(phone: string | null) {
    const fixture = TestBed.createComponent(ShopUnavailableComponent);
    fixture.componentRef.setInput('shopName', 'Cafe One');
    fixture.componentRef.setInput('phone', phone);
    fixture.detectChanges();

    return fixture;
  }

  it('names the shop and its phone, and says the link is fine', () => {
    const text = (create('0917 000 0000').nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain("can't take orders right now");
    expect(text).toContain('Cafe One');
    expect(text).toContain('0917 000 0000');
    expect(text).not.toContain('no longer valid');
  });

  it('leaves the phone out when the shop has none', () => {
    const el = create(null).nativeElement as HTMLElement;

    expect(el.querySelector('a')).toBeNull();
  });

  it('asks the page to try again', () => {
    const fixture = create(null);
    let tried = 0;
    fixture.componentInstance.retry.subscribe(() => tried++);
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();

    expect(tried).toBe(1);
  });
});
