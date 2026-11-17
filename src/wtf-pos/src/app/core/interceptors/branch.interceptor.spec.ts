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
});
