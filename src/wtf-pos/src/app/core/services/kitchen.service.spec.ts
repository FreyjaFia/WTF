import { environment } from '@environments/environment.development';
import { describe, expect, it } from 'vitest';
import { setupHttpService } from '../../testing/service-testing';
import { KitchenAccessError, KitchenService } from './kitchen.service';

describe('KitchenService', () => {
  const url = `${environment.apiUrl}/kitchen/orders`;

  function failWith(status: number, body: object | null): Error {
    const { service, http } = setupHttpService(KitchenService);
    let caught: unknown = null;
    service.getBoard().subscribe({ error: (e) => (caught = e) });
    http.expectOne((r) => r.url === url).flush(body, { status, statusText: 'x' });

    return caught as Error;
  }

  it('reports a refused branch as an access error with the server\'s reason', () => {
    const error = failWith(403, { message: 'You cannot use that branch.' });

    expect(error).toBeInstanceOf(KitchenAccessError);
    expect(error.message).toBe('You cannot use that branch.');
  });

  it('gives an access error its own wording when the server gives no reason', () => {
    expect(failWith(403, null).message).toBe(KitchenService.NO_ACCESS_MESSAGE);
  });

  it('keeps other failures as plain errors', () => {
    const error = failWith(500, null);

    expect(error).not.toBeInstanceOf(KitchenAccessError);
    expect(error.message).toBe('Unable to load the kitchen orders.');
  });
});
