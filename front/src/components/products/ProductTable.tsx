import React, { useState } from 'react';
import { IProduct, ProductActionType } from '../../types/product.interface';

interface ProductTableProps {
  products: IProduct[];
  userRoles: string[]; // Para validación RBAC en el frontend
  onAction: (action: ProductActionType, product: IProduct) => void;
}

export const ProductTable: React.FC<ProductTableProps> = ({
  products,
  userRoles,
  onAction,
}) => {
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);

  const isAdmin = userRoles.includes('ADMIN') || userRoles.includes('SUPERUSER');

  const toggleDropdown = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdownId(activeDropdownId === id ? null : id);
  };

  return (
    <div className="table-responsive bg-white rounded shadow-sm border">
      <table className="table table-hover align-middle mb-0">
        <thead className="table-light">
          <tr>
            <th scope="col" style={{ width: '120px' }}>SKU</th>
            <th scope="col">Producto</th>
            <th scope="col">Categoría</th>
            <th scope="col">Cód. Barras</th>
            <th scope="col" className="text-center">Estado</th>
            <th scope="col" className="text-end" style={{ width: '80px' }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {products.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center py-4 text-muted">
                No hay productos registrados en el catálogo.
              </td>
            </tr>
          ) : (
            products.map((product) => (
              <tr key={product.id}>
                <td className="fw-bold text-secondary">{product.sku}</td>
                <td>
                  <div className="fw-bold text-dark">{product.name}</div>
                  <small className="text-muted">{product.brand}</small>
                </td>
                <td>
                  <span className="badge bg-light text-dark border">
                    {product.category}
                  </span>
                </td>
                <td>{product.barcode || <span className="text-muted fs-7">N/A</span>}</td>
                <td className="text-center">
                  {product.isActive ? (
                    <span className="badge bg-success-subtle text-success border border-success-subtle">
                      Activo
                    </span>
                  ) : (
                    <span className="badge bg-danger-subtle text-danger border border-danger-subtle">
                      Inactivo
                    </span>
                  )}
                </td>
                <td className="text-end">
                  <div className="dropdown position-relative">
                    <button
                      className="btn btn-sm btn-icon btn-light border-0"
                      type="button"
                      aria-expanded={activeDropdownId === product.id}
                      onClick={(e) => toggleDropdown(product.id, e)}
                    >
                      <i className="bi bi-three-dots-vertical fs-6"></i>
                    </button>

                    {activeDropdownId === product.id && (
                      <ul
                        className="dropdown-menu dropdown-menu-end show shadow-lg border-0 position-absolute end-0"
                        style={{ zIndex: 1050, minWidth: '210px' }}
                      >
                        <li>
                          <button
                            className="dropdown-item d-flex align-items-center gap-2 py-2"
                            onClick={() => {
                              setActiveDropdownId(null);
                              onAction('VIEW', product);
                            }}
                          >
                            <i className="bi bi-eye text-primary"></i> Ver Detalle
                          </button>
                        </li>
                        <li>
                          <button
                            className="dropdown-item d-flex align-items-center gap-2 py-2"
                            onClick={() => {
                              setActiveDropdownId(null);
                              onAction('EDIT', product);
                            }}
                          >
                            <i className="bi bi-pencil-square text-warning"></i> Editar Producto
                          </button>
                        </li>
                        <li>
                          <button
                            className="dropdown-item d-flex align-items-center gap-2 py-2"
                            onClick={() => {
                              setActiveDropdownId(null);
                              onAction('MATRIX', product);
                            }}
                          >
                            <i className="bi bi-diagram-3 text-info"></i> Precios / Stock por Sucursal
                          </button>
                        </li>
                        <li>
                          <button
                            className="dropdown-item d-flex align-items-center gap-2 py-2"
                            onClick={() => {
                              setActiveDropdownId(null);
                              onAction('PRINT', product);
                            }}
                          >
                            <i className="bi bi-barcode text-dark"></i> Imprimir Código de Barras
                          </button>
                        </li>
                        <li>
                          <button
                            className="dropdown-item d-flex align-items-center gap-2 py-2"
                            onClick={() => {
                              setActiveDropdownId(null);
                              onAction('AUDIT', product);
                            }}
                          >
                            <i className="bi bi-clock-history text-secondary"></i> Historial (Kardex)
                          </button>
                        </li>
                        <li><hr className="dropdown-divider my-1" /></li>
                        <li>
                          <button
                            className="dropdown-item d-flex align-items-center gap-2 py-2"
                            onClick={() => {
                              setActiveDropdownId(null);
                              onAction('TOGGLE_STATUS', product);
                            }}
                          >
                            <i className={`bi ${product.isActive ? 'bi-slash-circle text-warning' : 'bi-check-circle text-success'}`}></i>
                            {product.isActive ? 'Desactivar Producto' : 'Activar Producto'}
                          </button>
                        </li>
                        {isAdmin && (
                          <li>
                            <button
                              className="dropdown-item d-flex align-items-center gap-2 py-2 text-danger"
                              onClick={() => {
                                setActiveDropdownId(null);
                                onAction('DELETE', product);
                              }}
                            >
                              <i className="bi bi-trash"></i> Eliminar Producto
                            </button>
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};