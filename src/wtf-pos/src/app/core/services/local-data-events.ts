import { Subject } from 'rxjs';

const wiped = new Subject<void>();

// Raised when the device's local data stops belonging to the person using it (sign-out, another person or shop signing in).
// A plain module event, so services that only need to forget their state do not have to depend on AuthService.
export const localDataWiped$ = wiped.asObservable();

export function announceLocalDataWiped(): void {
  wiped.next();
}

const signedIn = new Subject<void>();

// Raised once a person has signed in and the token is saved, so services that read the queue or the session can look again.
export const signedIn$ = signedIn.asObservable();

export function announceSignedIn(): void {
  signedIn.next();
}
