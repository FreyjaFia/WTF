import { DestroyRef, effect, Injector, untracked } from '@angular/core';
import { AuthService } from './auth.service';
import { StockAttentionService } from './stock-attention.service';

// Runs the stock badge only while the signed-in person can read stock. The permission list can change after the screen
// opens (the server's list arrives after sign-in, and a plan or role change narrows it), so this follows it.
export function followStockPermission(
  auth: AuthService,
  attention: StockAttentionService,
  injector: Injector,
): void {
  let running = false;

  effect(
    () => {
      // Until the server's list is known the role's default list would start the badge for a feature the plan may lack.
      const known = auth.permissionsVersion() > 0;
      const allowed = known && auth.canReadStockMovements();
      untracked(() => {
        if (allowed && !running) {
          running = true;
          attention.start();
        } else if (!allowed && running) {
          running = false;
          attention.stop();
        }
      });
    },
    { injector },
  );

  injector.get(DestroyRef).onDestroy(() => {
    if (running) {
      running = false;
      attention.stop();
    }
  });
}
