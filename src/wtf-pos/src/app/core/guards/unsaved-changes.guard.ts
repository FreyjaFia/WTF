import { inject } from '@angular/core';
import { CanDeactivateFn, Router } from '@angular/router';
import { isPlanGateInfo } from '../services/plan-gate.service';

export interface HasUnsavedChanges {
  canDeactivate(): boolean | Promise<boolean>;
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  // The plan took this screen away, so there is nothing left to save: no Discard question.
  if (isPlanGateInfo(inject(Router).getCurrentNavigation()?.extras.info)) {
    return true;
  }

  return component.canDeactivate ? component.canDeactivate() : true;
};
