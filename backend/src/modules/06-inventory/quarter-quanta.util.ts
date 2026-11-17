import { BadRequestException } from '@nestjs/common';

export const QUANTA_PER_UNIT = 4; // 1 unit (1 KG / 1 L) = 4 Quarter-Quanta (4 x 250g/250mL)

/**
 * Converts a weight/volume in KG or Litres strictly to integer Quarter-Quanta (baseKg * 4).
 * Rejects any fractional measurement that is not an exact 0.25 increment (zero-float guarantee).
 */
export function kgToQuarterQuantaChecked(baseKg: number): number {
  if (!Number.isFinite(baseKg) || baseKg <= 0) {
    throw new BadRequestException('baseKg must be a positive finite number.');
  }
  const scaled = baseKg * QUANTA_PER_UNIT;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6 || rounded < 1) {
    throw new BadRequestException(
      `Invalid Quarter-Quanta measurement (${baseKg}): must be an exact multiple of 0.25 (Robo).`,
    );
  }
  return rounded;
}

/**
 * Overflow-safe integer TZS multiplication using BigInt before narrowing to safe JS integer.
 */
export function safeMultiplyIntegerTzs(quantity: number, unitPriceTzs: bigint): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new BadRequestException('quantity must be a positive safe integer.');
  }
  if (unitPriceTzs <= 0n) {
    throw new BadRequestException('unitPriceTzs must be greater than zero.');
  }

  const product = BigInt(quantity) * unitPriceTzs;
  if (product > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException('Integer arithmetic overflow calculating total TZS.');
  }
  return Number(product);
}

export function buildSwahiliBulkBreakSms(
  productNameSw: string,
  packagesBroken: number,
  creditedQuanta: number,
  remainingSealed: number,
): string {
  const cleanName = productNameSw.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 28) || 'Bidhaa';
  const msg = `SokoKuu: Gunia ${packagesBroken} la ${cleanName} limefunguliwa (+${creditedQuanta} Robo). Baki stoo: ${remainingSealed}.`;
  return msg.length <= 160 ? msg : msg.slice(0, 160);
}
