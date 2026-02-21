import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-customers',
  imports: [RouterOutlet],
  templateUrl: './customers.html',
  host: { class: 'flex-1 min-h-0 flex flex-col' },
})
export class CustomersComponent {}
