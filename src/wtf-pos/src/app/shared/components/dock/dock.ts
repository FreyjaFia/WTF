import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterModule } from '@angular/router';
import { AuthService } from '@core/services';
import { Icon } from '../icons/icon/icon';

@Component({
  selector: 'app-dock',
  imports: [CommonModule, Icon, RouterLink, RouterModule],
  templateUrl: './dock.html',
})
export class Dock {
  protected readonly auth = inject(AuthService);
}
