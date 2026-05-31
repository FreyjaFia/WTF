import { Component } from '@angular/core';
import { IconComponent } from '@shared/components';

@Component({
  selector: 'app-stock-in',
  imports: [IconComponent],
  templateUrl: './stock-in.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockInComponent {}
