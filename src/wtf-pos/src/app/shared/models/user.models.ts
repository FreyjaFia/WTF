export enum UserRoleEnum {
  Admin = 1,
  Cashier = 2,
  AdminViewer = 3,
  Owner = 4,
  ItemManager = 5,
  StockManager = 6,
}

export interface UserDto {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  roleId: number;
  roleName?: string | null;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  imageUrl?: string | null;
}

export interface CreateUserDto {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  roleId: number;
}

export interface UpdateUserDto {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  password?: string;
  roleId: number;
}

export interface GetUsersQuery {
  isActive?: boolean;
  searchTerm?: string;
}
