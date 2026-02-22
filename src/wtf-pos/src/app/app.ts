import { Component, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { RouterOutlet } from '@angular/router';
import { GlobalAlertComponent, IconsSprite } from '@shared/components';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, IconsSprite, GlobalAlertComponent],
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly title = signal('wtf-pos');

  public async ngOnInit(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        // Dark icons on transparent status bar (edge-to-edge on Android 15+)
        await StatusBar.setStyle({ style: Style.Light });
      } catch (e) {
        console.error('StatusBar plugin error', e);
      }
    }
  }
}
