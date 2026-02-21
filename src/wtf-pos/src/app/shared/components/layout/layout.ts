import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Dock } from '../dock/dock';
import { Header } from '../header/header';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, Dock, Header],
  templateUrl: './layout.html',
})
export class Layout {}
