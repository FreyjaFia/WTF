import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Dock } from '../dock/dock';
import { Header } from '../header/header';
import { OfflineBannerComponent } from '../offline-banner/offline-banner';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, Dock, Header, OfflineBannerComponent],
  templateUrl: './layout.html',
})
export class Layout {}
