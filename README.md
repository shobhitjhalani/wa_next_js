# WA JS Coretech — Next.js + PostgreSQL

Port of the PHP 7.3 / MySQL app in `../wa_jscoretech`.

## Stack
- Next.js 15 (App Router, TypeScript), same Bootstrap "Velzon" theme (`public/common_assets`)
- PostgreSQL 17 via Prisma. Former `wa_official` DB → schema `public`, former `wa_log` DB → schema `log`
- Sessions: encrypted cookies (iron-session); `wa_user` for users, `wa_admin` for `/wamaster`
- Passwords: existing PHP hashes still work and are upgraded to bcrypt on next login

## Local setup
```bash
brew install postgresql@17 pgloader && brew services start postgresql@17
cp .env.example .env            # fill in secrets
npm install
# MySQL -> Postgres: see "Data migration" below
npx prisma generate
npm run dev                     # http://localhost:3000
```

## Data migration (MySQL → PostgreSQL)
`scripts/migrate/*.load` are pgloader scripts. MySQL columns are declared latin1 but
contain UTF-8 bytes (emoji, Hindi), so they are decoded as UTF-8 — do not drop that line.

```bash
export MYSQL_URL='mysql://user:pass@host:3306' PG_URL='postgresql://user:pass@host:5432/wa_jscoretech' MODE=''
pgloader scripts/migrate/wa_official.load
pgloader scripts/migrate/wa_log.load
npx tsx scripts/migrate/indexes.ts                  # keys + indexes (pgloader skips them here)
psql "$PG_URL" -f scripts/migrate/schema-drift.sql  # only needed for the old local copy
npx tsx scripts/migrate/verify.ts                   # row counts + UTF-8 check vs MySQL
```

## Queue worker
Separate process that sends queued messages (replaces the PHP send crons):
```bash
npm run worker                    # all lanes, every 60s, 07:00-23:00 IST
npm run worker -- tpem --once     # one lane, one pass
npx tsx scripts/test-send.ts      # engine test against a mock WhatsApp API
```
Local `.env` deliberately points WA_API_URL at a dead address — never at Meta.

See docs/MIGRATION_NOTES.md for behaviour changes vs the PHP app.
