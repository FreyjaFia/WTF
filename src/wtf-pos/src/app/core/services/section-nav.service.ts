import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SectionNavService {
  public readonly hidden = signal(false);
}
