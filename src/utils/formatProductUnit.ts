/**
 * Context-aware measurement formatting.
 *
 * Never emit a generic "KG/L" label: every measurement is rendered according
 * to the product / system-unit category.
 *
 * - VOLUME (maji, juisi, mafuta, soda): 1 quantum = 250 mL -> mL below 1000,
 *   L at 1000 and above.
 * - WEIGHT (sukari, unga, maharage): 1 quantum = 250 g -> g below 1000,
 *   KG at 1000 and above.
 * - PACKAGING: show the enclosed count and enclosed unit size
 *   (e.g. "Katoni (Chupa 12 × 300 mL)").
 */

export type UnitCategory = 'WEIGHT' | 'VOLUME' | 'PACKAGING';
export type UnitLocale = 'sw' | 'en';

export const QUANTA_ML = 250;
export const QUANTA_G = 250;

function num(value: number): string {
  const rounded = Number(value.toFixed(3));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function swFraction(grams: number): string | null {
  if (grams === 250) return 'Robo';
  if (grams === 500) return 'Nusu';
  if (grams === 750) return 'Tatu-Robo';
  return null;
}

/** Format a milli-litre quantity as mL (< 1000) or L (>= 1000). */
export function formatVolumeMl(ml: number): string {
  if (!Number.isFinite(ml) || ml <= 0) return '0 mL';
  if (ml < 1000) return `${num(ml)} mL`;
  return `${num(ml / 1000)} L`;
}

/** Format a gram quantity as g (< 1000) or KG (>= 1000), with Swahili fractions. */
export function formatWeightG(
  grams: number,
  locale: UnitLocale = 'sw',
  includeFraction = true,
): string {
  if (!Number.isFinite(grams) || grams <= 0) return '0 g';
  if (grams < 1000) {
    const fraction = locale === 'sw' && includeFraction ? swFraction(grams) : null;
    return `${num(grams)} g${fraction ? ` (${fraction})` : ''}`;
  }
  return `${num(grams / 1000)} KG`;
}

/**
 * Format a quantum count for a known product category.
 * 1 quantum = 250 mL (VOLUME) or 250 g (WEIGHT).
 */
export function formatQuantaMeasurement(
  quanta: number,
  category: UnitCategory,
  locale: UnitLocale = 'sw',
): string {
  if (category === 'VOLUME') return formatVolumeMl(quanta * QUANTA_ML);
  if (category === 'WEIGHT') return formatWeightG(quanta * QUANTA_G, locale);
  return `${num(quanta)} Q`;
}

/** Short, category-correct label for the common quarter/half/single fractions. */
export function formatFractionLabel(
  fraction: 'QUARTER' | 'HALF' | 'THREE_QUARTER' | 'SINGLE',
  category: UnitCategory,
  locale: UnitLocale = 'sw',
): string {
  const volume = category === 'VOLUME';
  const prefix =
    locale === 'sw'
      ? { QUARTER: 'Robo', HALF: 'Nusu', THREE_QUARTER: 'Tatu-Robo', SINGLE: '' }
      : { QUARTER: 'Quarter', HALF: 'Half', THREE_QUARTER: 'Three-Quarter', SINGLE: '' };
  const measure =
    fraction === 'SINGLE'
      ? volume
        ? '1 L'
        : '1 KG'
      : volume
        ? formatVolumeMl(({ QUARTER: 1, HALF: 2, THREE_QUARTER: 3 } as const)[fraction] * QUANTA_ML)
        : formatWeightG(
            ({ QUARTER: 1, HALF: 2, THREE_QUARTER: 3 } as const)[fraction] * QUANTA_G,
            locale,
            false,
          );
  return prefix[fraction] ? `${prefix[fraction]} (${measure})` : measure;
}

export interface PackagingFormatOptions {
  labelSw: string;
  labelEn: string;
  locale: UnitLocale;
  /** Idadi ya chupa/vipande vilivyomo kwenye kifungashio. */
  itemsPerPackage?: number;
  /** Ukubwa wa chupa moja kwa mL (VOLUME). */
  itemSizeMl?: number;
  /** Ukubwa wa kipande kimoja kwa g (WEIGHT). */
  itemSizeG?: number;
  /** Uzito wote wa gunia/katoni kwa KG (WEIGHT). */
  packageKg?: number;
}

/**
 * Explicit packaging label, e.g. "Katoni (Chupa 12 × 300 mL)",
 * "Katoni (Chupa 6 × 1.6 L)" or "Gunia (50 KG)".
 */
export function formatPackagingUnit({
  labelSw,
  labelEn,
  locale,
  itemsPerPackage,
  itemSizeMl,
  itemSizeG,
  packageKg,
}: PackagingFormatOptions): string {
  const label = locale === 'sw' ? labelSw : labelEn;
  const parts: string[] = [];

  if (packageKg && packageKg > 0) {
    parts.push(`${num(packageKg)} KG`);
  } else if (itemsPerPackage && itemsPerPackage > 0) {
    const itemLabel = locale === 'sw' ? 'Chupa' : 'Bottles';
    const size =
      itemSizeMl && itemSizeMl > 0
        ? formatVolumeMl(itemSizeMl)
        : itemSizeG && itemSizeG > 0
          ? formatWeightG(itemSizeG, locale)
          : '';
    parts.push(size ? `${itemLabel} ${itemsPerPackage} × ${size}` : `${itemLabel} ${itemsPerPackage}`);
  }

  return parts.length ? `${label} (${parts.join(' · ')})` : label;
}

/** Best-effort category inference from a system-unit code. */
export function categoryFromSystemUnitCode(code?: string | null): UnitCategory {
  const c = (code ?? '').toUpperCase();
  if (/LITRE|LITER|MILLILITRE|MILLILITER|_ML|GALLON/.test(c)) return 'VOLUME';
  if (/KILO|KG|GRAM/.test(c)) return 'WEIGHT';
  return 'PACKAGING';
}

const SYSTEM_UNIT_NAMES: Record<string, { sw: string; en: string }> = {
  SACK_50KG: { sw: 'Gunia 50KG', en: '50KG Sack' },
  SACK_25KG: { sw: 'Gunia 25KG', en: '25KG Sack' },
  CARTON: { sw: 'Katoni', en: 'Carton' },
  CRATE: { sw: 'Kreti', en: 'Crate' },
  DOZEN: { sw: 'Dazeni', en: 'Dozen' },
  PACK: { sw: 'Pakiti', en: 'Pack' },
  UNIT: { sw: 'Kipimo Kimoja', en: 'Single Unit' },
  PIECE: { sw: 'Kipimo Kimoja', en: 'Single Piece' },
  SINGLE_KILO_LITRE: { sw: 'Kipimo 1', en: 'Single Unit' },
  HALF_KILO_LITRE: { sw: 'Nusu', en: 'Half' },
  THREE_QUARTER_KILO: { sw: 'Tatu-Robo', en: 'Three-Quarter' },
  QUARTER_KILO_LITRE: { sw: 'Robo', en: 'Quarter' },
};

/** Compact system-unit label, e.g. "Katoni (24 Q)" or "Gunia 50KG (200 Q)". */
export function formatSystemUnitLabel(
  code: string,
  quanta: number,
  locale: UnitLocale = 'sw',
): string {
  const names = SYSTEM_UNIT_NAMES[code.toUpperCase()];
  const label = names ? names[locale] : code;
  const category = categoryFromSystemUnitCode(code);
  return `${label} (${formatQuantaMeasurement(quanta, category, locale)})`;
}

/**
 * A Merchant is wholesale-only when the tier is WHOLESALE (the DB enum that
 * replaces the old WHOLESALLE_HUB concept) or a WHOLESALER without a hybrid tier.
 */
export function isWholesaleOnly(role?: string | null, tier?: string | null): boolean {
  if (tier === 'HYBRID_STORE') return false;
  if (tier === 'WHOLESALE' || tier === 'WHOLESALLE_HUB' || tier === 'WHOLESALE_HUB') return true;
  return role === 'WHOLESALER';
}
