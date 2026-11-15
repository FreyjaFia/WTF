import { Pipe, PipeTransform } from '@angular/core';
import { SENIOR_PWD_TYPE_LABELS, SeniorPwdTypeEnum } from '@shared/models';

@Pipe({
  name: 'seniorPwdTypeLabel',
  pure: true,
})
export class SeniorPwdTypeLabelPipe implements PipeTransform {
  public transform(type: SeniorPwdTypeEnum): string {
    return SENIOR_PWD_TYPE_LABELS[type];
  }
}
