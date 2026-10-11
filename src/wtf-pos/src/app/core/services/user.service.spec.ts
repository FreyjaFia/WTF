import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { UserService } from './user.service';

afterEach(() => vi.restoreAllMocks());

describe('UserService', () => {
  const base = `${environment.apiUrl}/users`;
  const msgs = ServiceErrorMessages.User;

  it('serializes defined query values and skips null/undefined', () => {
    const { service, http } = setupHttpService(UserService);
    service
      .getUsers({ searchTerm: 'al', isActive: false, role: null, page: undefined } as never)
      .subscribe();

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('searchTerm')).toBe('al');
    expect(req.request.params.get('isActive')).toBe('false');
    expect(req.request.params.has('role')).toBe(false);
    expect(req.request.params.has('page')).toBe(false);
    req.flush([]);
  });

  it('calls the right endpoint and verb for each operation', () => {
    const { service, http } = setupHttpService(UserService);

    service.getUserById('1').subscribe();
    expect(http.expectOne(`${base}/1`).request.method).toBe('GET');

    service.createUser({ username: 'a' } as never).subscribe();
    expect(http.expectOne(base).request.method).toBe('POST');

    service.updateUser({ id: '2' } as never).subscribe();
    expect(http.expectOne(`${base}/2`).request.method).toBe('PUT');

    service.deleteUser('3').subscribe();
    expect(http.expectOne(`${base}/3`).request.method).toBe('DELETE');

    service.restoreUser('4').subscribe();
    expect(http.expectOne(`${base}/4/restore`).request.method).toBe('POST');

    service.uploadUserImage('5', new File(['x'], 'a.png')).subscribe();
    const upload = http.expectOne(`${base}/5/images`);
    expect(upload.request.method).toBe('POST');
    expect((upload.request.body as FormData).get('file')).toBeInstanceOf(File);

    service.deleteUserImage('6').subscribe();
    expect(http.expectOne(`${base}/6/images`).request.method).toBe('DELETE');
  });

  it('maps errors: network, server message, 404, 403, fallback', () => {
    const { service, http, connectivity } = setupHttpService(UserService);
    const network = capture(service.getUserById('1'));
    failNetwork(http.expectOne(`${base}/1`));
    const server = capture(service.getUserById('1'));
    failWith(http.expectOne(`${base}/1`), 400, { message: 'nope' });
    const notFound = capture(service.getUserById('1'));
    failWith(http.expectOne(`${base}/1`), 404);
    const forbidden = capture(service.updateUser({ id: '1' } as never));
    failWith(http.expectOne(`${base}/1`), 403);
    const fallback = capture(service.createUser({} as never));
    failWith(http.expectOne(base), 500);
    const createForbidden = capture(service.createUser({} as never));
    failWith(http.expectOne(base), 403);

    expect(network.error).toBe(HttpErrorMessages.NetworkUnavailable);
    expect(connectivity.checkNow).toHaveBeenCalledTimes(1);
    expect(server.error).toBe('nope');
    expect(notFound.error).toBe(msgs.UserNotFound);
    expect(forbidden.error).toBe(HttpErrorMessages.NotAuthorized);
    expect(fallback.error).toBe(msgs.CreateUserFailed);
    // create has no forbidden mapping, so 403 uses the fallback.
    expect(createForbidden.error).toBe(msgs.CreateUserFailed);
  });

  describe.each([
    ['uploadUserImage', (s: UserService) => s.uploadUserImage('1', new File(['x'], 'a.png'))],
    ['deleteUserImage', (s: UserService) => s.deleteUserImage('1')],
  ] as const)('%s errors', (_name, call) => {
    const run = (status: number, body: unknown = null) => {
      const { service, http, connectivity } = setupHttpService(UserService);
      const result = capture(call(service));
      const req = http.expectOne(`${base}/1/images`);
      if (status === 0) {
        failNetwork(req);
      } else {
        failWith(req, status, body);
      }
      return { result, connectivity };
    };
    const isUpload = _name === 'uploadUserImage';

    it('403 is not authorized', () => {
      expect(run(403).result.error).toBe(HttpErrorMessages.NotAuthorized);
    });

    it('network loss re-checks connectivity', () => {
      const { result, connectivity } = run(0);
      expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(connectivity.checkNow).toHaveBeenCalled();
    });

    it('404 maps to the entity-specific message', () => {
      expect(run(404).result.error).toBe(isUpload ? msgs.UserNotFound : msgs.UserOrImageNotFound);
    });

    it('500 uses the server message, else the fallback', () => {
      expect(run(500, { message: 'disk full' }).result.error).toBe('disk full');
    });

    it('500 without a message uses the fallback', () => {
      expect(run(500).result.error).toBe(isUpload ? msgs.UploadImageFailed : msgs.DeleteImageFailed);
    });
  });

  describe('uploadUserImage 400', () => {
    const run = (body: unknown = null) => {
      const { service, http } = setupHttpService(UserService);
      const result = capture(service.uploadUserImage('1', new File(['x'], 'a.png')));
      failWith(http.expectOne(`${base}/1/images`), 400, body);
      return result;
    };

    it('uses the server message', () => {
      expect(run({ message: 'Too big' }).error).toBe('Too big');
    });

    it('falls back to the invalid-file message', () => {
      expect(run().error).toBe(HttpErrorMessages.InvalidFile);
    });
  });
});
