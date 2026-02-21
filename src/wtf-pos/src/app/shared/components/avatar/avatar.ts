import { Component, input } from '@angular/core';

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [],
  templateUrl: './avatar.html',
})
export class AvatarComponent {
  readonly label = input.required<string>();
  readonly size = input(40);
  readonly imageUrl = input<string | null>();

  protected get fontSize(): number {
    return Math.round(this.size() * 0.45);
  }

  protected get initials(): string {
    const value = this.label()?.trim() || '';

    if (!value) {
      return '';
    }

    const parts = value.split(/\s+/).filter((p) => /^[a-zA-Z]/.test(p));
    const chars = parts.map((p) => p[0]).join('');

    return chars.slice(0, 2).toUpperCase();
  }
}
