import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function signQrTokenPayload(
  secret: string,
  orderId: string,
  qrToken: string,
  expiresAtIso: string,
): string {
  return createHmac('sha256', secret)
    .update(`${orderId}:${qrToken}:${expiresAtIso}`)
    .digest('hex');
}

export function generateOneTimeQrToken(): string {
  return `SKQR-${randomBytes(6).toString('hex').toUpperCase()}`;
}

export function verifyQrSignatureConstantTime(
  secret: string,
  orderId: string,
  qrToken: string,
  expiresAtIso: string,
  signatureHex: string,
): boolean {
  const expectedHex = signQrTokenPayload(secret, orderId, qrToken, expiresAtIso);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(signatureHex, 'hex');
  if (expectedBuf.length === 0 || expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}
