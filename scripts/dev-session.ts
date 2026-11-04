/**
 * Development helper: print a session cookie for an account, so pages can be
 * checked with curl without knowing the password.
 *
 *   npx tsx scripts/dev-session.ts --user=74        → wa_user=…
 *   npx tsx scripts/dev-session.ts --admin=1        → wa_admin=…
 *   curl -s -b "$(npx tsx scripts/dev-session.ts --user=74)" http://localhost:3100/contacts
 */
import { SignJWT } from 'jose';

process.loadEnvFile?.('.env');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const name = args.admin ? 'wa_admin' : 'wa_user';
const id = args.admin ?? args.user ?? '74';

const token = await new SignJWT({ lid: 0, sid: 'dev' })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(String(id))
  .setAudience(name)
  .setIssuedAt()
  .setExpirationTime('12h')
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));

process.stdout.write(`${name}=${token}`);
