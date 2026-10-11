import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedCounterComponent } from './animated-counter';

describe('AnimatedCounterComponent', () => {
  let fixture: ComponentFixture<AnimatedCounterComponent>;
  let now = 0;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame = 1;

  function runFrame(at: number): void {
    now = at;
    const pending = [...frames.entries()];
    frames.clear();
    pending.forEach(([, cb]) => cb(at));
    fixture.detectChanges();
  }

  function setup(inputs: Record<string, unknown>): void {
    fixture = TestBed.createComponent(AnimatedCounterComponent);
    Object.entries(inputs).forEach(([k, v]) => fixture.componentRef.setInput(k, v));
    fixture.detectChanges();
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent!.replace(/\s+/g, ' ').trim();
  const span = () => root().querySelector('span') as HTMLElement;

  beforeEach(() => {
    now = 0;
    nextFrame = 1;
    frames = new Map();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      const id = nextFrame++;
      frames.set(id, cb);
      return id;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('snaps to the initial value without animating', () => {
    setup({ value: 1234 });
    expect(text()).toBe('1,234');
    expect(frames.size).toBe(0);
    expect(span().classList).not.toContain('scale-105');
  });

  it('formats with the configured decimals', () => {
    setup({ value: 12.5, decimals: 2 });
    expect(text()).toBe('12.50');
  });

  it('renders the prefix only when provided', () => {
    setup({ value: 5, prefix: 'PHP', prefixColor: 'red' });
    const prefix = root().querySelector('span span') as HTMLElement;
    expect(prefix.textContent).toBe('PHP');
    expect(prefix.style.color).toBe('red');
  });

  it('omits the prefix element when empty', () => {
    setup({ value: 5 });
    expect(root().querySelector('span span')).toBeNull();
  });

  it('animates to a new value with ease-out and highlights', () => {
    setup({ value: 0, duration: 1000 });
    fixture.componentRef.setInput('value', 100);
    fixture.detectChanges();

    expect(span().classList).toContain('scale-105');
    expect(span().style.color).not.toBe('');

    runFrame(500); // progress .5 -> eased 0.875
    expect(text()).toBe('88');
    runFrame(1000);
    expect(text()).toBe('100');
    expect(frames.size).toBe(0);
  });

  it('clears the highlight after 900ms', () => {
    setup({ value: 0 });
    fixture.componentRef.setInput('value', 10);
    fixture.detectChanges();
    expect(span().classList).toContain('scale-105');

    vi.advanceTimersByTime(900);
    fixture.detectChanges();
    expect(span().classList).not.toContain('scale-105');
  });

  it('does not animate when the value is unchanged', () => {
    setup({ value: 7 });
    fixture.componentRef.setInput('value', 7);
    fixture.detectChanges();
    expect(frames.size).toBe(0);
    expect(span().classList).not.toContain('scale-105');
  });

  it('cancels pending frames on destroy', () => {
    setup({ value: 0 });
    fixture.componentRef.setInput('value', 50);
    fixture.detectChanges();
    expect(frames.size).toBe(1);
    fixture.destroy();
    expect(frames.size).toBe(0);
  });
});
