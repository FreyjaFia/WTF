import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BranchService } from '@core/services/branch.service';
import { beforeEach, describe, expect, it } from 'vitest';
import { branchInterceptor } from './branch.interceptor';

describe('branchInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let branches: BranchService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([branchInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    branches = TestBed.inject(BranchService);
  });

  it('sends nothing before a branch is chosen', () => {
    http.get('/api/orders').subscribe();
    const req = controller.expectOne('/api/orders');
    expect(req.request.headers.has('X-Branch-Id')).toBe(false);
  });

  it('sends the chosen branch on API requests only', () => {
    branches.select('b-1');
    http.get('/api/orders').subscribe();
    http.get('https://example.com/file').subscribe();
    expect(controller.expectOne('/api/orders').request.headers.get('X-Branch-Id')).toBe('b-1');
    expect(controller.expectOne('https://example.com/file').request.headers.has('X-Branch-Id')).toBe(false);
  });

  it('sends all when everything is chosen', () => {
    branches.select('all');
    http.get('/api/orders').subscribe();
    expect(controller.expectOne('/api/orders').request.headers.get('X-Branch-Id')).toBe('all');
  });
  it('does not send the saved branch when asking which branches are allowed', () => {
    branches.select('stale');
    http.get('/api/branches/mine').subscribe();
    expect(controller.expectOne((r) => r.url.endsWith('/api/branches/mine')).request.headers.has('X-Branch-Id')).toBe(false);
  });

  it('repairs a stale saved branch and retries once with the allowed one', () => {
    branches.select('stale');
    let body: unknown = null;
    http.get('/api/orders').subscribe((r) => (body = r));

    controller
      .expectOne('/api/orders')
      .flush({ message: 'You cannot use that branch.' }, { status: 403, statusText: 'Forbidden' });
    controller.expectOne((r) => r.url.endsWith('/api/branches/mine')).flush({
      branches: [{ id: 'b-main', name: 'Main', isActive: true, isMain: true }],
      defaultBranchId: 'b-main',
      canSeeAll: false,
      isMultiBranch: false,
    });

    const retry = controller.expectOne('/api/orders');
    expect(retry.request.headers.get('X-Branch-Id')).toBe('b-main');
    retry.flush({ ok: true });
    expect(body).toEqual({ ok: true });
    expect(branches.activeId()).toBe('b-main');
  });

  it('passes other 403 errors through untouched', () => {
    branches.select('b-1');
    let status = 0;
    http.get('/api/orders').subscribe({ error: (e) => (status = e.status) });
    controller.expectOne('/api/orders').flush({ message: 'Nope' }, { status: 403, statusText: 'Forbidden' });
    expect(status).toBe(403);
  });
});
