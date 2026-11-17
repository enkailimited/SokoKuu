export interface WeightedAvgCostResult {
  newTotalQuanta: number;
  lastBuyingPricePerQuantumTzs: bigint;
  weightedAvgBuyingCostPerQuantumTzs: bigint;
  newInventoryValueTzs: bigint;
}

/**
 * Computes exact integer TZS landed unit cost and weighted average buying cost
 * per Quarter-Quantum without floating-point drift.
 */
export function computeWeightedAvgPurchaseCost(params: {
  existingStockQuanta: number;
  existingWeightedAvgCostPerQuantumTzs: bigint;
  receivedQuanta: number;
  agreedTotalCostTzs: bigint;
}): WeightedAvgCostResult {
  const existingQ = BigInt(Math.max(0, params.existingStockQuanta));
  const receivedQ = BigInt(Math.max(1, params.receivedQuanta));
  const existingAvg = params.existingWeightedAvgCostPerQuantumTzs >= 0n
    ? params.existingWeightedAvgCostPerQuantumTzs
    : 0n;
  const totalPurchaseCost = params.agreedTotalCostTzs >= 0n ? params.agreedTotalCostTzs : 0n;

  // Rounded integer per-quantum cost from this receipt
  const lastBuyingPricePerQuantumTzs = (totalPurchaseCost + receivedQ / 2n) / receivedQ;
  const newTotalQuantaBig = existingQ + receivedQ;

  const weightedNumerator =
    existingQ * existingAvg + receivedQ * lastBuyingPricePerQuantumTzs;
  const weightedAvgBuyingCostPerQuantumTzs =
    (weightedNumerator + newTotalQuantaBig / 2n) / newTotalQuantaBig;

  const newInventoryValueTzs = newTotalQuantaBig * weightedAvgBuyingCostPerQuantumTzs;

  return {
    newTotalQuanta: Number(newTotalQuantaBig),
    lastBuyingPricePerQuantumTzs,
    weightedAvgBuyingCostPerQuantumTzs,
    newInventoryValueTzs,
  };
}
