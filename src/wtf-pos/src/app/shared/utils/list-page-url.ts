import { ActivatedRoute, Router } from '@angular/router';

export function readPageParam(route: ActivatedRoute): number {
  const value = Number(route.snapshot.queryParamMap.get('page'));
  return Number.isInteger(value) && value > 1 ? value : 1;
}

export function writePageParam(router: Router, route: ActivatedRoute, page: number): void {
  // A late reload (for example a search pause ending after the person left the page) must not pull the router back here.
  if (page <= 1 && !('page' in router.parseUrl(router.url).queryParams)) {
    return;
  }

  void router.navigate([], {
    relativeTo: route,
    queryParams: { page: page > 1 ? page : null },
    queryParamsHandling: 'merge',
    replaceUrl: true,
  });
}
