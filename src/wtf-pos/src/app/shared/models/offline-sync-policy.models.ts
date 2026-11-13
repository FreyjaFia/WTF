export type OfflineSyncMode = 'Hold' | 'Note';

export interface OfflineSyncCodeMode {
  code: string;
  mode: OfflineSyncMode;
}

export interface OfflineSyncPolicyDto {
  codes: OfflineSyncCodeMode[];
  priceTolerance: number;
  autoApproveNotes: boolean;
  agedAfterDays: number;
  updatedAt: string | null;
}

export type SaveOfflineSyncPolicyDto = Omit<OfflineSyncPolicyDto, 'updatedAt'>;
