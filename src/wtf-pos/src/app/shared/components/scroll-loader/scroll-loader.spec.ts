import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScrollLoaderComponent } from './scroll-loader';

describe('ScrollLoaderComponent', () => {
  let fixture: ComponentFixture<ScrollLoaderComponent>;
  let trigger: (intersecting: boolean) => void;

  beforeEach(() => {
    class FakeObserver {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        trigger = (isIntersecting) => callback([{ isIntersecting }]);
      }
      public observe(): void {}
      public disconnect(): void {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });

  afterEach(() => vi.unstubAllGlobals());

  function setup(inputs: Record<string, unknown>): { emitted: ReturnType<typeof vi.fn>; el: HTMLElement } {
    fixture = TestBed.createComponent(ScrollLoaderComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    const emitted = vi.fn();
    fixture.componentInstance.loadMore.subscribe(emitted);
    fixture.detectChanges();
    return { emitted, el: fixture.nativeElement as HTMLElement };
  }

  it('asks for more when the end scrolls into view', () => {
    const { emitted } = setup({ hasMore: true });
    trigger(true);
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('does not ask while loading, after an error, offline or when nothing is left', () => {
    for (const inputs of [
      { hasMore: true, isLoading: true },
      { hasMore: true, error: true },
      { hasMore: true, offline: true },
      { hasMore: false },
    ]) {
      const { emitted } = setup(inputs);
      trigger(true);
      expect(emitted).not.toHaveBeenCalled();
      fixture.destroy();
    }
  });

  it('shows the end line without any button', () => {
    const { el } = setup({ hasMore: false });
    expect(el.textContent).toContain('You are all caught up');
    expect(el.querySelector('button')).toBeNull();
  });

  it('shows the offline line', () => {
    expect(setup({ hasMore: true, offline: true }).el.textContent).toContain('Offline');
  });

  it('shows a retry link that asks again', () => {
    const { emitted, el } = setup({ hasMore: true, error: true });
    (el.querySelector('a') as HTMLElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(el.querySelector('button')).toBeNull();
  });
});
