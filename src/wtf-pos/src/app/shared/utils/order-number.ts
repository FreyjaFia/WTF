export function orderNumberLabel(orderNumber: number, branchCode: string | null | undefined, showBranch: boolean): string {
  if (showBranch && branchCode) {
    return `${branchCode}-${String(orderNumber).padStart(4, '0')}`;
  }

  return `#${orderNumber}`;
}
