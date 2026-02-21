import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GlobalAlertComponent, IconsSprite } from '@shared/components';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, IconsSprite, GlobalAlertComponent],
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('wtf-pos');
}
