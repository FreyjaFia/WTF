import { joinName } from './person-name';

describe('joinName', () => {
  it('joins first and last name', () => {
    expect(joinName('Ana', 'Cruz')).toBe('Ana Cruz');
  });

  it('never prints null or undefined for a missing last name', () => {
    expect(joinName('Ana', null)).toBe('Ana');
    expect(joinName('Ana', undefined)).toBe('Ana');
    expect(joinName('Ana', '  ')).toBe('Ana');
  });
});
