import { ReorderGroupDto } from '@shared/models';

function quantity(value: number): string {
  return String(Number(value.toFixed(3)));
}

// The order as plain text a shopkeeper can paste into a message to the supplier.
export function reorderMessage(group: ReorderGroupDto): string {
  const lines = group.lines.map((line) => {
    if (line.suggestedPacks !== null && line.packName) {
      return `- ${line.itemName}: ${quantity(line.suggestedPacks)} ${line.packName}`;
    }

    return `- ${line.itemName}: ${quantity(line.suggestedUnits)} ${line.unitName}`;
  });

  return [`Order for ${group.supplierName}`, ...lines].join('\n');
}
