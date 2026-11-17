import { KitchenStateEnum } from '../models/kitchen.models';

export const KITCHEN_AMBER_AFTER_MINUTES = 5;
export const KITCHEN_RED_AFTER_MINUTES = 10;

export type KitchenAgeTone = 'ok' | 'amber' | 'red';

export function kitchenAgeMinutes(createdAt: string, now: number): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) {
    return 0;
  }

  return Math.max(0, Math.floor((now - created) / 60000));
}

export function kitchenAgeTone(minutes: number): KitchenAgeTone {
  if (minutes >= KITCHEN_RED_AFTER_MINUTES) {
    return 'red';
  }

  return minutes >= KITCHEN_AMBER_AFTER_MINUTES ? 'amber' : 'ok';
}

export function kitchenAgeLabel(minutes: number): string {
  if (minutes < 1) {
    return 'Just now';
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function kitchenNextState(state: KitchenStateEnum): KitchenStateEnum | null {
  return state >= KitchenStateEnum.Served ? null : ((state + 1) as KitchenStateEnum);
}

export function kitchenPreviousState(state: KitchenStateEnum): KitchenStateEnum | null {
  return state <= KitchenStateEnum.New ? null : ((state - 1) as KitchenStateEnum);
}

export function kitchenActionLabel(state: KitchenStateEnum, isPickup: boolean): string {
  switch (state) {
    case KitchenStateEnum.New:
      return 'Start';
    case KitchenStateEnum.Preparing:
      return 'Ready';
    case KitchenStateEnum.Ready:
      return isPickup ? 'Served' : 'Handed off';
    default:
      return '';
  }
}
