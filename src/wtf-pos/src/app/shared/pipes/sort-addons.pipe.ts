import { Pipe, PipeTransform } from '@angular/core';
import { ADD_ON_TYPE_ORDER, CartAddOnDto } from '@shared/models';

@Pipe({
  name: 'sortAddOns',
  pure: true,
})
export class SortAddOnsPipe implements PipeTransform {
  public transform(addOns: CartAddOnDto[] | undefined | null): CartAddOnDto[] {
    if (!addOns?.length) {
      return [];
    }

    return [...addOns].sort((a, b) => {
      const typeA = a.addOnType != null ? (ADD_ON_TYPE_ORDER[a.addOnType] ?? 99) : 99;
      const typeB = b.addOnType != null ? (ADD_ON_TYPE_ORDER[b.addOnType] ?? 99) : 99;

      if (typeA !== typeB) {
        return typeA - typeB;
      }

      return a.name.localeCompare(b.name);
    });
  }
}
