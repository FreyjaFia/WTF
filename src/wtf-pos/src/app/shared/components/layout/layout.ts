import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Dock, Header, OfflineBannerComponent, UpdateBannerComponent } from '@shared/components';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, Dock, Header, OfflineBannerComponent, UpdateBannerComponent],
  templateUrl: './layout.html',
})
export class Layout {}
