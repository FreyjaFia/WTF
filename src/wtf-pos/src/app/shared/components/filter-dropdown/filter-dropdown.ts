import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, inject, input, output } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';

export interface FilterOption {
  id: string | number;
  label: string;
  count?: number;
  colorClass?: string;
}

@Component({
  selector: 'app-filter-dropdown',
  imports: [CommonModule, IconComponent],
  templateUrl: './filter-dropdown.html',
})
export class FilterDropdownComponent {
  private readonly elementRef = inject(ElementRef);

  public readonly title = input<string>('Filter');
  public readonly icon = input<string>('icon-status');
  public readonly options = input<FilterOption[]>([]);
  public readonly selectedIds = input<(string | number)[]>([]);
  public readonly showSelectedState = input<boolean>(false);
  public readonly align = input<'start' | 'end'>('start');

  public readonly filterChange = output<(string | number)[]>();
  public readonly filterReset = output<void>();

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      const details = this.elementRef.nativeElement.querySelector('details');
      if (details) {
        details.open = false;
      }
    }
  }

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
