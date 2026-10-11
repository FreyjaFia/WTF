/**
 * How many filters a group of options applies. Selecting every option filters nothing, so it counts as none; otherwise
 * each selected option is one filter.
 */
export function selectedFilterCount(selected: number, total: number): number {
  return selected >= total ? 0 : selected;
}
