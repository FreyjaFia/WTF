import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SENIOR_PWD_DISCOUNT_PERCENT } from '@shared/calculations';
import { IconComponent } from '../icons/icon/icon';
import { SeniorPwdTypeEnum } from '@shared/models';
import { SeniorPwdTypeLabelPipe } from '@shared/pipes';

@Component({
  selector: 'app-senior-pwd-summary',
  imports: [DecimalPipe, IconComponent, SeniorPwdTypeLabelPipe],
  host: { class: 'block' },
  templateUrl: './senior-pwd-summary.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeniorPwdSummaryComponent {
  public readonly testIdPrefix = input.required<string>();
  public readonly type = input<SeniorPwdTypeEnum | null>(null);
  public readonly customerName = input('');
  public readonly idNumber = input('');
  public readonly covered = input<number | null>(null);
  public readonly vatExempt = input<number | null>(null);
  public readonly negateVatExempt = input(false);
  public readonly discount = input.required<number>();
  public readonly amountDue = input<number | null>(null);

  protected readonly discountPercent = SENIOR_PWD_DISCOUNT_PERCENT;

  protected readonly hasHeader = (): boolean => this.type() !== null;
}
