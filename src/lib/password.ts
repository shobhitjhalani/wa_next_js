import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Passwords imported from the legacy app use Common::EncPass (base64 of
 * salted double sha1). New and re-saved passwords use bcrypt; legacy hashes
 * are upgraded on the next successful login. PHP writes bcrypt as "$2y$",
 * which is the same algorithm as "$2b$".
 */

const SALT = 'hgdfhoery4y5834ihfgkfgb7t436gdfkiytdi85873ytyotyety';
const ROUNDS = 12;

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');

export function legacyHash(plain: string): string {
  return Buffer.from(sha1(SALT + sha1(SALT + plain))).toString('base64');
}

function isBcrypt(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function checkPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  if (isBcrypt(stored)) {
    return bcrypt.compare(plain, stored.replace(/^\$2y\$/, '$2b$'));
  }
  const a = Buffer.from(legacyHash(plain));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function needsUpgrade(stored: string | null | undefined): boolean {
  return !!stored && !isBcrypt(stored);
}

/** Constant-time string comparison for tokens / signatures. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
