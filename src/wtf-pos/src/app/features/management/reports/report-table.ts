import { ReportSortDirection } from '@shared/models';
import {
  formatDecimal,
  ReportColumn,
  ReportContext,
  ReportDefinition,
  ReportRow,
  parseShopLocal,
} from './report-definitions';

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function formatMoneyText(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDateTimeText(value: string): string {
  const parsed = parseShopLocal(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function cellText(row: ReportRow, column: ReportColumn, context: ReportContext): string {
  if (column.label) {
    return column.label(row, context);
  }

  const value = row[column.key];
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  switch (column.format) {
    case 'money':
      return formatMoneyText(Number(value));
    case 'integer':
      return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'decimal':
      return formatDecimal(Number(value));
    case 'percent':
      return `${formatMoneyText(Number(value))}%`;
    case 'minutes':
      return `${Math.round(Number(value)).toLocaleString('en-US')} min`;
    case 'dateTime':
      return formatDateTimeText(String(value));
    default:
      return String(value);
  }
}

export function filterAndSortRows(
  rows: readonly ReportRow[],
  definition: ReportDefinition,
  context: ReportContext,
  search: string,
  sortKey: string | null,
  direction: ReportSortDirection,
): ReportRow[] {
  const term = search.trim().toLowerCase();
  const filtered = term
    ? rows.filter((row) =>
        definition.columns.some((column) =>
          cellText(row, column, context).toLowerCase().includes(term),
        ),
      )
    : [...rows];

  const column = definition.columns.find((candidate) => candidate.key === sortKey);
  if (!column) {
    return filtered;
  }

  const factor = direction === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => factor * compareValues(a[column.key], b[column.key], column));
}

function compareValues(a: unknown, b: unknown, column: ReportColumn): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing || bMissing) {
    return Number(!aMissing) - Number(!bMissing);
  }

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }

  if (column.format === 'dateTime') {
    return Date.parse(String(a)) - Date.parse(String(b));
  }

  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

export function buildCsv(
  rows: readonly ReportRow[],
  definition: ReportDefinition,
  context: ReportContext,
): string {
  const lines = [definition.columns.map((column) => escapeCsv(column.header))];
  for (const row of rows) {
    lines.push(definition.columns.map((column) => escapeCsv(cellText(row, column, context))));
  }

  const totals = totalCells(rows, definition);
  if (totals) {
    lines.push(totals.map((cell) => escapeCsv(cell)));
  }

  return lines.map((line) => line.join(',')).join('\r\n');
}

// Spreadsheet apps run cells that start with = + - @ as formulas, so text that does is prefixed with a quote.
function escapeCsv(text: string): string {
  const isNumber = /^-?[\d,]+(\.\d+)?%?$/.test(text) || text === '-';
  const safe =
    !isNumber && FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix)) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function hasTotalRow(definition: ReportDefinition): boolean {
  return definition.columns.some((column) => column.total !== undefined);
}

export function totalCells(
  rows: readonly ReportRow[],
  definition: ReportDefinition,
): string[] | null {
  if (!hasTotalRow(definition) || rows.length === 0) {
    return null;
  }

  return definition.columns.map((column, index) => {
    if (!column.total) {
      return index === 0 ? 'Total' : '';
    }

    const value = column.total(rows);
    if (value === null) {
      return '';
    }

    return formatTotal(value, column);
  });
}

function formatTotal(value: number, column: ReportColumn): string {
  switch (column.format) {
    case 'money':
      return formatMoneyText(value);
    case 'percent':
      return `${formatMoneyText(value)}%`;
    case 'decimal':
      return formatDecimal(value);
    default:
      return Math.round(value).toLocaleString('en-US');
  }
}
