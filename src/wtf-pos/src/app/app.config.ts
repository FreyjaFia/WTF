import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import {
  authInterceptor,
  subscriptionInterceptor,
  timezoneInterceptor,
  utcDateInterceptor,
} from '@core/interceptors';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([timezoneInterceptor, utcDateInterceptor, authInterceptor, subscriptionInterceptor])),
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() }),
  ],
};
