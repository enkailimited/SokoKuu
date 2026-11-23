import { SystemUnitCategory } from '@prisma/client';

export function deriveUnitCategory(params: {
  systemUnitCategories?: SystemUnitCategory[];
  baseQuantumUnit?: string | null;
  categoryCode?: string | null;
}): 'WEIGHT' | 'VOLUME' | 'PACKAGING' {
  const cats = params.systemUnitCategories ?? [];
  if (cats.includes('VOLUME')) return 'VOLUME';
  if (cats.includes('WEIGHT')) return 'WEIGHT';

  const codeHint = `${params.baseQuantumUnit ?? ''} ${params.categoryCode ?? ''}`.toUpperCase();
  if (
    codeHint.includes('VOLUME') ||
    codeHint.includes('LITRE') ||
    codeHint.includes('250ML') ||
    codeHint.includes('OIL') ||
    codeHint.includes('MAFUTA') ||
    codeHint.includes('DRINK') ||
    codeHint.includes('BEVERAGE') ||
    codeHint.includes('VINYWAJI') ||
    codeHint.includes('SODA') ||
    codeHint.includes('JUICE') ||
    codeHint.includes('MILK') ||
    codeHint.includes('WATER') ||
    codeHint.includes('MAJI')
  ) {
    return 'VOLUME';
  }

  if (cats.includes('PACKAGING') && !codeHint.includes('250G') && !codeHint.includes('KG')) {
    return 'PACKAGING';
  }

  return 'WEIGHT';
}
