import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';

export interface CustomerDropdownOption {
  id: string;
  label: string;
}

@Component({
  selector: 'app-customer-dropdown',
  imports: [CommonModule, IconComponent],
  templateUrl: './customer-dropdown.html',
})
export class CustomerDropdownComponent {
  readonly options = input<CustomerDropdownOption[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly disabled = input(false);
  readonly walkInLabel = input('Walk-in customer');
  readonly placeholder = input('Search customer...');

  readonly selectedIdChange = output<string | null>();

  protected readonly isOpen = signal(false);
  protected readonly searchTerm = signal('');
  protected readonly elementRef = inject(ElementRef<HTMLElement>);

  protected readonly sortedOptions = computed(() =>
    [...this.options()].sort((a, b) => a.label.localeCompare(b.label)),
  );

  protected readonly filteredOptions = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    if (!search) {
      return this.sortedOptions();
    }

    return this.sortedOptions().filter((option) => option.label.toLowerCase().includes(search));
  });

  protected readonly selectedLabel = computed(() => {
    const selected = this.options().find((option) => option.id === this.selectedId());
    return selected?.label ?? this.walkInLabel();
  });

  protected toggle(): void {
    if (this.disabled()) {
      return;
    }

    this.isOpen.set(!this.isOpen());
    if (!this.isOpen()) {
      this.searchTerm.set('');
    }
  }

  protected select(optionId: string | null): void {
    this.selectedIdChange.emit(optionId);
    this.isOpen.set(false);
    this.searchTerm.set('');
  }

  protected onSearchInput(event: Event): void {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    this.searchTerm.set(value);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) {
      return;
    }

    const target = event.target as Node | null;
    if (target && !this.elementRef.nativeElement.contains(target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscapeKey(): void {
    this.isOpen.set(false);
  }
}
