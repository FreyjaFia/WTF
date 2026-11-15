import { computed, effect, inject, signal, Signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ListStateService } from '@core/services/list-state.service';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  isPageSizeOption,
  totalPagesFor,
} from '@shared/calculations/pagination';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';

interface ClientPagerState {
  pageSize?: number;
}

export class ClientPager<T> {
  public readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  public readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  public readonly totalCount = computed(() => this.source().length);
  public readonly page = computed(() =>
    Math.min(this.requestedPage(), totalPagesFor(this.totalCount(), this.pageSize())),
  );
  public readonly rows = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.source().slice(start, start + this.pageSize());
  });

  private readonly requestedPage: ReturnType<typeof signal<number>>;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly listState = inject(ListStateService);

  public constructor(
    private readonly source: Signal<readonly T[]>,
    private readonly stateKey: string,
    resetOn?: Signal<unknown>,
  ) {
    this.requestedPage = signal(readPageParam(this.route));
    const saved = this.listState.load<ClientPagerState>(this.pageSizeKey(), {});
    if (isPageSizeOption(saved.pageSize)) {
      this.pageSize.set(saved.pageSize as number);
    }

    // Any change to the search or filters sends the list back to its first page.
    if (resetOn) {
      let first = true;
      effect(() => {
        resetOn();
        if (first) {
          first = false;
          return;
        }

        untracked(() => this.reset());
      });
    }
  }

  public goTo(page: number): void {
    this.requestedPage.set(page);
    writePageParam(this.router, this.route, page);
  }

  public setPageSize(size: number): void {
    this.pageSize.set(size);
    this.listState.save<ClientPagerState>(this.pageSizeKey(), { pageSize: size });
    this.reset();
  }

  public reset(): void {
    if (this.requestedPage() === 1) {
      return;
    }

    this.goTo(1);
  }

  private pageSizeKey(): string {
    return `${this.stateKey}:paging`;
  }
}
