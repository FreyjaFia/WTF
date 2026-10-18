import { chartTickCount } from './chart-ticks';

describe('chartTickCount', () => {
  it('uses one gridline per whole number when the maximum is small', () => {
    expect(chartTickCount([0, 1, 0])).toBe(1);
    expect(chartTickCount([0, 3, 2])).toBe(3);
  });

  it('keeps four gridlines for larger maximums', () => {
    expect(chartTickCount([0, 4])).toBe(4);
    expect(chartTickCount([0, 120.5])).toBe(4);
  });

  it('keeps four gridlines for money with decimals, however small', () => {
    expect(chartTickCount([0.5, 1.5])).toBe(4);
  });

  it('copes with no data', () => {
    expect(chartTickCount([])).toBe(4);
  });
});
