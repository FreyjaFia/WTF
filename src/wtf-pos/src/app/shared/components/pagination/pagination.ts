import { Component, computed, input, output } from '@angular/core';
import {
  PAGE_SIZE_OPTIONS,
  firstRowFor,
  lastRowFor,
  pageItems,
  totalPagesFor,
} from '@shared/calculations/pagination';

@Component({
  selector: 'app-pagination',
  templateUrl: './pagination.html',
  host: { class: 'bg-surface sticky bottom-0 z-10 block' },
})
export class PaginationComponent {
  public readonly page = input.required<number>();
  public readonly pageSize = input.required<number>();
  public readonly totalCount = input.required<number>();
  public readonly pageSizeOptions = input<readonly number[]>(PAGE_SIZE_OPTIONS);
  public readonly label = input('Pages');
  public readonly disabled = input(false);
  public readonly pageChange = output<number>();
  public readonly pageSizeChange = output<number>();

  protected readonly totalPages = computed(() => totalPagesFor(this.totalCount(), this.pageSize()));
  protected readonly firstRow = computed(() =>
    firstRowFor(this.page(), this.pageSize(), this.totalCount()),
  );
  protected readonly lastRow = computed(() =>
    lastRowFor(this.page(), this.pageSize(), this.totalCount()),
  );
  protected readonly items = computed(() => pageItems(this.page(), this.totalPages()));
  protected readonly pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, index) => index + 1),
  );
  protected readonly visible = computed(() => this.totalCount() > 0);

  protected goToPage(target: number): void {
    const next = Math.min(Math.max(1, target), this.totalPages());
    if (next === this.page() || this.disabled()) {
      return;
    }

    this.pageChange.emit(next);
  }

  protected selectPage(event: Event): void {
    this.goToPage(Number((event.target as HTMLSelectElement).value));
  }

  protected changePageSize(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (!this.pageSizeOptions().includes(value) || value === this.pageSize()) {
      return;
    }

    this.pageSizeChange.emit(value);
  }
}
