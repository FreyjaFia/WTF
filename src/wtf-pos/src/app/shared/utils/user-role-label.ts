import { UserRoleEnum } from '@shared/models';

export function userRoleLabel(user: { roleId: number; roleName?: string | null }): string {
  if (user.roleName) {
    return user.roleName.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  }

  const enumName = UserRoleEnum[user.roleId];
  if (!enumName || typeof enumName !== 'string') {
    return 'Unknown';
  }

  return enumName.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}
