import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

// Salt used by the PHP app's Common::EncPass() ($salt in config/general.php). Needed only
// to verify passwords that have not been upgraded to bcrypt yet. Kept in env, not in the repo.
const legacySalt = () => {
  const salt = process.env.LEGACY_PASSWORD_SALT;
  if (!salt) throw new Error("LEGACY_PASSWORD_SALT is not set");
  return salt;
};

const sha1Hex = (s: string) => createHash("sha1").update(s, "utf8").digest("hex");

/** PHP: base64_encode(sha1($salt . sha1($salt . $string))) */
export function legacyHash(password: string): string {
  const salt = legacySalt();
  return Buffer.from(sha1Hex(salt + sha1Hex(salt + password))).toString("base64");
}

export const isBcrypt = (hash: string) => /^\$2[aby]\$/.test(hash);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Checks a password against either a bcrypt hash or a legacy PHP hash.
 * `needsUpgrade` tells the caller to re-save the password as bcrypt.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (!stored) return { ok: false, needsUpgrade: false };
  if (isBcrypt(stored)) return { ok: await bcrypt.compare(password, stored), needsUpgrade: false };
  // PHP ran mysqli_real_escape_string() on the password *before* hashing it.
  const ok = legacyHash(mysqlEscape(password)) === stored;
  return { ok, needsUpgrade: ok };
}

/** Same characters mysqli_real_escape_string() escapes. */
function mysqlEscape(s: string): string {
  const map: Record<string, string> = {
    "\0": "\\0", "\n": "\\n", "\r": "\\r", "\\": "\\\\", "'": "\\'", '"': '\\"', "\x1a": "\\Z",
  };
  return s.replace(/[\0\n\r\\'"\x1a]/g, (c) => map[c]);
}
