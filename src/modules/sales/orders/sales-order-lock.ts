import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SalesOrderItemEntity } from './entities/sales-order-item.entity';
import { SalesOrderEntity } from './entities/sales-order.entity';

/** Bloquea el pedido (SELECT … FOR UPDATE) dentro de la transacción recibida. */
export async function lockSalesOrder(manager: EntityManager, tenantId: string, orderId: string): Promise<SalesOrderEntity> {
  const order = await manager
    .createQueryBuilder(SalesOrderEntity, 'o')
    .setLock('pessimistic_write')
    .where('o.id = :orderId', { orderId })
    .andWhere('o.tenantId = :tenantId', { tenantId })
    .getOne();
  if (!order) throw new NotFoundException('Pedido de venta no encontrado.');
  return order;
}

/** Productos del pedido, para comparar con lo que finalmente se cobró. */
export async function salesOrderProductQuantities(
  manager: EntityManager,
  tenantId: string,
  orderId: string,
): Promise<Map<string, string>> {
  const items = await manager.find(SalesOrderItemEntity, {
    where: { tenantId, salesOrderId: orderId },
    select: { productId: true, quantity: true },
  });
  return new Map(items.map((item) => [item.productId, Number(item.quantity).toFixed(3)]));
}
