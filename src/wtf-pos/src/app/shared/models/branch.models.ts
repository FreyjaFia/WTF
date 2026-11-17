export interface BranchDto {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  isMain: boolean;
  staffCount: number;
  openOrderCount: number;
  createdAt: string;
}

export interface MyBranchDto {
  id: string;
  name: string;
  code: string;
  isMain: boolean;
  isActive: boolean;
}

export interface MyBranchesDto {
  branches: MyBranchDto[];
  defaultBranchId: string | null;
  isMultiBranch: boolean;
  canSeeAll: boolean;
  activeBranchCount: number;
  maxBranches: number | null;
}

export interface BranchStaffDto {
  userId: string;
  name: string;
  username: string;
}

export interface BranchCloseCheckDto {
  id: string;
  isMain: boolean;
  isLastActive: boolean;
  openOrders: number;
  heldOrders: number;
  openPurchaseOrders: number;
  staffAssigned: number;
  staffWithNoOtherBranch: BranchStaffDto[];
  canClose: boolean;
  blockers: string[];
}

export interface SaveBranchDto {
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
}

export interface UserBranchAccessDto {
  userId: string;
  isAllBranches: boolean;
  branchIds: string[];
  defaultBranchId: string | null;
}

export const ALL_BRANCHES = 'all';
