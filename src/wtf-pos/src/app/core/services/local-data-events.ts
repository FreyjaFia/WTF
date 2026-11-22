import { Subject } from 'rxjs';

const wiped = new Subject<void>();

// Raised when the device's local data stops belonging to the person using it (sign-out, another person or shop signing in).
// A plain module event, so services that only need to forget their state do not have to depend on AuthService.
export const localDataWiped$ = wiped.asObservable();

export function announceLocalDataWiped(): void {
  wiped.next();
}
