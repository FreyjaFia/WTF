export interface CustomerDto {
  id: string;
  firstName: string;
  lastName: string;
  address?: string | null;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  imageUrl?: string | null;
  allowOrderingLink: boolean;
  contactNumber?: string | null;
}

export interface CreateCustomerDto {
  firstName: string;
  lastName: string;
  address?: string | null;
  contactNumber?: string | null;
}

export interface UpdateCustomerDto {
  id: string;
  firstName: string;
  lastName: string;
  address?: string | null;
  contactNumber?: string | null;
}
