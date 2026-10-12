import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalStackService } from '@core/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SideDrawerComponent } from './side-drawer';

@Component({
  imports: [SideDrawerComponent],
  template: `
    <app-side-drawer
      [isOpen]="open()"
      [title]="'Filters'"
      [subtitle]="subtitle()"
      [leadingIconName]="icon()"
      [showOnDesktop]="desktop()"
      [doneAriaLabel]="'Close it'"
      (closed)="closedCount = closedCount + 1"
    >
      <p class="projected">Body</p>
    </app-side-drawer>
  `,
})
class HostComponent {
  public readonly open = signal(false);
  public readonly subtitle = signal('');
  public readonly icon = signal<string | null>(null);
  public readonly desktop = signal(false);
  public closedCount = 0;
}

describe('SideDrawerComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const stack = TestBed.inject(ModalStackService);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    TestBed.tick();
    const el = fixture.nativeElement as HTMLElement;
    return { stack, fixture, host: fixture.componentInstance, el };
  }

  const dialog = (el: HTMLElement) => el.querySelector('[role="dialog"]') as HTMLElement;

  it('renders title, projected content and aria label', () => {
    const { el } = setup();
    expect(el.querySelector('h2')!.textContent).toBe('Filters');
    expect(el.querySelector('.projected')!.textContent).toBe('Body');
    expect(dialog(el).getAttribute('aria-label')).toBe('Filters');
  });

  it('reflects the open state in classes and tabindex', () => {
    const { fixture, host, el } = setup();
    expect(dialog(el).classList).toContain('translate-x-full');
    expect(dialog(el).getAttribute('tabindex')).toBe('-1');

    host.open.set(true);
    fixture.detectChanges();
    expect(dialog(el).classList).toContain('translate-x-0');
    expect(dialog(el).getAttribute('tabindex')).toBe('0');
  });

  it('renders subtitle only when provided', () => {
    const { fixture, host, el } = setup();
    expect(el.querySelector('p.text-xs')).toBeNull();
    host.subtitle.set('Narrow results');
    fixture.detectChanges();
    expect(el.querySelector('p.text-xs')!.textContent).toBe('Narrow results');
  });

  it('shows the fallback svg icon unless a leading icon is given', () => {
    const { fixture, host, el } = setup();
    expect(el.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    host.icon.set('icon-history');
    fixture.detectChanges();
    expect(el.querySelector('svg[aria-hidden="true"]')).toBeNull();
  });

  it('hides on desktop only when showOnDesktop is false', () => {
    const { fixture, host, el } = setup();
    expect(dialog(el).classList).toContain('md:hidden');
    host.desktop.set(true);
    fixture.detectChanges();
    expect(dialog(el).classList).not.toContain('md:hidden');
  });

  it('enables transitions after the prime delay', () => {
    const { fixture, el } = setup();
    expect(dialog(el).classList).toContain('duration-0');
    vi.advanceTimersByTime(16);
    fixture.detectChanges();
    expect(dialog(el).classList).not.toContain('duration-0');
    expect(dialog(el).classList).toContain('app-drawer-panel');
  });

  it('emits closed from the close button and the backdrop', () => {
    const { fixture, host, el } = setup();
    (el.querySelector('[aria-label="Close it"]') as HTMLButtonElement).click();
    expect(host.closedCount).toBe(1);
    (el.querySelector('[aria-label="Close filters"]') as HTMLElement).click();
    expect(host.closedCount).toBe(2);
    fixture.detectChanges();
  });

  it('emits closed on Escape inside the dialog', () => {
    const { host, el } = setup();
    dialog(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.closedCount).toBe(1);
  });

  it('registers on the modal stack while open and closes via pop', () => {
    const { fixture, host, stack } = setup();
    expect(stack.hasOpen()).toBe(false);

    host.open.set(true);
    fixture.detectChanges();
    TestBed.tick();
    expect(stack.hasOpen()).toBe(true);

    expect(stack.pop()).toBe(true);
    expect(host.closedCount).toBe(1);
  });

  it('removes itself from the modal stack when closed', () => {
    const { fixture, host, stack } = setup();
    host.open.set(true);
    fixture.detectChanges();
    TestBed.tick();
    host.open.set(false);
    fixture.detectChanges();
    TestBed.tick();
    expect(stack.hasOpen()).toBe(false);
  });

  it('removes itself from the modal stack on destroy', () => {
    const { fixture, host, stack } = setup();
    host.open.set(true);
    fixture.detectChanges();
    TestBed.tick();
    fixture.destroy();
    expect(stack.hasOpen()).toBe(false);
  });
});
