import {
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '@shared/components';
import { type DateRangePreset, type DateRangeSelection } from '@shared/models';

interface PresetOption {
  value: DateRangePreset;
  label: string;
}

@Component({
  selector: 'app-date-range-picker',
  imports: [FormsModule, IconComponent],
  templateUrl: './date-range-picker.html',
})
export class DateRangePickerComponent {
  private readonly el = inject(ElementRef);

  public readonly rangeChanged = output<DateRangeSelection>();

  protected readonly selectedPreset = signal<DateRangePreset>('today');
  protected readonly customStart = signal('');
  protected readonly customEnd = signal('');
  protected readonly showCustomInputs = signal(false);
  protected readonly isOpen = signal(false);

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.el.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
      this.showCustomInputs.set(false);
    }
  }

  protected toggleDropdown(): void {
    const opening = !this.isOpen();
    this.isOpen.set(opening);

    if (!opening) {
      this.showCustomInputs.set(false);
    }
  }

  protected readonly presets: PresetOption[] = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'last7days', label: 'Last 7 Days' },
    { value: 'last30days', label: 'Last 30 Days' },
  ];

  protected readonly selectedLabel = computed<string>(() => {
    if (this.selectedPreset() === 'custom') {
      const start = this.customStart();
      const end = this.customEnd();

      if (start && end) {
        return `${this.formatShortDate(start)} - ${this.formatShortDate(end)}`;
      }

      return 'Custom Range';
    }

    return this.presets.find((p) => p.value === this.selectedPreset())?.label ?? 'Today';
  });

  protected readonly isLive = computed<boolean>(() => this.selectedPreset() === 'today');

  protected readonly maxDate = (() => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offsetMs).toISOString().split('T')[0];
  })();

  protected selectPreset(preset: DateRangePreset): void {
    this.selectedPreset.set(preset);
    this.showCustomInputs.set(false);
    this.isOpen.set(false);
    this.rangeChanged.emit({ preset });
  }

  protected openCustomRange(): void {
    this.showCustomInputs.set(true);
  }

  protected applyCustomRange(): void {
    const start = this.customStart();
    const end = this.customEnd();

    if (!start || !end) {
      return;
    }

    this.selectedPreset.set('custom');
    this.showCustomInputs.set(false);
    this.isOpen.set(false);
    this.rangeChanged.emit({ preset: 'custom', startDate: start, endDate: end });
  }

  private formatShortDate(isoDate: string): string {
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
