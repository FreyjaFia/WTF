import { Component, input, output } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';

/** The Filters button of every list: opens the filters and shows how many are applied. */
@Component({
  selector: 'app-filter-button',
  imports: [IconComponent],
  templateUrl: './filter-button.html',
})
export class FilterButtonComponent {
  /** How many filters are applied; nothing is shown for zero. */
  public readonly count = input(0);

  public readonly pressed = output<void>();
}
