import { PLATFORM_STATUS } from '@shared/models/platform.models';

export type PlatformTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';

export function statusTone(status: number): PlatformTone {
  switch (status) {
    case PLATFORM_STATUS.Active:
      return 'green';
    case PLATFORM_STATUS.Trial:
      return 'blue';
    case PLATFORM_STATUS.Suspended:
      return 'amber';
    default:
      return 'gray';
  }
}

export function warningLabel(warning: string | null | undefined): string {
  switch (warning) {
    case 'soon':
      return 'Due soon';
    case 'lastDays':
      return 'Due in days';
    case 'grace':
      return 'Overdue, in grace';
    case 'locked':
      return 'Locked for payment';
    case 'none':
      return 'Paid up';
    default:
      return 'No plan';
  }
}

export function warningTone(warning: string | null | undefined): PlatformTone {
  switch (warning) {
    case 'none':
      return 'green';
    case 'soon':
    case 'lastDays':
      return 'amber';
    case 'grace':
    case 'locked':
      return 'red';
    default:
      return 'gray';
  }
}

export function invoiceTone(statusName: string): PlatformTone {
  switch (statusName.toLowerCase()) {
    case 'paid':
      return 'green';
    case 'void':
    case 'voided':
      return 'gray';
    default:
      return 'amber';
  }
}
