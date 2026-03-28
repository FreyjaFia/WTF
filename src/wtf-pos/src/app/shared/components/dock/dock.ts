import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterModule } from '@angular/router';
import { AuthService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-dock',
  imports: [CommonModule, IconComponent, RouterLink, RouterModule],
  templateUrl: './dock.html',
})
export class DockComponent {
  protected readonly auth = inject(AuthService);
  protected readonly routes = AppRoutes;
}
