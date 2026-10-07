/**
 * Sugerencias de reposición entre sucursales.
 * Para cada producto, las sucursales por debajo del mínimo reciben de las que tienen excedente
 * (stock por encima del objetivo); lo que no alcanza a cubrirse se sugiere comprar.
 */

export interface StockPosition {
  productId: string;
  branchId: string;
  stockMilli: bigint;
  minMilli: bigint;
}

export interface TransferSuggestion {
  productId: string;
  fromBranchId: string;
  toBranchId: string;
  quantityMilli: bigint;
}

export interface PurchaseSuggestion {
  productId: string;
  branchId: string;
  quantityMilli: bigint;
}

export interface ReplenishmentPlan {
  transfers: TransferSuggestion[];
  purchases: PurchaseSuggestion[];
}

/**
 * @param targetFactorPercent objetivo de reposición como % del mínimo (200 = llevar al doble del mínimo).
 */
export function planReplenishment(positions: StockPosition[], targetFactorPercent = 200): ReplenishmentPlan {
  if (targetFactorPercent < 100) {
    throw new RangeError('El objetivo debe ser al menos el 100 % del mínimo.');
  }
  const factor = BigInt(targetFactorPercent);
  const target = (position: StockPosition) => (position.minMilli * factor) / 100n;
  const byProduct = new Map<string, StockPosition[]>();
  for (const position of positions) {
    const list = byProduct.get(position.productId) ?? [];
    list.push(position);
    byProduct.set(position.productId, list);
  }

  const transfers: TransferSuggestion[] = [];
  const purchases: PurchaseSuggestion[] = [];
  for (const [productId, list] of [...byProduct.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const needs = list
      .filter((position) => position.minMilli > 0n && position.stockMilli <= position.minMilli)
      .map((position) => ({ branchId: position.branchId, need: target(position) - position.stockMilli }))
      .filter((item) => item.need > 0n)
      .sort((a, b) => (b.need > a.need ? 1 : b.need < a.need ? -1 : a.branchId.localeCompare(b.branchId)));
    const donors = list
      .map((position) => ({ branchId: position.branchId, surplus: position.stockMilli - target(position) }))
      .filter((item) => item.surplus > 0n && !needs.some((need) => need.branchId === item.branchId))
      .sort((a, b) => (b.surplus > a.surplus ? 1 : b.surplus < a.surplus ? -1 : a.branchId.localeCompare(b.branchId)));

    for (const need of needs) {
      let remaining = need.need;
      for (const donor of donors) {
        if (remaining <= 0n) break;
        if (donor.surplus <= 0n) continue;
        const quantity = donor.surplus < remaining ? donor.surplus : remaining;
        transfers.push({ productId, fromBranchId: donor.branchId, toBranchId: need.branchId, quantityMilli: quantity });
        donor.surplus -= quantity;
        remaining -= quantity;
      }
      if (remaining > 0n) {
        purchases.push({ productId, branchId: need.branchId, quantityMilli: remaining });
      }
    }
  }
  return { transfers, purchases };
}
