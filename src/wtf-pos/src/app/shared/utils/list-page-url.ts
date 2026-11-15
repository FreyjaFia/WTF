import { ActivatedRoute, Router } from '@angular/router';

export function readPageParam(route: ActivatedRoute): number {
  const value = Number(route.snapshot.queryParamMap.get('page'));
  return Number.isInteger(value) && value > 1 ? value : 1;
}

export function writePageParam(router: Router, route: ActivatedRoute, page: number): void {
  void router.navigate([], {
    relativeTo: route,
    queryParams: { page: page > 1 ? page : null },
    queryParamsHandling: 'merge',
    replaceUrl: true,
  });
}
