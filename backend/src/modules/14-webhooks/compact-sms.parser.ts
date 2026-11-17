import { BadRequestException } from '@nestjs/common';
import { PackagingUnit } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';

export const COMPACT_ORDER_REGEX =
  /^SK#([A-Z0-9]{8})#([A-Z0-9]{2,10})#([A-Z0-9:,]{5,110})#([A-F0-9]{6})$/;
export const COMPACT_CANCEL_REGEX =
  /^SK#CANCEL#([A-Z0-9]{8})#([A-F0-9]{6})$/;

const UNIT_CHAR_MAP: Record<string, PackagingUnit> = {
  Q: 'QUARTER_KILO_LITRE',
  H: 'HALF_KILO_LITRE',
  T: 'THREE_QUARTER_KILO',
  K: 'SINGLE_KILO_LITRE',
  U: 'UNIT',
  P: 'PACK',
  D: 'DOZEN',
  C: 'CARTON',
  S25: 'SACK_25KG',
  S50: 'SACK_50KG',
};

export interface ParsedCompactOrderItem {
  smsItemCode: string;
  unitType: PackagingUnit;
  quantity: number;
}

export type ParsedCompactSmsCommand =
  | {
      action: 'ORDER';
      orderRef8: string;
      sellerShortCode: string;
      items: ParsedCompactOrderItem[];
      sig6: string;
      signedPayload: string;
    }
  | {
      action: 'CANCEL';
      orderRef8: string;
      sig6: string;
      signedPayload: string;
    };

export function normalizeTanzanianPhoneE164(raw: string): string {
  const cleaned = raw.trim().replace(/[\s\-()]/g, '');
  if (/^\+255[67][0-9]{8}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^255[67][0-9]{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^0[67][0-9]{8}$/.test(cleaned)) {
    return `+255${cleaned.slice(1)}`;
  }
  throw new BadRequestException(
    `Invalid Tanzanian MSISDN (${raw}). Expected +2556/7..., 2556/7..., or 06/7... format.`,
  );
}

export function parseCompactSmsCommand(rawText: string): ParsedCompactSmsCommand {
  const normalized = rawText.trim().toUpperCase();

  const cancelMatch = COMPACT_CANCEL_REGEX.exec(normalized);
  if (cancelMatch) {
    const [, orderRef8, sig6] = cancelMatch;
    return {
      action: 'CANCEL',
      orderRef8,
      sig6,
      signedPayload: `SK#CANCEL#${orderRef8}`,
    };
  }

  const orderMatch = COMPACT_ORDER_REGEX.exec(normalized);
  if (!orderMatch) {
    throw new BadRequestException(
      'Invalid NextSMS compact command syntax. Expected SK#REF8#SELLER#ITEMS#SIG6 or SK#CANCEL#REF8#SIG6.',
    );
  }

  const [, orderRef8, sellerShortCode, itemsExpr, sig6] = orderMatch;
  const rawTokens = itemsExpr.split(',').filter(Boolean);
  if (rawTokens.length === 0) {
    throw new BadRequestException('Compact SMS order must contain at least one item tuple.');
  }

  const items: ParsedCompactOrderItem[] = rawTokens.map((token) => {
    const parts = token.split(':');
    if (parts.length !== 3) {
      throw new BadRequestException(
        `Invalid compact SMS item tuple (${token}). Expected ITEMCODE:UNIT:QTY.`,
      );
    }
    const [smsItemCode, unitCode, qtyStr] = parts;
    const unitType = UNIT_CHAR_MAP[unitCode];
    if (!unitType) {
      throw new BadRequestException(`Unsupported compact SMS unit code (${unitCode}).`);
    }
    const quantity = Number.parseInt(qtyStr, 10);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new BadRequestException(`Invalid item quantity (${qtyStr}) in compact SMS.`);
    }
    return {
      smsItemCode,
      unitType,
      quantity,
    };
  });

  return {
    action: 'ORDER',
    orderRef8,
    sellerShortCode,
    items,
    sig6,
    signedPayload: `SK#${orderRef8}#${sellerShortCode}#${itemsExpr}`,
  };
}

export function computeCompactSmsSig6(secret: string, signedPayload: string): string {
  return createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
}

export function verifyCompactSmsSig6(
  secret: string,
  signedPayload: string,
  providedSig6: string,
): boolean {
  const expected = computeCompactSmsSig6(secret, signedPayload);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(providedSig6.trim().toUpperCase(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}
