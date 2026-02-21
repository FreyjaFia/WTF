export enum UserRoleEnum {
  Admin = 1,
  Cashier = 2,
  AdminViewer = 3,
}

export interface UserDto {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  roleId: UserRoleEnum;
  isActive: boolean;
  imageUrl?: string | null;
}

export interface CreateUserDto {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  roleId: UserRoleEnum;
}

export interface UpdateUserDto {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  password?: string;
  roleId: UserRoleEnum;
}

export interface GetUsersQuery {
  isActive?: boolean;
  searchTerm?: string;
}
