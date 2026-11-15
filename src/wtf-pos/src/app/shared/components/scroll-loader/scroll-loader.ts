import { Component, effect, ElementRef, input, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-scroll-loader',
  templateUrl: './scroll-loader.html',
  host: { class: 'block' },
})
export class ScrollLoaderComponent {
  public readonly hasMore = input.required<boolean>();
  public readonly isLoading = input(false);
  public readonly error = input(false);
  public readonly offline = input(false);
  public readonly showEnd = input(true);
  public readonly rootMargin = input('300px 0px');
  public readonly loadMore = output<void>();

  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  constructor() {
    effect((onCleanup) => {
      const element = this.sentinel()?.nativeElement;
      // Read so the observer is made again when these change: a sentinel that stays in view fires no new event.
      const busy = this.isLoading() || this.error() || this.offline() || !this.hasMore();
      if (!element || busy) {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            this.requestMore();
          }
        },
        { root: scrollParent(element), rootMargin: this.rootMargin(), threshold: 0 },
      );

      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }

  protected retry(): void {
    this.loadMore.emit();
  }

  private requestMore(): void {
    if (!this.hasMore() || this.isLoading() || this.error() || this.offline()) {
      return;
    }

    this.loadMore.emit();
  }
}

// rootMargin only reaches past a scroll container when that container is the observer's root.
function scrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return parent;
    }

    parent = parent.parentElement;
  }

  return null;
}
