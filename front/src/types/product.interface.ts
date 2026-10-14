export interface IProductBranch {
  id: string;
  branchId: string;
  branchName?: string;
  costPrice: number;
  profitMargin: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  isActive: boolean;
}

export interface IProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description?: string;
  category: string;
  brand: string;
  unitOfMeasure: string;
  taxRate: number;
  isActive: boolean;
  createdAt: string;
  branchSettings: IProductBranch[];
}

export type ProductActionType = 
  | 'VIEW' 
  | 'EDIT' 
  | 'MATRIX' 
  | 'PRINT' 
  | 'AUDIT' 
  | 'TOGGLE_STATUS' 
  | 'DELETE';