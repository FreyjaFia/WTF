import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { EMPTY, catchError, throwError } from 'rxjs';
import { PlanGateService } from '../services/plan-gate.service';
import { SubscriptionService } from '../services/subscription.service';
import { BACKGROUND_REQUEST } from './background-request';

const OFFLINE_SYNC_URL = /\/orders\/(sync|batch)$/;

function notInPlanFeature(error: HttpErrorResponse): string | null | undefined {
  const body = error.error as { code?: string; feature?: string } | null;

  return body?.code === 'not_in_plan' ? (body.feature ?? null) : undefined;
}

export const subscriptionInterceptor: HttpInterceptorFn = (req, next) => {
  const subscription = inject(SubscriptionService);
  const gate = inject(PlanGateService);
  const lastOnline = req.method === 'POST' && OFFLINE_SYNC_URL.test(req.url) ? subscription.lastOnline() : null;
  const outgoing = lastOnline ? req.clone({ setHeaders: { 'X-Last-Online': lastOnline } }) : req;
  const isBackground = req.context.get(BACKGROUND_REQUEST);

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      if (error.status === 402) {
        subscription.refresh();
      }

      const feature = error.status === 403 ? notInPlanFeature(error) : undefined;

      if (feature === undefined) {
        return throwError(() => error);
      }

      subscription.refresh();

      if (isBackground) {
        // A poll or widget the person did not ask for: the refreshed plan hides it, nobody is moved.
        return throwError(() => error);
      }

      gate.redirectToNotInPlan(feature, req.method !== 'GET');

      // The screen is being replaced, so its own error handling (toast, saving flag) has nothing left to show.
      return EMPTY;
    }),
  );
};
