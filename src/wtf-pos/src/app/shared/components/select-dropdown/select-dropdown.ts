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
import { SearchInputComponent } from '@shared/components/search-input/search-input';

export interface SelectDropdownOption {
  id: string;
  label: string;
}

@Component({
  selector: 'app-select-dropdown',
  imports: [IconComponent, SearchInputComponent],
  templateUrl: './select-dropdown.html',
  host: { class: 'block min-w-0' },
})
export class SelectDropdownComponent {
  public readonly options = input<SelectDropdownOption[]>([]);
  public readonly selectedId = input<string | null>(null);
  public readonly placeholder = input('Choose...');
  public readonly searchPlaceholder = input('Search...');
  public readonly emptyLabel = input<string | null>(null);
  public readonly disabled = input(false);
  public readonly small = input(false);
  public readonly testId = input('select');

  public readonly selectedIdChange = output<string | null>();

  protected readonly isOpen = signal(false);
  protected readonly searchTerm = signal('');

  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected readonly filteredOptions = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    return term
      ? this.options().filter((option) => option.label.toLowerCase().includes(term))
      : this.options();
  });

  protected readonly selectedLabel = computed(() => {
    const selected = this.options().find((option) => option.id === this.selectedId());
    return selected?.label ?? this.emptyLabel() ?? this.placeholder();
  });

  protected toggle(): void {
    if (this.disabled()) {
      return;
    }

    this.isOpen.update((open) => !open);
    this.searchTerm.set('');
  }

  protected select(optionId: string | null): void {
    this.selectedIdChange.emit(optionId);
    this.isOpen.set(false);
    this.searchTerm.set('');
  }

  protected setSearch(value: string): void {
    this.searchTerm.set(value);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    if (this.isOpen() && target && !this.elementRef.nativeElement.contains(target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscapeKey(): void {
    this.isOpen.set(false);
  }
}
