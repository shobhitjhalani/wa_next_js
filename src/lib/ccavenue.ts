import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

/** CCAvenue request/response encryption (port of the legacy Crypto.php). */

const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const key = (workingKey: string) => createHash('md5').update(workingKey).digest();

export function ccaEncrypt(plain: string, workingKey: string): string {
  const cipher = createCipheriv('aes-128-cbc', key(workingKey), IV);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('hex');
}

export function ccaDecrypt(hex: string, workingKey: string): string {
  try {
    const decipher = createDecipheriv('aes-128-cbc', key(workingKey), IV);
    return Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Decrypt a response into key → value pairs (PHP parse_str). */
export function ccaDecode(hex: string, workingKey: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(ccaDecrypt(hex, workingKey)));
}
