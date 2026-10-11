import { Component } from '@angular/core';

/** Shown for any link that is unknown, expired, revoked or switched off. It never says which. */
@Component({
  selector: 'app-link-invalid',
  templateUrl: './link-invalid.html',
})
export class LinkInvalidComponent {}
