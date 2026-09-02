export interface Category {
  id: string;
  name: string;
}

export interface ProductEntity {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  basePrice: number;
  costPrice: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductBranchEntity {
  id: string;
  productId: string;
  branchId: string;
  stock: number;
  minStock: number;
  maxStock: number;
  price: number;
  product: ProductEntity;
}

export interface CreateProductDto {
  code: string;
  barcode?: string;
  name: string;
  description?: string;
  basePrice: number;
  costPrice: number;
  initialStock?: number;
  branchId?: string;
}