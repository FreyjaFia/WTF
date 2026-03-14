import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { authInterceptor, timezoneInterceptor, utcDateInterceptor } from '@core/interceptors';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([timezoneInterceptor, utcDateInterceptor, authInterceptor])),
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() }),
  ],
};
