import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { PullToRefreshComponent } from './pull-to-refresh';

interface Internals {
  pullDistance: { (): number; set(v: number): void };
  indicatorHeight(): number;
  isPastThreshold(): boolean;
  pullRotation(): number;
  onTouchStart(e: unknown): void;
  onTouchMove(e: unknown): void;
  onTouchEnd(): void;
}

function touch(y: number) {
  return { touches: [{ clientY: y }], preventDefault: vi.fn() };
}

function setup(refreshing = false) {
  const fixture = TestBed.createComponent(PullToRefreshComponent);
  fixture.componentRef.setInput('refreshing', refreshing);
  fixture.detectChanges();
  const cmp = fixture.componentInstance;
  const internals = cmp as unknown as Internals;
  const refresh = vi.fn();
  cmp.refreshTriggered.subscribe(refresh);
  return { fixture, internals, refresh };
}

describe('PullToRefreshComponent', () => {
  it('renders the scroll container and no indicator content initially', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.overflow-y-auto')).toBeTruthy();
    expect(el.textContent).not.toContain('Pull down');
  });

  it('applies resistance of 0.5 to the pull delta', () => {
    const { internals } = setup();
    internals.onTouchStart(touch(100));
    const move = touch(180);
    internals.onTouchMove(move);
    expect(internals.pullDistance()).toBe(40);
    expect(move.preventDefault).toHaveBeenCalled();
  });

  it('caps the pull distance at 120', () => {
    const { internals } = setup();
    internals.onTouchStart(touch(0));
    internals.onTouchMove(touch(1000));
    expect(internals.pullDistance()).toBe(120);
  });

  it('computes threshold and rotation', () => {
    const { internals } = setup();
    internals.pullDistance.set(40);
    expect(internals.isPastThreshold()).toBe(false);
    expect(internals.pullRotation()).toBe(90);
    internals.pullDistance.set(80);
    expect(internals.isPastThreshold()).toBe(true);
    internals.pullDistance.set(120);
    expect(internals.pullRotation()).toBe(180);
  });

  it('emits refreshTriggered when released past the threshold', () => {
    const { internals, refresh } = setup();
    internals.onTouchStart(touch(0));
    internals.onTouchMove(touch(200));
    internals.onTouchEnd();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(internals.pullDistance()).toBe(0);
  });

  it('does not emit when released below the threshold', () => {
    const { internals, refresh } = setup();
    internals.onTouchStart(touch(0));
    internals.onTouchMove(touch(100));
    internals.onTouchEnd();
    expect(refresh).not.toHaveBeenCalled();
    expect(internals.pullDistance()).toBe(0);
  });

  it('cancels the pull when the user moves upward', () => {
    const { internals, refresh } = setup();
    internals.onTouchStart(touch(100));
    internals.onTouchMove(touch(200));
    internals.onTouchMove(touch(50));
    expect(internals.pullDistance()).toBe(0);
    internals.onTouchMove(touch(400));
    expect(internals.pullDistance()).toBe(0);
    internals.onTouchEnd();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores moves and ends without a started pull', () => {
    const { internals, refresh } = setup();
    internals.onTouchMove(touch(300));
    expect(internals.pullDistance()).toBe(0);
    internals.onTouchEnd();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not start pulling when not scrolled to top', () => {
    const { fixture, internals } = setup();
    const container = (fixture.nativeElement as HTMLElement).querySelector(
      '.overflow-y-auto',
    ) as HTMLElement;
    Object.defineProperty(container, 'scrollTop', { value: 50, configurable: true });
    internals.onTouchStart(touch(0));
    internals.onTouchMove(touch(200));
    expect(internals.pullDistance()).toBe(0);
  });

  it('does not start pulling while refreshing and shows fixed indicator height', () => {
    const { fixture, internals } = setup(true);
    internals.onTouchStart(touch(0));
    internals.onTouchMove(touch(200));
    expect(internals.pullDistance()).toBe(0);
    expect(internals.indicatorHeight()).toBe(48);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Refreshing...');
  });

  it('shows the pull hint text and release text based on threshold', () => {
    const { fixture, internals } = setup();
    internals.pullDistance.set(20);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Pull down to refresh');
    internals.pullDistance.set(90);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Release to refresh');
  });

  it('re-emits scroll events as contentScrolled', () => {
    const { fixture } = setup();
    const spy = vi.fn();
    fixture.componentInstance.contentScrolled.subscribe(spy);
    const container = (fixture.nativeElement as HTMLElement).querySelector(
      '.overflow-y-auto',
    ) as HTMLElement;
    container.dispatchEvent(new Event('scroll'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
