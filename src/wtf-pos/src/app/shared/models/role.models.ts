export interface RoleDto {
  id: number;
  name: string;
  description?: string | null;
  isSystem: boolean;
  userCount: number;
  permissionCount: number;
  createdAt?: string | null;
  permissions: string[];
}

export interface RoleDetailDto {
  id: number;
  name: string;
  description?: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

export interface SaveRoleDto {
  name: string;
  description?: string | null;
  permissions: string[];
}
