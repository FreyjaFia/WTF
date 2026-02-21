export interface CustomerDto {
  id: string;
  firstName: string;
  lastName: string;
  address?: string | null;
  isActive: boolean;
  imageUrl?: string | null;
}

export interface CreateCustomerDto {
  firstName: string;
  lastName: string;
  address?: string | null;
}

export interface UpdateCustomerDto {
  id: string;
  firstName: string;
  lastName: string;
  address?: string | null;
}
