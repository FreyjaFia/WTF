import { describe, expect, it } from 'vitest';
import { SENIOR_PWD_TYPE_LABELS, SeniorPwdTypeEnum } from '@shared/models';
import { SeniorPwdTypeLabelPipe } from './senior-pwd-type-label.pipe';

describe('SeniorPwdTypeLabelPipe', () => {
  it('names every type the way the shared label table does', () => {
    const pipe = new SeniorPwdTypeLabelPipe();

    expect(pipe.transform(SeniorPwdTypeEnum.Senior)).toBe(SENIOR_PWD_TYPE_LABELS[SeniorPwdTypeEnum.Senior]);
    expect(pipe.transform(SeniorPwdTypeEnum.Pwd)).toBe(SENIOR_PWD_TYPE_LABELS[SeniorPwdTypeEnum.Pwd]);
  });
});
