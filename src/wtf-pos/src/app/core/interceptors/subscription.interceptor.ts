import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SubscriptionService } from '../services/subscription.service';

const OFFLINE_SYNC_URL = /\/orders\/(sync|batch)$/;

export const subscriptionInterceptor: HttpInterceptorFn = (req, next) => {
  const subscription = inject(SubscriptionService);
  const lastOnline = req.method === 'POST' && OFFLINE_SYNC_URL.test(req.url) ? subscription.lastOnline() : null;
  const outgoing = lastOnline ? req.clone({ setHeaders: { 'X-Last-Online': lastOnline } }) : req;

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 402) {
        subscription.refresh();
      }

      return throwError(() => error);
    }),
  );
};
