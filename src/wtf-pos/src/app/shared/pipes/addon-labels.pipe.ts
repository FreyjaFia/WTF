import { Pipe, PipeTransform } from '@angular/core';
import { countedName, groupAddOns } from '@shared/calculations';
import { CartAddOnDto } from '@shared/models';

@Pipe({
  name: 'addOnLabels',
  pure: true,
})
export class AddOnLabelsPipe implements PipeTransform {
  public transform(addOns: readonly CartAddOnDto[] | undefined | null): string[] {
    return groupAddOns(addOns).map((addOn) => countedName(addOn.name, addOn.countPerItem));
  }
}
