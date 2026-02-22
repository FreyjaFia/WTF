import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { Icon } from '../icons/icon/icon';

export interface FilterOption {
  id: string | number;
  label: string;
  count?: number;
  colorClass?: string;
}

@Component({
  selector: 'app-filter-dropdown',
  imports: [CommonModule, Icon],
  templateUrl: './filter-dropdown.html',
})
export class FilterDropdown {
  readonly title = input<string>('Filter');
  readonly icon = input<string>('icon-status');
  readonly options = input<FilterOption[]>([]);
  readonly selectedIds = input<(string | number)[]>([]);
  readonly showSelectedState = input<boolean>(false);
  readonly align = input<'start' | 'end'>('start');

  readonly filterChange = output<(string | number)[]>();
  readonly filterReset = output<void>();

  protected toggleFilter(optionId: string | number): void {
    const updated = this.selectedIds().includes(optionId)
      ? this.selectedIds().filter((id) => id !== optionId)
      : [...this.selectedIds(), optionId];

    this.filterChange.emit(updated);
  }

  protected resetFilters(): void {
    this.filterReset.emit();
  }

  protected selectedCount(): number {
    return this.selectedIds().length;
  }

  protected isActive(): boolean {
    return this.showSelectedState() && this.selectedCount() > 0;
  }

  protected selectedSummary(): string {
    const selected = this.selectedIds();

    if (selected.length === 0) {
      return '';
    }

    const labels = this.options()
      .filter((option) => selected.includes(option.id))
      .map((option) => option.label);

    if (labels.length <= 1) {
      return labels.join(', ');
    }

    return `${labels.length} selected`;
  }

  protected stopPropagation(event: Event): void {
    event.stopPropagation();
  }
}
