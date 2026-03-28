import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DockComponent } from '@shared/components/dock/dock';
import { HeaderComponent } from '@shared/components/header/header';
import { OfflineBannerComponent } from '@shared/components/offline-banner/offline-banner';
import { SidebarComponent } from '@shared/components/sidebar/sidebar';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, DockComponent, HeaderComponent, OfflineBannerComponent, SidebarComponent],
  templateUrl: './layout.html',
})
export class LayoutComponent {}
