import { registerPlugin } from '@capacitor/core';

export interface HuaweiPushAvailability {
  available: boolean;
}

export interface HuaweiPushTokenResult {
  token: string | null;
}

export interface HuaweiPushPlugin {
  isAvailable(): Promise<HuaweiPushAvailability>;
  getToken(): Promise<HuaweiPushTokenResult>;
}

export const HuaweiPush = registerPlugin<HuaweiPushPlugin>('HuaweiPush');
