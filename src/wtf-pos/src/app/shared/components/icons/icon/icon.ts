import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-icon',
  imports: [CommonModule],
  templateUrl: './icon.html',
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input('24');
  readonly fill = input('currentColor');
  readonly class = input<string | undefined>(undefined);
}
