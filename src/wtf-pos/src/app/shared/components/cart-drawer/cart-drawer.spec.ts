import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalStackService } from '@core/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartDrawerComponent } from './cart-drawer';

interface Internals {
  drawerTransform(): string;
  drawerTransitionDuration(): string;
  hasTransitions(): boolean;
  dragOffsetY(): number;
  isDragging(): boolean;
  onDragStart(e: unknown): void;
  onDragMove(e: unknown): void;
  onDragEnd(): void;
}

@Component({
  imports: [CartDrawerComponent],
  template: `<app-cart-drawer [isOpen]="open" ariaLabel="My cart"
    ><p class="content">Hi</p></app-cart-drawer
  >`,
})
class HostComponent {
  public open = false;
}

function touchEvent(y: number, handle = true) {
  const target = document.createElement('div');
  if (handle) {
    target.setAttribute('data-cart-drag-handle', '');
  }
  return { target, touches: [{ clientY: y }] };
}

describe('CartDrawerComponent', () => {
  let stack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    stack = { push: vi.fn().mockReturnValue(7), remove: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: ModalStackService, useValue: stack }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(open = false) {
    const fixture = TestBed.createComponent(CartDrawerComponent);
    fixture.componentRef.setInput('isOpen', open);
    fixture.detectChanges();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    return { fixture, closed, i: fixture.componentInstance as unknown as Internals };
  }

  it('smoke renders projected content inside a labelled dialog', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open = true;
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.content')?.textContent).toBe('Hi');
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-label')).toBe('My cart');
    expect(dialog.getAttribute('tabindex')).toBe('0');
  });

  it('is translated off screen when closed and not focusable', () => {
    const { fixture, i } = setup(false);
    expect(i.drawerTransform()).toBe('translateY(100%)');
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('tabindex')).toBe('-1');
    expect(stack.push).not.toHaveBeenCalled();
  });

  it('enables transitions after the prime delay', () => {
    const { i } = setup(true);
    expect(i.hasTransitions()).toBe(false);
    expect(i.drawerTransitionDuration()).toBe('0s');
    vi.advanceTimersByTime(16);
    expect(i.hasTransitions()).toBe(true);
    expect(i.drawerTransitionDuration()).toBe('0.3s');
  });

  it('registers on the modal stack while open and removes when closed', () => {
    const { fixture } = setup(true);
    TestBed.tick();
    expect(stack.push).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    TestBed.tick();
    expect(stack.remove).toHaveBeenCalledWith(7);
  });

  it('closes via the modal stack callback', () => {
    const { closed } = setup(true);
    TestBed.tick();
    const closeFn = stack.push.mock.calls[0][0] as () => void;
    closeFn();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('removes from modal stack on destroy', () => {
    const { fixture } = setup(true);
    TestBed.tick();
    fixture.destroy();
    expect(stack.remove).toHaveBeenCalledWith(7);
  });

  it('emits closed on Escape on the dialog and on the backdrop', () => {
    const { fixture, closed } = setup(true);
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('[role="dialog"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    el.querySelector('[aria-label="Close cart"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('tracks drag offset downward only and uses it as transform', () => {
    const { i } = setup(true);
    i.onDragStart(touchEvent(100));
    expect(i.isDragging()).toBe(true);
    expect(i.drawerTransitionDuration()).toBe('0s');
    i.onDragMove({ touches: [{ clientY: 160 }] });
    expect(i.dragOffsetY()).toBe(60);
    expect(i.drawerTransform()).toBe('translateY(60px)');
    i.onDragMove({ touches: [{ clientY: 20 }] });
    expect(i.dragOffsetY()).toBe(0);
  });

  it('ignores drags not starting on the handle or when closed', () => {
    const open = setup(true);
    open.i.onDragStart(touchEvent(100, false));
    expect(open.i.isDragging()).toBe(false);
    open.i.onDragMove({ touches: [{ clientY: 300 }] });
    expect(open.i.dragOffsetY()).toBe(0);

    const closedSetup = setup(false);
    closedSetup.i.onDragStart(touchEvent(100));
    expect(closedSetup.i.isDragging()).toBe(false);
  });

  it('closes when dragged beyond 140px and resets the offset', () => {
    const { i, closed } = setup(true);
    i.onDragStart(touchEvent(0));
    i.onDragMove({ touches: [{ clientY: 141 }] });
    i.onDragEnd();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(i.dragOffsetY()).toBe(0);
    expect(i.isDragging()).toBe(false);
  });

  it('does not close when dragged 140px or less', () => {
    const { i, closed } = setup(true);
    i.onDragStart(touchEvent(0));
    i.onDragMove({ touches: [{ clientY: 140 }] });
    i.onDragEnd();
    expect(closed).not.toHaveBeenCalled();
    expect(i.dragOffsetY()).toBe(0);
  });

  it('onDragEnd without drag is a no-op', () => {
    const { i, closed } = setup(true);
    i.onDragEnd();
    expect(closed).not.toHaveBeenCalled();
  });
});
