import { KitchenStateEnum } from '../models/kitchen.models';
import {
  kitchenActionLabel,
  kitchenAgeLabel,
  kitchenAgeMinutes,
  kitchenAgeTone,
  kitchenNextState,
  kitchenPreviousState,
} from './kitchen-board';

describe('kitchen board rules', () => {
  it('turns amber at 5 minutes and red at 10', () => {
    expect(kitchenAgeTone(4)).toBe('ok');
    expect(kitchenAgeTone(5)).toBe('amber');
    expect(kitchenAgeTone(9)).toBe('amber');
    expect(kitchenAgeTone(10)).toBe('red');
  });

  it('counts whole minutes and never goes below zero', () => {
    const now = new Date('2026-11-17T02:10:30Z').getTime();
    expect(kitchenAgeMinutes('2026-11-17T02:00:00Z', now)).toBe(10);
    expect(kitchenAgeMinutes('2026-11-17T02:30:00Z', now)).toBe(0);
    expect(kitchenAgeMinutes('not a date', now)).toBe(0);
  });

  it('words the age', () => {
    expect(kitchenAgeLabel(0)).toBe('Just now');
    expect(kitchenAgeLabel(7)).toBe('7 min');
    expect(kitchenAgeLabel(60)).toBe('1 h');
    expect(kitchenAgeLabel(75)).toBe('1 h 15 min');
  });

  it('steps forward and back one state at a time', () => {
    expect(kitchenNextState(KitchenStateEnum.New)).toBe(KitchenStateEnum.Preparing);
    expect(kitchenNextState(KitchenStateEnum.Ready)).toBe(KitchenStateEnum.Served);
    expect(kitchenNextState(KitchenStateEnum.Served)).toBeNull();
    expect(kitchenPreviousState(KitchenStateEnum.Ready)).toBe(KitchenStateEnum.Preparing);
    expect(kitchenPreviousState(KitchenStateEnum.New)).toBeNull();
  });

  it('labels the main button', () => {
    expect(kitchenActionLabel(KitchenStateEnum.New, true)).toBe('Start');
    expect(kitchenActionLabel(KitchenStateEnum.Preparing, true)).toBe('Ready');
    expect(kitchenActionLabel(KitchenStateEnum.Ready, true)).toBe('Served');
    expect(kitchenActionLabel(KitchenStateEnum.Ready, false)).toBe('Handed off');
    expect(kitchenActionLabel(KitchenStateEnum.Served, true)).toBe('');
  });
});
