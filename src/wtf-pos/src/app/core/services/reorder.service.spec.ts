import { environment } from '@environments/environment.development';
import { describe, expect, it } from 'vitest';
import { capture, failWith, setupHttpService } from '../../testing/service-testing';
import { ReorderService } from './reorder.service';

describe('ReorderService', () => {
  const url = `${environment.apiUrl}/reorder`;

  it('gets the reorder list and the par levels', () => {
    const { service, http } = setupHttpService(ReorderService);
    capture(service.getReorderList());
    http.expectOne(url).flush({ groups: [], belowParCount: 0, itemsWithoutPar: 0 });

    capture(service.getParLevels());
    http.expectOne(`${url}/par-levels`).flush([]);
  });

  it('sets and clears a par level', () => {
    const { service, http } = setupHttpService(ReorderService);
    capture(service.setParLevel('i1', 24));
    const set = http.expectOne(`${url}/par-levels/i1`);
    expect(set.request.method).toBe('PUT');
    expect(set.request.body).toEqual({ parLevel: 24 });
    set.flush({});

    capture(service.setParLevel('i1', null));
    expect(http.expectOne(`${url}/par-levels/i1`).request.body).toEqual({ parLevel: null });
  });

  it('reports the server message', () => {
    const { service, http } = setupHttpService(ReorderService);
    const result = capture(service.setParLevel('i1', -1));
    failWith(http.expectOne(`${url}/par-levels/i1`), 400, 'Par level must be zero or more.');

    expect(result.error).toContain('zero or more');
  });
});
