import { Component, input, signal } from '@angular/core';

@Component({
  selector: 'app-page-title',
  standalone: true,
  imports: [],
  templateUrl: './page-title.html',
  host: { class: 'block min-w-0' },
})
export class PageTitleComponent {
  public readonly text = input.required<string>();

  protected readonly isExpanded = signal(false);

  protected toggle(): void {
    this.isExpanded.update((expanded) => !expanded);
  }
}
