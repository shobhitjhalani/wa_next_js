import { config } from './config';

/**
 * Mobile numbers in the form incoming WhatsApp messages are stored:
 * home-country numbers without the country code (10 digits), others with
 * their country code and no "+".
 */

/** Normalised number, or null when it cannot be a mobile number. */
export function normalizePhone(raw: unknown): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  const cc = config.countryCode;
  if (digits.length === 11 && digits[0] === '0') digits = digits.slice(1); // trunk prefix, e.g. 09876543210
  if (digits.length === cc.length + 10 && digits.startsWith(cc)) digits = digits.slice(cc.length);
  // A mobile number never starts with 0 once the trunk prefix is gone (011-2345678 is a landline)
  return digits.length >= 10 && digits.length <= 15 && digits[0] !== '0' ? digits : null;
}

/** Split pasted text on commas, semicolons or new lines; returns [valid unique numbers, invalid entries]. */
export function parsePhoneList(text: string): [string[], string[]] {
  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const part of String(text ?? '').split(/[\r\n,;]+/)) {
    if (part.trim() === '') continue;
    const n = normalizePhone(part);
    if (n) valid.add(n);
    else invalid.push(part.trim());
  }
  return [[...valid], invalid];
}

/** Number as Meta expects it: 10-digit home numbers get the country code; longer ones are international. */
export function internationalise(mobile: string): string {
  const m = mobile.replace(/^\+/, '');
  return m.length <= 10 ? config.countryCode + m : m;
}

/** WhatsApp id (wa_id) → stored mobile: strip the home country code from home numbers. */
export function fromWaId(waId: string): string {
  const cc = config.countryCode;
  return waId.startsWith(cc) && waId.length === cc.length + 10 ? waId.slice(cc.length) : waId;
}
