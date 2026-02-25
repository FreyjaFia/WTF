import { Location } from '@angular/common';
import { Component, inject, NgZone, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { ModalStackService, OfflineOrderService, UpdateService } from '@core/services';
import {
  ExitConfirmComponent,
  GlobalAlertComponent,
  IconsSprite,
  UpdateBannerComponent,
} from '@shared/components';

import type { PluginListenerHandle } from '@capacitor/core';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, IconsSprite, GlobalAlertComponent, ExitConfirmComponent, UpdateBannerComponent],
  templateUrl: './app.html',
})
export class App implements OnInit, OnDestroy {
  private readonly location = inject(Location);
  private readonly modalStack = inject(ModalStackService);
  private readonly zone = inject(NgZone);

  // Eagerly initialize to enable auto-sync on reconnect
  private readonly _offlineOrder = inject(OfflineOrderService);
  private readonly _updateService = inject(UpdateService);

  private readonly exitConfirm = viewChild(ExitConfirmComponent);

  private backButtonListener: PluginListenerHandle | null = null;

  protected readonly title = signal('wtf-pos');

  public async ngOnInit(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        // Dark icons on transparent status bar (edge-to-edge on Android 15+)
        await StatusBar.setStyle({ style: Style.Light });
      } catch (e) {
        console.error('StatusBar plugin error', e);
      }

      this.backButtonListener = await CapApp.addListener('backButton', ({ canGoBack }) => {
        this.zone.run(() => {
          // 1. If a modal is open, close it
          if (this.modalStack.pop()) {
            return;
          }

          // 2. If there is navigation history, go back
          if (canGoBack) {
            this.location.back();
            return;
          }

          // 3. At root — show exit confirmation
          this.exitConfirm()?.open();
        });
      });
    }
  }

  public async ngOnDestroy(): Promise<void> {
    await this.backButtonListener?.remove();
  }

  protected onExitConfirmed(): void {
    CapApp.exitApp();
  }
}
