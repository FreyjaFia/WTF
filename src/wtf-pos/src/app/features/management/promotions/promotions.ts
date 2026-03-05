import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-promotions',
  imports: [RouterOutlet],
  templateUrl: './promotions.html',
  host: { class: 'flex-1 min-h-0 flex flex-col' },
})
export class PromotionsComponent {}
