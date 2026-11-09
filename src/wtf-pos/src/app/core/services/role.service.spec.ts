import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { RoleService } from './role.service';

afterEach(() => vi.restoreAllMocks());

describe('RoleService', () => {
  const base = `${environment.apiUrl}/roles`;

  it('calls the right endpoint and verb for each operation', () => {
    const { service, http } = setupHttpService(RoleService);

    service.getRoles().subscribe();
    expect(http.expectOne(base).request.method).toBe('GET');

    service.getPermissionPlans().subscribe();
    expect(http.expectOne(`${base}/permissions`).request.method).toBe('GET');

    service.getRole(100).subscribe();
    expect(http.expectOne(`${base}/100`).request.method).toBe('GET');

    service.createRole({ name: 'Lead', permissions: ['orders.read'] }).subscribe();
    const create = http.expectOne(base);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'Lead', permissions: ['orders.read'] });

    service.updateRole(100, { name: 'Lead', description: 'x', permissions: [] }).subscribe();
    const update = http.expectOne(`${base}/100`);
    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toEqual({ id: 100, name: 'Lead', description: 'x', permissions: [] });

    service.duplicateRole(4).subscribe();
    const copy = http.expectOne(`${base}/4/duplicate`);
    expect(copy.request.method).toBe('POST');

    service.deleteRole(100).subscribe();
    expect(http.expectOne(`${base}/100`).request.method).toBe('DELETE');
  });

  it('shows the server message, the network message, or a fallback', () => {
    const { service, http, connectivity } = setupHttpService(RoleService);

    const server = capture(service.deleteRole(100));
    failWith(http.expectOne(`${base}/100`), 400, { message: '2 users have this role.' });
    expect(server.error).toBe('2 users have this role.');

    const offline = capture(service.getRoles());
    failNetwork(http.expectOne(base));
    expect(offline.error).toContain('Unable to connect');
    expect(connectivity.checkNow).toHaveBeenCalled();

    const fallback = capture(service.createRole({ name: 'x', permissions: [] }));
    failWith(http.expectOne(base), 500);
    expect(fallback.error).toBe('Unable to create the role.');
  });
});
