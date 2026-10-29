export function amountPattern(value: number): RegExp {
  const fixed = Math.abs(value).toFixed(2);
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',?');
  return new RegExp(`${value < 0 ? '-\\s?' : ''}(?|PHP\\s?)?${grouped}\\.${cents}`);
}

export function quantityPattern(value: number): RegExp {
  const whole = Math.abs(Math.trunc(value)).toString();
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',?');
  return new RegExp(`${value < 0 ? '-' : ''}${grouped}\\b`);
}
