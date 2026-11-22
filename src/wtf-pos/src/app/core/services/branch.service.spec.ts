import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MyBranchesDto } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { BranchService } from './branch.service';
import { db } from './db';

const MAIN = '11111111-1111-4111-8111-111111111111';
const MALL = '22222222-2222-4222-8222-222222222222';
const CLOSED = '33333333-3333-4333-8333-333333333333';

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.sig`;
}

function mine(overrides: Partial<MyBranchesDto> = {}): MyBranchesDto {
  return {
    branches: [
      { id: MAIN, name: 'Main', code: 'MAIN', isActive: true, isMain: true },
      { id: MALL, name: 'Mall', code: 'MALL', isActive: true, isMain: false },
      { id: CLOSED, name: 'Old Kiosk', code: 'OLD', isActive: false, isMain: false },
    ],
    defaultBranchId: MAIN,
    canSeeAll: false,
    isMultiBranch: true,
    ...overrides,
  } as MyBranchesDto;
}

describe('BranchService', () => {
  let http: HttpTestingController;

  function create(): BranchService {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(BranchService);
  }

  function load(service: BranchService, dto: MyBranchesDto): void {
    service.loadMine();
    http.expectOne((r) => r.url.endsWith('/branches/mine')).flush(dto);
  }

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(db.carts, 'clear').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('the saved branch', () => {
    it('is kept when it is an open branch the person may use', () => {
      localStorage.setItem('wtf_active_branch', MALL);
      const service = create();
      load(service, mine());
      expect(service.activeId()).toBe(MALL);
    });

    it('is replaced when that branch has been closed', () => {
      localStorage.setItem('wtf_active_branch', CLOSED);
      const service = create();
      load(service, mine());
      expect(service.activeId()).toBe(MAIN);
      expect(localStorage.getItem('wtf_active_branch')).toBe(MAIN);
    });

    it('is replaced when all branches is saved but the person cannot see all', () => {
      localStorage.setItem('wtf_active_branch', 'all');
      const service = create();
      load(service, mine({ canSeeAll: false }));
      expect(service.activeId()).toBe(MAIN);
    });

    it('keeps all branches for a person who may see them', () => {
      localStorage.setItem('wtf_active_branch', 'all');
      const service = create();
      load(service, mine({ canSeeAll: true }));
      expect(service.activeId()).toBe('all');
    });

    it('never falls back to a closed default branch', () => {
      const service = create();
      load(service, mine({ defaultBranchId: CLOSED }));
      expect(service.activeId()).toBe(MAIN);
    });

    it('is ignored when the stored text is not a branch id (it would end up in a request header)', () => {
      localStorage.setItem('wtf_active_branch', 'abc\r\nX-Evil: 1');
      const service = create();
      expect(service.activeId()).toBeNull();
    });
  });

  describe('when the person changes', () => {
    it('forgets the branch and the branch list when the local data is cleared', () => {
      const service = create();
      load(service, mine());
      expect(service.activeId()).toBe(MAIN);

      TestBed.inject(AuthService).logout();

      expect(service.activeId()).toBeNull();
      expect(service.mine()).toBeNull();
      expect(localStorage.getItem('wtf_active_branch')).toBeNull();
      expect(localStorage.getItem('wtf_my_branches')).toBeNull();
    });
  });

  describe('the branch list kept for offline', () => {
    it('is read back for the same person so a device that starts offline knows its branches', () => {
      localStorage.setItem('token', makeToken({ sub: 'user-1', tenant_id: 'tenant-1' }));
      const first = create();
      load(first, mine());
      TestBed.resetTestingModule();

      const second = create();
      expect(second.branches().map((b) => b.id)).toEqual([MAIN, MALL, CLOSED]);
      expect(second.isMultiBranch()).toBe(true);
    });

    it('is not shown to another person on the same device', () => {
      localStorage.setItem('token', makeToken({ sub: 'user-1', tenant_id: 'tenant-1' }));
      const first = create();
      load(first, mine());
      TestBed.resetTestingModule();

      localStorage.setItem('token', makeToken({ sub: 'user-2', tenant_id: 'tenant-1' }));
      const second = create();
      expect(second.mine()).toBeNull();
    });
  });
});
