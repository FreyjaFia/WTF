import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-items',
  imports: [RouterOutlet],
  templateUrl: './items.html',
  host: { class: 'flex-1 min-h-0 flex flex-col' },
})
export class ItemsComponent {}
