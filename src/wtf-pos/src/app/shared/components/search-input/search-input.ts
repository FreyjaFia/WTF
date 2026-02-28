import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { IconComponent } from '@shared/components/icons/icon/icon';

@Component({
  selector: 'app-search-input',
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './search-input.html',
})
export class SearchInputComponent {
  public readonly control = input<FormControl<string | null> | null>(null);
  public readonly value = input('');
  public readonly placeholder = input('Search');
  public readonly disabled = input(false);
  public readonly ariaLabel = input('Search');
  public readonly clearAriaLabel = input('Clear search');
  public readonly iconClass = input('h-5 w-5 shrink-0 opacity-40');
  public readonly inputClass = input(
    'grow bg-transparent text-sm placeholder-gray-500 focus:caret-[#047857] focus:outline-none',
  );
  public readonly clearButtonClass = input(
    'flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700',
  );

  public readonly valueChange = output<string>();

  protected getCurrentValue(): string {
    const control = this.control();
    if (control) {
      return control.value ?? '';
    }

    return this.value();
  }

  protected hasValue(): boolean {
    return this.getCurrentValue().trim().length > 0;
  }

  protected isDisabled(): boolean {
    const control = this.control();
    return this.disabled() || !!control?.disabled;
  }

  protected onInput(event: Event): void {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    this.valueChange.emit(value);
  }

  protected clear(): void {
    const control = this.control();
    if (control) {
      control.setValue('');
      return;
    }

    this.valueChange.emit('');
  }
}
