import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SubscriptionService } from '../services/subscription.service';

export const subscriptionInterceptor: HttpInterceptorFn = (req, next) => {
  const subscription = inject(SubscriptionService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 402) {
        subscription.refresh();
      }

      return throwError(() => error);
    }),
  );
};
