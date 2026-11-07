import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env.js';
import { AppError } from '../errors.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function formatTotpSecret(secret: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let encoded = '';
  for (const byte of secret) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(buffer >>> bits) & 31];
    }
  }
  return encoded;
}

function encryptionKey(): Buffer {
  const configured = env.auth.mfaKey;
  if (!configured || !/^[A-Za-z0-9+/]{43}=$/.test(configured)) {
    throw new AppError('Authenticator setup is temporarily unavailable.', 503, 'MFA_UNAVAILABLE');
  }
  return Buffer.from(configured, 'base64');
}

export function encryptTotpSecret(userId: string, secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decryptTotpSecret(userId: string, encoded: string): Buffer {
  const data = Buffer.from(encoded, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(userId));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
}

export function matchingTotpStep(secret: Buffer, code: string, lastStep: string | null, now = Date.now()): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const current = Math.floor(now / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= Number(lastStep ?? -1) || step < 0) continue;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const mac = createHmac('sha1', secret).update(counter).digest();
    const offset = mac[mac.length - 1]! & 15;
    const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    if (timingSafeEqual(Buffer.from(String(value).padStart(6, '0')), Buffer.from(code))) return step;
  }
  return undefined;
}
