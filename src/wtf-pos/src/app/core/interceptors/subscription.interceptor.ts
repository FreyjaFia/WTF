import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AppRoutes } from '@shared/constants/app-routes';
import { SubscriptionService } from '../services/subscription.service';

const OFFLINE_SYNC_URL = /\/orders\/(sync|batch)$/;

function isNotInPlan(error: HttpErrorResponse): boolean {
  return (error.error as { code?: string } | null)?.code === 'not_in_plan';
}

export const subscriptionInterceptor: HttpInterceptorFn = (req, next) => {
  const subscription = inject(SubscriptionService);
  const router = inject(Router);
  const lastOnline = req.method === 'POST' && OFFLINE_SYNC_URL.test(req.url) ? subscription.lastOnline() : null;
  const outgoing = lastOnline ? req.clone({ setHeaders: { 'X-Last-Online': lastOnline } }) : req;

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 402) {
        subscription.refresh();
      }

      if (error instanceof HttpErrorResponse && error.status === 403 && isNotInPlan(error)) {
        subscription.refresh();

        if (!router.url.startsWith(AppRoutes.NotInPlan)) {
          void router.navigateByUrl(AppRoutes.NotInPlan);
        }
      }

      return throwError(() => error);
    }),
  );
};
