import { UnprocessableEntityException } from '@nestjs/common';
import { MerchantTier } from '@common/security/auth.types';

export const WHOLESALE_BLOCKED_RETAIL_UNITS = new Set([
  'QUARTER_KILO_LITRE',
  'HALF_KILO_LITRE',
  'THREE_QUARTER_KILO',
  'SINGLE_KILO_LITRE',
  'PACK',
  'UNIT',
]);

export const RETAIL_BLOCKED_BULK_UNITS = new Set(['SACK_50KG', 'SACK_25KG']);

export function assertChannelHarmonyForTier(input: {
  merchantTier: MerchantTier;
  unitType: string;
  isWholesaleTier: boolean;
}): void {
  const { merchantTier, unitType, isWholesaleTier } = input;

  if (merchantTier === 'WHOLESALE_HUB') {
    if (WHOLESALE_BLOCKED_RETAIL_UNITS.has(unitType)) {
      throw new UnprocessableEntityException(
        `CHANNEL_HARMONY_VIOLATION: WHOLESALE_HUB cannot list retail fraction unit (${unitType}). Use HYBRID_STORE for mixed channels.`,
      );
    }
    if (!isWholesaleTier) {
      throw new UnprocessableEntityException(
        'CHANNEL_HARMONY_VIOLATION: WHOLESALE_HUB cannot define retail pricing tiers (isWholesaleTier = false).',
      );
    }
  }

  if (merchantTier === 'RETAIL_DUKA') {
    if (RETAIL_BLOCKED_BULK_UNITS.has(unitType)) {
      throw new UnprocessableEntityException(
        `CHANNEL_HARMONY_VIOLATION: RETAIL_DUKA cannot list wholesale bulk unit (${unitType}).`,
      );
    }
    if (isWholesaleTier) {
      throw new UnprocessableEntityException(
        'CHANNEL_HARMONY_VIOLATION: RETAIL_DUKA cannot define wholesale pricing tiers (isWholesaleTier = true).',
      );
    }
  }
}

export function assertChannelHarmonyForCustomUnit(input: {
  merchantTier: MerchantTier;
  unitCode: string;
  quarterQuantaPerUnit: number;
  isWholesaleTier: boolean;
}): void {
  const { merchantTier, unitCode, quarterQuantaPerUnit, isWholesaleTier } = input;

  if (merchantTier === 'WHOLESALE_HUB') {
    if (!isWholesaleTier || quarterQuantaPerUnit < 4) {
      throw new UnprocessableEntityException(
        `CHANNEL_HARMONY_VIOLATION: WHOLESALE_HUB custom unit (${unitCode}) must be a wholesale tier with >= 4 quarter-quanta (1KG/1L+).`,
      );
    }
  }

  if (merchantTier === 'RETAIL_DUKA' && isWholesaleTier) {
    throw new UnprocessableEntityException(
      `CHANNEL_HARMONY_VIOLATION: RETAIL_DUKA custom unit (${unitCode}) cannot be flagged as a wholesale tier.`,
    );
  }
}
