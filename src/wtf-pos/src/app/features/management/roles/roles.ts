import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-roles',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  host: { class: 'flex-1 min-h-0 flex flex-col' },
})
export class RolesComponent {}
