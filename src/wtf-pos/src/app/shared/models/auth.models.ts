export interface LoginDto {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string;
}

export interface MeDto {
  firstName: string;
  lastName: string;
  imageUrl?: string | null;
}
